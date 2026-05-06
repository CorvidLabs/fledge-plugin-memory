import { describe, it, expect } from "bun:test";
import {
  generateEphemeralKeyPair,
  encryptMessage,
  decryptMessage,
  encodeEnvelope,
  decodeEnvelope,
} from "@corvidlabs/ts-algochat";

describe("self-encryption round-trip", () => {
  it("encrypts and decrypts a message using the same keypair", () => {
    const kp = generateEphemeralKeyPair();
    const plaintext = "Hello, this is a test memory value!";

    const envelope = encryptMessage(plaintext, kp.publicKey, kp.publicKey);
    const encoded = encodeEnvelope(envelope);
    const decoded = decodeEnvelope(new Uint8Array(encoded));
    const result = decryptMessage(decoded, kp.privateKey, kp.publicKey);

    expect(result).not.toBeNull();
    expect(result!.text).toBe(plaintext);
  });

  it("handles empty string", () => {
    const kp = generateEphemeralKeyPair();

    const envelope = encryptMessage("", kp.publicKey, kp.publicKey);
    const encoded = encodeEnvelope(envelope);
    const decoded = decodeEnvelope(new Uint8Array(encoded));
    const result = decryptMessage(decoded, kp.privateKey, kp.publicKey);

    expect(result).not.toBeNull();
    expect(result!.text).toBe("");
  });

  it("handles unicode content", () => {
    const kp = generateEphemeralKeyPair();
    const plaintext = "Encrypted memory: 🔐 日本語 العربية";

    const envelope = encryptMessage(plaintext, kp.publicKey, kp.publicKey);
    const encoded = encodeEnvelope(envelope);
    const decoded = decodeEnvelope(new Uint8Array(encoded));
    const result = decryptMessage(decoded, kp.privateKey, kp.publicKey);

    expect(result).not.toBeNull();
    expect(result!.text).toBe(plaintext);
  });

  it("handles values near max payload size", () => {
    const kp = generateEphemeralKeyPair();
    const plaintext = "x".repeat(800);

    const envelope = encryptMessage(plaintext, kp.publicKey, kp.publicKey);
    const encoded = encodeEnvelope(envelope);
    const decoded = decodeEnvelope(new Uint8Array(encoded));
    const result = decryptMessage(decoded, kp.privateKey, kp.publicKey);

    expect(result).not.toBeNull();
    expect(result!.text).toBe(plaintext);
  });

  it("fails to decrypt with wrong key", () => {
    const kp1 = generateEphemeralKeyPair();
    const kp2 = generateEphemeralKeyPair();
    const plaintext = "secret data";

    const envelope = encryptMessage(plaintext, kp1.publicKey, kp1.publicKey);
    const encoded = encodeEnvelope(envelope);
    const decoded = decodeEnvelope(new Uint8Array(encoded));

    let result: ReturnType<typeof decryptMessage> | null = null;
    try {
      result = decryptMessage(decoded, kp2.privateKey, kp2.publicKey);
    } catch {
      result = null;
    }

    expect(result).toBeNull();
  });

  it("produces different ciphertext for same plaintext", () => {
    const kp = generateEphemeralKeyPair();
    const plaintext = "same message";

    const env1 = encryptMessage(plaintext, kp.publicKey, kp.publicKey);
    const env2 = encryptMessage(plaintext, kp.publicKey, kp.publicKey);
    const enc1 = Buffer.from(encodeEnvelope(env1)).toString("base64");
    const enc2 = Buffer.from(encodeEnvelope(env2)).toString("base64");

    expect(enc1).not.toBe(enc2);
  });
});
