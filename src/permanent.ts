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

interface PermanentEntry {
  key: string;
  value: string;
  txid: string;
  created: string;
  round: number;
}

async function scanPermanent(identity: Identity): Promise<PermanentEntry[]> {
  if (!await checkAlgod()) return [];
  try {
    const indexer = getIndexer();
    // Self-payments to/from this address. Note that filtering by `txType=pay`
    // already narrows search; we filter in code for amount=0 + matching note
    // shape because the indexer doesn't expose a note-content predicate.
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
        if (meta.type !== PERMANENT_TYPE || typeof meta.key !== "string") continue;
        const decrypted = decryptValue(meta.value, identity);
        entries.push({
          key: meta.key,
          value: decrypted,
          txid: tx.id,
          created: meta.created ?? "",
          round: Number(tx.confirmedRound ?? tx["confirmed-round"] ?? 0),
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

export async function permanentRecall(key: string, identity: Identity): Promise<{ key: string; value: string; txid: string; created: string } | null> {
  const all = await scanPermanent(identity);
  // Permanent is append-only and immutable per-record, but a key may be
  // saved more than once — pick the most recent confirmed round.
  const matches = all.filter(e => e.key === key).sort((a, b) => b.round - a.round);
  if (matches.length === 0) return null;
  const latest = matches[0];
  return { key: latest.key, value: latest.value, txid: latest.txid, created: latest.created };
}

export async function permanentList(identity: Identity): Promise<{ key: string; txid: string; created: string }[]> {
  const all = await scanPermanent(identity);
  // Dedupe by key (latest entry per key wins).
  const byKey = new Map<string, PermanentEntry>();
  for (const e of all) {
    const cur = byKey.get(e.key);
    if (!cur || e.round > cur.round) byKey.set(e.key, e);
  }
  return Array.from(byKey.values()).map(e => ({ key: e.key, txid: e.txid, created: e.created }));
}
