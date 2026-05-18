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

  test("3000-byte input produces 5 chunks of 600 bytes", () => {
    const v = "a".repeat(3000);
    const chunks = chunkValue(v);
    expect(chunks.length).toBe(5);
    for (const c of chunks) {
      expect(Buffer.byteLength(c, "utf-8")).toBeLessThanOrEqual(MAX_CLEARTEXT_PER_CHUNK);
    }
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
