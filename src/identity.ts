import { sendExec, sendStore, sendLoad, sendLog } from "./protocol.js";
import {
  generateEphemeralKeyPair,
  publicKeyToBase64,
  base64ToPublicKey,
} from "@corvidlabs/ts-algochat";

export interface Identity {
  address: string;
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

const IDENTITY_KEY = "identity";

export async function getOrCreateIdentity(): Promise<Identity> {
  const existing = await loadIdentity();
  if (existing) return existing;

  const address = await resolveAddress();
  const kp = generateEphemeralKeyPair();

  const identity: Identity = {
    address,
    publicKey: kp.publicKey,
    privateKey: kp.privateKey,
  };

  sendStore(IDENTITY_KEY, JSON.stringify({
    address: identity.address,
    publicKey: publicKeyToBase64(identity.publicKey),
    privateKey: publicKeyToBase64(identity.privateKey),
  }));

  sendLog("info", `Memory identity created for ${address}`);
  return identity;
}

async function loadIdentity(): Promise<Identity | null> {
  const raw = await sendLoad(IDENTITY_KEY);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    return {
      address: data.address,
      publicKey: base64ToPublicKey(data.publicKey),
      privateKey: base64ToPublicKey(data.privateKey),
    };
  } catch {
    return null;
  }
}

async function resolveAddress(): Promise<string> {
  const result = await sendExec("goal account list 2>/dev/null | head -1 | awk '{print $2}'");
  if (result.code === 0 && result.stdout.trim()) {
    return result.stdout.trim();
  }
  return "local-" + Math.random().toString(36).substring(2, 10);
}
