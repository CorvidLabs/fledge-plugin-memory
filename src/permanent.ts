import algosdk from "algosdk";
import { sendError } from "./protocol.js";
import { encryptValue, decryptValue } from "./encrypt.js";
import { checkAlgod, getSuggestedParams, submitAndWait, ensureFunded, getIndexer } from "./algorand.js";
import type { Identity } from "./identity.js";

const PERMANENT_TYPE = "permanent-memory";

export async function permanentSave(key: string, value: string, identity: Identity): Promise<string | null> {
  if (!await checkAlgod()) {
    sendError("Cannot reach algod. Is localnet running? Set ALGOD_URL if using a remote node.");
    return null;
  }

  await ensureFunded(identity.address);
  const encrypted = encryptValue(value, identity);
  const noteData = JSON.stringify({
    key,
    value: encrypted,
    type: PERMANENT_TYPE,
    user: identity.address,
    created: new Date().toISOString(),
  });
  const note = new Uint8Array(Buffer.from(noteData));
  if (note.length > 1024) {
    sendError(`Permanent value too large for tx note: ${note.length} bytes (Algorand caps notes at 1024).`);
    return null;
  }
  const params = await getSuggestedParams();
  const sender = algosdk.Address.fromString(identity.address);

  const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender,
    receiver: sender,
    amount: BigInt(0),
    suggestedParams: params,
    note,
  });

  const signed = txn.signTxn(identity.signingKey);
  const txid = await submitAndWait(signed);
  return txid;
}

const PERMANENT_TOMBSTONE = "permanent-memory-tombstone";
const RETRY_TIMEOUT_MS = 120_000; // 2-minute absolute wall-clock timeout

interface PermanentEntry {
  key: string;
  value: string;
  txid: string;
  created: string;
  round: number;
  tombstone: boolean;
}

async function scanPermanentRaw(identity: Identity): Promise<PermanentEntry[]> {
  if (!await checkAlgod()) return [];
  try {
    const indexer = getIndexer();
    const result = await indexer
      .searchForTransactions()
      .address(identity.address)
      .txType("pay")
      .do();

    const txns = (result.transactions ?? []) as any[];
    const entries: PermanentEntry[] = [];
    for (const tx of txns) {
      const pay = tx.paymentTransaction ?? tx["payment-transaction"];
      if (!pay) continue;
      const amount = BigInt(pay.amount ?? 0);
      if (amount !== BigInt(0)) continue;
      const receiver = pay.receiver ?? pay["receiver"];
      const sender = tx.sender;
      if (sender !== identity.address || receiver !== identity.address) continue;
      const noteB64 = tx.note;
      if (!noteB64) continue;
      try {
        const decoded = Buffer.from(noteB64 as unknown as string, "base64").toString("utf-8");
        const meta = JSON.parse(decoded);
        const isData = meta.type === PERMANENT_TYPE;
        const isTombstone = meta.type === PERMANENT_TOMBSTONE;
        if (!isData && !isTombstone) continue;
        if (typeof meta.key !== "string") continue;
        const value = isData ? decryptValue(meta.value, identity) : "";
        entries.push({
          key: meta.key,
          value,
          txid: tx.id,
          created: meta.created ?? "",
          round: Number(tx.confirmedRound ?? tx["confirmed-round"] ?? 0),
          tombstone: isTombstone,
        });
      } catch {
        // Ignore tx whose note isn't a valid permanent-memory envelope.
      }
    }
    return entries;
  } catch {
    return [];
  }
}

