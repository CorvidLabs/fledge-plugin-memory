import algosdk from "algosdk";
import { sendLog } from "./protocol.js";

const DEFAULT_ALGOD_URL = "http://localhost:4001";
const DEFAULT_ALGOD_TOKEN = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const DEFAULT_INDEXER_URL = "http://localhost:8980";

function getAlgodConfig(): { url: string; token: string } {
  const url = process.env.ALGOD_URL ?? DEFAULT_ALGOD_URL;
  const token = process.env.ALGOD_TOKEN ?? DEFAULT_ALGOD_TOKEN;
  return { url, token };
}

function getIndexerConfig(): { url: string; token: string } {
  const url = process.env.INDEXER_URL ?? DEFAULT_INDEXER_URL;
  const token = process.env.ALGOD_TOKEN ?? DEFAULT_ALGOD_TOKEN;
  return { url, token };
}

let algodClient: algosdk.Algodv2 | null = null;
let indexerClient: algosdk.Indexer | null = null;

export function getAlgod(): algosdk.Algodv2 {
  if (!algodClient) {
    const { url, token } = getAlgodConfig();
    const parsedUrl = new URL(url);
    const port = parsedUrl.port || (parsedUrl.protocol === "https:" ? "443" : "80");
    const baseUrl = `${parsedUrl.protocol}//${parsedUrl.hostname}`;
    algodClient = new algosdk.Algodv2(token, baseUrl, port);
  }
  return algodClient;
}

export function getIndexer(): algosdk.Indexer {
  if (!indexerClient) {
    const { url, token } = getIndexerConfig();
    const parsedUrl = new URL(url);
    const port = parsedUrl.port || (parsedUrl.protocol === "https:" ? "443" : "80");
    const baseUrl = `${parsedUrl.protocol}//${parsedUrl.hostname}`;
    indexerClient = new algosdk.Indexer(token, baseUrl, port);
  }
  return indexerClient;
}

export async function checkAlgod(): Promise<boolean> {
  try {
    const algod = getAlgod();
    await algod.status().do();
    return true;
  } catch {
    return false;
  }
}

export async function getSuggestedParams(): Promise<algosdk.SuggestedParams> {
  const algod = getAlgod();
  return await algod.getTransactionParams().do();
}

export async function submitAndWait(signedTxn: Uint8Array): Promise<string> {
  const algod = getAlgod();
  const { txid } = await algod.sendRawTransaction(signedTxn).do();
  await algosdk.waitForConfirmation(algod, txid, 4);
  return txid;
}
