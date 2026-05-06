import { sendStore, sendLoad, sendLog } from "./protocol.js";
import algosdk from "algosdk";
import {
  generateEphemeralKeyPair,
  publicKeyToBase64,
  base64ToPublicKey,
} from "@corvidlabs/ts-algochat";

export interface Identity {
  address: string;
  signingKey: Uint8Array; // ed25519 secret key for Algorand txns
  publicKey: Uint8Array;  // X25519 public key for encryption
  privateKey: Uint8Array; // X25519 private key for encryption
}

const IDENTITY_KEY = "identity-v2";

export async function getOrCreateIdentity(): Promise<Identity> {
  const existing = await loadIdentity();
  if (existing) return existing;

  const account = algosdk.generateAccount();
  const kp = generateEphemeralKeyPair();

  const identity: Identity = {
    address: account.addr.toString(),
    signingKey: account.sk,
    publicKey: kp.publicKey,
    privateKey: kp.privateKey,
  };

  sendStore(IDENTITY_KEY, JSON.stringify({
    address: identity.address,
    mnemonic: algosdk.secretKeyToMnemonic(account.sk),
    publicKey: publicKeyToBase64(identity.publicKey),
    privateKey: publicKeyToBase64(identity.privateKey),
  }));

  sendLog("info", `Memory identity created: ${identity.address.substring(0, 8)}...`);
  return identity;
}

async function loadIdentity(): Promise<Identity | null> {
  const raw = await sendLoad(IDENTITY_KEY);
  if (!raw) return null;
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
