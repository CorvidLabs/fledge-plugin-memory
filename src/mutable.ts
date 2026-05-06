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
    try {
      const algod = getAlgod();
      const info = await algod.accountInformation(identity.address).do();
      const assets = info.createdAssets ?? [];
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
  const list = await mutableList(identity);
  const entry = list.find(e => e.key === key);
  if (!entry) return null;

  try {
    const indexer = getIndexer();
    const txns = await indexer
      .searchForTransactions()
      .assetID(Number(entry.asaId))
      .txType("acfg")
      .do();

    const allTxns = txns.transactions ?? [];
    const latestTx = allTxns[allTxns.length - 1];
    if (latestTx?.note) {
      const decoded = Buffer.from(latestTx.note as unknown as string, "base64").toString("utf-8");
      return { asaId: entry.asaId, metadata: decoded };
    }
  } catch {}

  try {
    const algod = getAlgod();
    const info = await algod.getAssetByID(Number(entry.asaId)).do();
    return { asaId: entry.asaId };
  } catch {}

  return { asaId: entry.asaId };
}
