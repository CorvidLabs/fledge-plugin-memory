import {
  encryptMessage,
  decryptMessage,
  encodeEnvelope,
  decodeEnvelope,
} from "@corvidlabs/ts-algochat";
import type { Identity } from "./identity.js";

export function encryptValue(value: string, identity: Identity): string {
  const envelope = encryptMessage(value, identity.publicKey, identity.publicKey);
  const encoded = encodeEnvelope(envelope);
  return Buffer.from(encoded).toString("base64");
}

export function decryptValue(encrypted: string, identity: Identity): string {
  const bytes = new Uint8Array(Buffer.from(encrypted, "base64"));
  const envelope = decodeEnvelope(bytes);
  const result = decryptMessage(envelope, identity.privateKey, identity.publicKey);
  if (!result) throw new Error("Decryption failed");
  return result.text;
}
