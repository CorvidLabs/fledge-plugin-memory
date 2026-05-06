import { sendExec, sendLog } from "./protocol.js";
import algosdk from "algosdk";
import {
  generateEphemeralKeyPair,
  publicKeyToBase64,
  base64ToPublicKey,
} from "@corvidlabs/ts-algochat";

export interface Identity {
  address: string;
  signingKey: Uint8Array;
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

let projectRoot = ".";
let cachedIdentity: Identity | null = null;

export function initIdentityStorage(root: string): void {
  projectRoot = root;
}

function identityFilePath(): string {
  return `${projectRoot}/.fledge/memory-identity.json`;
}

export async function getOrCreateIdentity(): Promise<Identity> {
  if (cachedIdentity) return cachedIdentity;

  const existing = await loadIdentity();
  if (existing) {
    cachedIdentity = existing;
    return existing;
  }

  const account = algosdk.generateAccount();
  const kp = generateEphemeralKeyPair();

  const identity: Identity = {
    address: account.addr.toString(),
    signingKey: account.sk,
    publicKey: kp.publicKey,
    privateKey: kp.privateKey,
  };

  const data = JSON.stringify({
    address: identity.address,
    mnemonic: algosdk.secretKeyToMnemonic(account.sk),
    publicKey: publicKeyToBase64(identity.publicKey),
    privateKey: publicKeyToBase64(identity.privateKey),
  }, null, 2);

  const escaped = data.replace(/\\/g, "\\\\").replace(/'/g, "'\\''");
  const filePath = identityFilePath();
  await sendExec(`mkdir -p '${projectRoot}/.fledge' && printf '%s' '${escaped}' > '${filePath}' && chmod 600 '${filePath}'`);

  sendLog("info", `Memory identity created: ${identity.address.substring(0, 8)}...`);
  cachedIdentity = identity;
  return identity;
}

async function loadIdentity(): Promise<Identity | null> {
  const filePath = identityFilePath();
  const result = await sendExec(`cat '${filePath}' 2>/dev/null || echo 'null'`);
  const raw = result.stdout.trim();
  if (!raw || raw === "null") return null;
  try {
    const data = JSON.parse(raw);
    const account = algosdk.mnemonicToSecretKey(data.mnemonic);
    return {
      address: data.address,
      signingKey: account.sk,
      publicKey: base64ToPublicKey(data.publicKey),
      privateKey: base64ToPublicKey(data.privateKey),
    };
  } catch {
    return null;
  }
}
