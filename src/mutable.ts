import algosdk from "algosdk";
import { sendError, sendLog } from "./protocol.js";
import { encryptValue, decryptValue } from "./encrypt.js";
import { getAlgod, getIndexer, checkAlgod, getSuggestedParams, submitAndWait, ensureFunded } from "./algorand.js";
import type { Identity } from "./identity.js";

function arc69Metadata(key: string, encryptedValue: string, userAddress: string): string {
  return JSON.stringify({
    standard: "arc69",
    description: `mem:${key}`,
    properties: {
      type: "memory",
      key,
      value: encryptedValue,
      user: userAddress,
      updated: new Date().toISOString(),
    },
  });
}

export async function mutableSave(key: string, value: string, identity: Identity): Promise<string | null> {
  if (!await checkAlgod()) {
    sendError("Cannot reach algod. Is localnet running? Set ALGOD_URL if using a remote node.");
    return null;
  }

  await ensureFunded(identity.address);
  const encrypted = encryptValue(value, identity);
  const metadata = arc69Metadata(key, encrypted, identity.address);
  const note = new Uint8Array(Buffer.from(metadata));
  const params = await getSuggestedParams();
  const sender = algosdk.Address.fromString(identity.address);

  const existing = await findAsaByKey(key, identity);
  if (existing) {
    const txn = algosdk.makeAssetConfigTxnWithSuggestedParamsFromObject({
      sender,
      assetIndex: BigInt(existing.asaId),
      manager: sender,
      reserve: sender,
      freeze: sender,
      clawback: sender,
      suggestedParams: params,
      note,
      strictEmptyAddressChecking: false,
    });
    const signed = txn.signTxn(identity.signingKey);
    await submitAndWait(signed);
    return existing.asaId;
  }

  const txn = algosdk.makeAssetCreateTxnWithSuggestedParamsFromObject({
    sender,
    total: BigInt(1),
    decimals: 0,
    defaultFrozen: false,
    manager: sender,
    reserve: sender,
    freeze: sender,
    clawback: sender,
    assetName: `mem:${key}`,
    unitName: "MEM",
    note,
    suggestedParams: params,
  });
  const signed = txn.signTxn(identity.signingKey);
  const txid = await submitAndWait(signed);

  const algod = getAlgod();
  const txInfo = await algod.pendingTransactionInformation(txid).do();
  const assetIndex = txInfo.assetIndex;
  return assetIndex ? String(assetIndex) : "unknown";
}

export async function mutableRecall(key: string, identity: Identity): Promise<{ key: string; value: string; asaId: string } | null> {
  if (!await checkAlgod()) return null;

  const entry = await findAsaByKey(key, identity);
  if (!entry || !entry.metadata) return null;

  try {
    const meta = JSON.parse(entry.metadata);
    const encrypted = meta.properties?.value;
    if (!encrypted) return null;
    const decrypted = decryptValue(encrypted, identity);
    return { key, value: decrypted, asaId: entry.asaId };
  } catch {
    return null;
  }
}

export async function mutableList(identity: Identity): Promise<{ key: string; asaId: string }[]> {
  if (!await checkAlgod()) return [];

  // Prefer algod (real-time) over indexer (1-3s lag) for finding our created
  // ASAs. Otherwise rapid back-to-back `save` calls race the indexer and
  // create duplicate ASAs for the same key.
  try {
    const algod = getAlgod();
    const info = await algod.accountInformation(identity.address).do();
    const assets = (info.createdAssets ?? info["created-assets"] ?? []) as any[];
    const out = assets
      .filter((a: any) => a.params?.name?.startsWith("mem:"))
      .map((a: any) => ({
        key: a.params.name.substring(4),
        asaId: String(a.index),
      }));
    // If a key was duplicated by an earlier race, keep the lowest ASA id —
    // that's the original record; later acfg writes against it still work.
    const byKey = new Map<string, { key: string; asaId: string }>();
    for (const e of out) {
      const cur = byKey.get(e.key);
      if (!cur || BigInt(e.asaId) < BigInt(cur.asaId)) byKey.set(e.key, e);
    }
    return Array.from(byKey.values());
  } catch {
    try {
      const indexer = getIndexer();
      const result = await indexer.lookupAccountCreatedAssets(identity.address).do();
      const assets = result.assets ?? [];
      return assets
        .filter((a: any) => a.params?.name?.startsWith("mem:"))
        .map((a: any) => ({
          key: a.params.name.substring(4),
          asaId: String(a.index),
        }));
    } catch {
      return [];
    }
  }
}

export async function mutableDelete(key: string, identity: Identity): Promise<boolean> {
  if (!await checkAlgod()) return false;

  const entry = await findAsaByKey(key, identity);
  if (!entry) return false;

  try {
    const params = await getSuggestedParams();
    const sender = algosdk.Address.fromString(identity.address);
    const txn = algosdk.makeAssetDestroyTxnWithSuggestedParamsFromObject({
      sender,
      assetIndex: BigInt(entry.asaId),
      suggestedParams: params,
    });
    const signed = txn.signTxn(identity.signingKey);
    await submitAndWait(signed);
    return true;
  } catch {
    return false;
  }
}

async function findAsaByKey(key: string, identity: Identity): Promise<{ asaId: string; metadata?: string } | null> {
  // Retry the algod lookup briefly: a save just performed can take a
  // round (~3s on localnet, ~5s on testnet) before getAssetByID and
  // accountInformation reflect it. Without retry, a save followed by an
  // immediate recall in the same script returns not_found.
  let entry: { key: string; asaId: string } | undefined;
  for (let attempt = 0; attempt < 5; attempt++) {
    const list = await mutableList(identity);
    entry = list.find(e => e.key === key);
    if (entry) break;
    if (attempt < 4) await new Promise(r => setTimeout(r, 1500));
  }
  if (!entry) return null;

  // Retry the indexer lookup too — newly-saved acfg notes can take 5-15s
  // to appear after the save submits, and "empty results" is just as
  // likely as "indexer threw" during that window. Both cases retry.
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const indexer = getIndexer();
      const txns = await indexer
        .searchForTransactions()
        .assetID(Number(entry.asaId))
        .txType("acfg")
        .do();

      // ARC-69 says "the most recent acfg note wins". Don't trust indexer
      // default ordering; sort explicitly by confirmed-round desc using
      // BigInt comparison (the field is a BigInt in algosdk v3, and
      // Number() narrowing loses precision past 2^53 — unlikely to matter
      // in practice but BigInt comparison is the correct shape).
      const allTxns = (txns.transactions ?? []).slice().sort((a: any, b: any) => {
        const ra = BigInt(a.confirmedRound ?? a["confirmed-round"] ?? 0);
        const rb = BigInt(b.confirmedRound ?? b["confirmed-round"] ?? 0);
        if (rb > ra) return 1;
        if (rb < ra) return -1;
        return 0;
      });
      const latestTx = allTxns[0];
      if (latestTx?.note) {
        const decoded = Buffer.from(latestTx.note as unknown as string, "base64").toString("utf-8");
        return { asaId: entry.asaId, metadata: decoded };
      }
      // Empty results — fall through to retry.
    } catch {}
    if (attempt < 7) await new Promise(r => setTimeout(r, 2500));
  }

  try {
    const algod = getAlgod();
    const info = await algod.getAssetByID(Number(entry.asaId)).do();
    return { asaId: entry.asaId };
  } catch {}

  return { asaId: entry.asaId };
}
