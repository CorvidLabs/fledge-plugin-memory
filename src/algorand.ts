import algosdk from "algosdk";
import { sendLog } from "./protocol.js";

const DEFAULT_ALGOD_URL = "http://localhost:4001";
const DEFAULT_ALGOD_TOKEN = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const DEFAULT_INDEXER_URL = "http://localhost:8980";
const DEFAULT_KMD_URL = "http://localhost:4002";

function parseUrl(url: string): { base: string; port: string } {
  const parsed = new URL(url);
  const port = parsed.port || (parsed.protocol === "https:" ? "443" : "80");
  return { base: `${parsed.protocol}//${parsed.hostname}`, port };
}

let algodClient: algosdk.Algodv2 | null = null;
let indexerClient: algosdk.Indexer | null = null;

export function getAlgod(): algosdk.Algodv2 {
  if (!algodClient) {
    const url = process.env.ALGOD_URL ?? DEFAULT_ALGOD_URL;
    const token = process.env.ALGOD_TOKEN ?? DEFAULT_ALGOD_TOKEN;
    const { base, port } = parseUrl(url);
    algodClient = new algosdk.Algodv2(token, base, port);
  }
  return algodClient;
}

export function getIndexer(): algosdk.Indexer {
  if (!indexerClient) {
    const url = process.env.INDEXER_URL ?? DEFAULT_INDEXER_URL;
    const token = process.env.ALGOD_TOKEN ?? DEFAULT_ALGOD_TOKEN;
    const { base, port } = parseUrl(url);
    indexerClient = new algosdk.Indexer(token, base, port);
  }
  return indexerClient;
}

export async function checkAlgod(): Promise<boolean> {
  try {
    await getAlgod().status().do();
    return true;
  } catch {
    return false;
  }
}

export async function getSuggestedParams(): Promise<algosdk.SuggestedParams> {
  return await getAlgod().getTransactionParams().do();
}

export async function submitAndWait(signedTxn: Uint8Array): Promise<string> {
  const algod = getAlgod();
  const { txid } = await algod.sendRawTransaction(signedTxn).do();
  await algosdk.waitForConfirmation(algod, txid, 4);
  return txid;
}

export async function ensureFunded(address: string, minBalance: bigint = BigInt(1_000_000)): Promise<boolean> {
  try {
    const info = await getAlgod().accountInformation(address).do();
    if (BigInt(info.amount) >= minBalance) return true;
  } catch {}

  return await fundFromKmd(address);
}

async function fundFromKmd(address: string): Promise<boolean> {
  const kmdUrl = process.env.KMD_URL ?? DEFAULT_KMD_URL;
  const kmdToken = process.env.KMD_TOKEN ?? DEFAULT_ALGOD_TOKEN;

  try {
    const { base, port } = parseUrl(kmdUrl);
    const kmd = new algosdk.Kmd(kmdToken, base, port);
    const wallets = await kmd.listWallets();
    const defaultWallet = wallets.wallets.find((w: any) => w.name === "unencrypted-default-wallet");
    if (!defaultWallet) return false;

    const handle = (await kmd.initWalletHandle(defaultWallet.id, "")).wallet_handle_token;
    try {
      const keys = await kmd.listKeys(handle);
      const funderAddr = keys.addresses[0];
      if (!funderAddr) return false;

      const params = await getSuggestedParams();
      const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        sender: algosdk.Address.fromString(funderAddr),
        receiver: algosdk.Address.fromString(address),
        amount: BigInt(10_000_000),
        suggestedParams: params,
      });

      const signedTxn = await kmd.signTransaction(handle, "", txn);
      const signedBytes = new Uint8Array(signedTxn);
      await getAlgod().sendRawTransaction(signedBytes).do();
      sendLog("info", `Auto-funded ${address.substring(0, 8)}... with 10 ALGO via KMD`);
      return true;
    } finally {
      await kmd.releaseWalletHandle(handle).catch(() => {});
    }
  } catch {
    return false;
  }
}