// Returns the live (non-tombstoned) permanent entries, with retry to
// accommodate indexer lag. Caller can pass a `lookingFor` key to widen
// the retry — if we expect a specific key and don't see it yet, retry;
// if no expected key, return whatever is there even if empty.
async function scanPermanent(
  identity: Identity,
  opts: { lookingFor?: string; expectTombstoneFor?: string; retries?: number } = {},
): Promise<PermanentEntry[]> {
  const retries = opts.retries ?? 8;
  const deadline = Date.now() + RETRY_TIMEOUT_MS;
  let raw: PermanentEntry[] = [];
  for (let attempt = 0; attempt < Math.max(retries, 1); attempt++) {
    if (Date.now() > deadline) break;
    raw = await scanPermanentRaw(identity);
    let satisfied = true;
    if (opts.lookingFor) {
      satisfied = raw.some(e => e.key === opts.lookingFor && !e.tombstone);
    }
    if (opts.expectTombstoneFor) {
      satisfied = raw.some(e => e.key === opts.expectTombstoneFor && e.tombstone);
    }
    if (satisfied) break;
    if (attempt < retries - 1) await new Promise(r => setTimeout(r, 2500));
  }
  // For each key, the latest-round entry wins. If that latest is a
  // tombstone, the key is logically deleted.
  const byKey = new Map<string, PermanentEntry>();
  for (const e of raw) {
    const cur = byKey.get(e.key);
    if (!cur || e.round > cur.round) byKey.set(e.key, e);
  }
  return Array.from(byKey.values()).filter(e => !e.tombstone);
}

export async function permanentRecall(key: string, identity: Identity): Promise<{ key: string; value: string; txid: string; created: string } | null> {
  // Use scanPermanent which deduplicates by key (latest round wins)
  // and filters out tombstoned entries. It handles indexer-lag retries
  // internally when lookingFor/expectTombstoneFor are provided.
  //
  // For recall, we first check without retry hints — if the key is
  // already live or already tombstoned the dedup logic handles it.
  // If the key isn't found at all, we retry with lookingFor in case
  // the indexer is still catching up from a recent save.
  const live = await scanPermanent(identity, { retries: 1 });
  const match = live.find(e => e.key === key);
  if (match) return { key: match.key, value: match.value, txid: match.txid, created: match.created };

  // Not in the live set. Either tombstoned, not written, or indexer lag.
  // Check raw to see if any entry (including tombstones) exists.
  const raw = await scanPermanentRaw(identity);
  if (raw.some(e => e.key === key)) {
    // Entries exist but none survived the tombstone filter — key is deleted.
    return null;
  }

  // Genuinely not found yet — retry with lookingFor for indexer lag.
  const retried = await scanPermanent(identity, { lookingFor: key, retries: 6 });
  const retryMatch = retried.find(e => e.key === key);
  if (retryMatch) return { key: retryMatch.key, value: retryMatch.value, txid: retryMatch.txid, created: retryMatch.created };
  return null;
}

export async function permanentList(identity: Identity): Promise<{ key: string; txid: string; created: string }[]> {
  const live = await scanPermanent(identity, { retries: 1 });
  return live.map(e => ({ key: e.key, txid: e.txid, created: e.created }));
}

/**
 * Tombstone a permanent record. The original tx remains on chain forever
 * (that's what "permanent" means), but a follow-up tx with a tombstone
 * note tells future scans to treat the key as deleted. Recall and list
 * will not surface tombstoned keys.
 */
export async function permanentDelete(key: string, identity: Identity): Promise<string | null> {
  if (!await checkAlgod()) {
    sendError("Cannot reach algod. Is localnet running? Set ALGOD_URL if using a remote node.");
    return null;
  }
  await ensureFunded(identity.address);
  const noteData = JSON.stringify({
    key,
    type: PERMANENT_TOMBSTONE,
    user: identity.address,
    created: new Date().toISOString(),
  });
  const note = new Uint8Array(Buffer.from(noteData));
  const params = await getSuggestedParams();
  const sender = algosdk.Address.fromString(identity.address);
  const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender,
    receiver: sender,
    amount: BigInt(0),
    suggestedParams: params,
    note,
  });
  const signed = txn.signTxn(identity.signingKey);
  return await submitAndWait(signed);
}
