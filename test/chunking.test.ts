import { test, expect, describe } from "bun:test";
import { chunkValue, joinChunks, needsChunking, MAX_CLEARTEXT_PER_CHUNK } from "../src/chunking.js";

describe("chunkValue", () => {
  test("short input returns a single chunk", () => {
    const v = "hello world";
    const chunks = chunkValue(v);
    expect(chunks).toEqual([v]);
  });

  test("input at exactly MAX_CLEARTEXT_PER_CHUNK returns single chunk", () => {
    const v = "a".repeat(MAX_CLEARTEXT_PER_CHUNK);
    const chunks = chunkValue(v);
    expect(chunks.length).toBe(1);
    expect(chunks[0].length).toBe(MAX_CLEARTEXT_PER_CHUNK);
  });

  test("input one byte over the limit produces two chunks", () => {
    const v = "a".repeat(MAX_CLEARTEXT_PER_CHUNK + 1);
    const chunks = chunkValue(v);
    expect(chunks.length).toBe(2);
    expect(chunks[0].length).toBe(MAX_CLEARTEXT_PER_CHUNK);
    expect(chunks[1].length).toBe(1);
  });

  test("3000-byte input chunks all fit under the cap", () => {
    // Don't hard-code the chunk count — it depends on MAX_CLEARTEXT_PER_CHUNK
    // which moves over time as we tune envelope headroom. The invariant
    // is that (a) every chunk fits, (b) the count is the ceiling of
    // total / MAX, and (c) round-trip preserves content.
    const v = "a".repeat(3000);
    const chunks = chunkValue(v);
    const expectedCount = Math.ceil(3000 / MAX_CLEARTEXT_PER_CHUNK);
    expect(chunks.length).toBe(expectedCount);
    for (const c of chunks) {
      expect(Buffer.byteLength(c, "utf-8")).toBeLessThanOrEqual(MAX_CLEARTEXT_PER_CHUNK);
    }
    expect(joinChunks(chunks)).toBe(v);
  });

  test("round-trip: chunkValue → joinChunks preserves ASCII content", () => {
    const v = "x".repeat(2500);
    expect(joinChunks(chunkValue(v))).toBe(v);
  });

  test("multi-byte UTF-8 codepoints are never split mid-character", () => {
    // 🌟 is 4 bytes in UTF-8. Repeat enough to span chunk boundaries.
    const v = "🌟".repeat(200); // 800 bytes
    const chunks = chunkValue(v);
    for (const c of chunks) {
      // Decoding shouldn't throw or insert U+FFFD replacement chars.
      const decoded = Buffer.from(c, "utf-8").toString("utf-8");
      expect(decoded).toBe(c);
      expect(decoded).not.toContain("�");
    }
    expect(joinChunks(chunks)).toBe(v);
  });

  test("round-trip preserves mixed ASCII + emoji + CJK + accented", () => {
    const segment = "Hello 世界 ñoño 🚀 — مرحبا — ";
    const v = segment.repeat(60);
    expect(joinChunks(chunkValue(v))).toBe(v);
  });

  test("empty string returns one empty chunk", () => {
    expect(chunkValue("")).toEqual([""]);
  });
});

describe("needsChunking", () => {
  test("short ASCII does not need chunking", () => {
    expect(needsChunking("hello")).toBe(false);
  });

  test("input at boundary does not need chunking", () => {
    expect(needsChunking("a".repeat(MAX_CLEARTEXT_PER_CHUNK))).toBe(false);
  });

  test("input over boundary needs chunking", () => {
    expect(needsChunking("a".repeat(MAX_CLEARTEXT_PER_CHUNK + 1))).toBe(true);
  });

  test("UTF-8 multi-byte expansion can push a short string over", () => {
    // 200 emoji = 800 bytes (each is 4 bytes UTF-8)
    expect(needsChunking("🌟".repeat(200))).toBe(true);
    // But the same JS .length is 400, well under MAX
    expect("🌟".repeat(200).length).toBe(400);
  });
});

describe("envelope-fits invariant", () => {
  /**
   * Regression: the previous MAX_CLEARTEXT_PER_CHUNK = 600 produced
   * envelopes that exceeded Algorand's 1024-byte note cap. This
   * test simulates the actual envelope shape used in `permanentSave`
   * with realistic key lengths and asserts each chunked envelope
   * fits well under 1024.
   *
   * The simulated envelope uses an inflated base64 length that
   * approximates `@corvidlabs/ts-algochat`'s encryption: each
   * chunk's plaintext expands to roughly `ceil((plaintext + 40) * 4 / 3)`
   * base64 chars.
   */
  function simulateEnvelopeBytes(key: string, chunkPlaintextBytes: number): number {
    const encryptedBinary = chunkPlaintextBytes + 40; // 24 nonce + 16 MAC
    const base64Len = Math.ceil(encryptedBinary / 3) * 4;
    const envelope = JSON.stringify({
      type: "permanent-memory",
      key,
      value: "X".repeat(base64Len),
      user: "X".repeat(58),
      created: "2026-05-18T23:55:34.123Z",
      book: key,
      page: 999,
      total: 999,
    });
    return Buffer.byteLength(envelope, "utf-8");
  }

  test("envelope fits 1024 bytes for typical 30-char key", () => {
    const key = "x".repeat(30);
    const envBytes = simulateEnvelopeBytes(key, MAX_CLEARTEXT_PER_CHUNK);
    expect(envBytes).toBeLessThanOrEqual(1024);
  });

  test("envelope fits 1024 bytes for 60-char key", () => {
    const key = "x".repeat(60);
    const envBytes = simulateEnvelopeBytes(key, MAX_CLEARTEXT_PER_CHUNK);
    expect(envBytes).toBeLessThanOrEqual(1024);
  });

  test("envelope fits 1024 bytes for 100-char key", () => {
    const key = "x".repeat(100);
    const envBytes = simulateEnvelopeBytes(key, MAX_CLEARTEXT_PER_CHUNK);
    expect(envBytes).toBeLessThanOrEqual(1024);
  });
});
