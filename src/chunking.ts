/**
 * Chunking for memories that don't fit in a single Algorand note.
 *
 * Algorand caps tx notes at 1024 bytes. The on-chain envelope is:
 *
 *   `{"type":"permanent-memory","key":"K","value":"<base64>","user":"<58>","created":"<24>","book":"K","page":N,"total":M}`
 *
 * JSON syntax + fixed field names take ~100 bytes. The Algorand
 * address is 58 chars. The ISO-8601 `created` timestamp is 24 chars.
 * The `book` field duplicates `key`, so its length is counted twice.
 * `page` + `total` integer fields take up to ~12 chars. That leaves
 * the encrypted base64 blob with:
 *
 *   1024 - 100 - 58 - 24 - (2 * keyLen) - 12 ≈ 830 - 2 * keyLen
 *
 * Base64 expands 4/3 and the crypto envelope adds 40 bytes (24-byte
 * nonce + 16-byte MAC), so for a 30-char key:
 *
 *   max base64 ≈ 830 - 60 = 770 chars
 *   max binary = 770 * 3/4 = 577 bytes
 *   max plaintext = 577 - 40 = 537 bytes
 *
 * `MAX_CLEARTEXT_PER_CHUNK = 480` is set conservatively below this
 * threshold because (a) keys can run up to ~100 chars in practice
 * (which matters since `book` doubles them), and (b) UTF-8 multi-byte
 * codepoints inflate byte count over JS string length.
 *
 * **The prior value of 600 was too generous**: real-world keys around
 * 30 chars produced envelopes that landed at ~1235 bytes — over the
 * 1024 cap — and `permanentSave`'s post-chunking assertion fired on
 * every multi-chunk write during a re-import of long memories from
 * the corvid-agent migration.
 *
 * On save: the caller decides whether to chunk. `chunkValue` splits
 * on a fixed byte boundary; chunks are reassembled in `joinChunks`
 * by sorting on `page` ascending.
 *
 * On recall: callers collect all txs/ASAs for a given key, group by
 * the save's `created` timestamp (one save = one book), require all
 * pages to be present, and concatenate.
 */

/**
 * Max plaintext bytes per chunk. See module docstring for the
 * derivation. Sized to keep the post-encryption envelope under 1024
 * bytes for keys up to ~120 chars (`book` field doubles the key).
 * `validateKey` caps at 256, so very long keys may still trigger
 * `permanentSave`'s 1024-byte assertion — but in practice we see
 * keys under 60 chars across corvid-agent's 1,000+ memory keyspace.
 */
export const MAX_CLEARTEXT_PER_CHUNK = 400;

/**
 * Split `value` into N chunks of at most `MAX_CLEARTEXT_PER_CHUNK`
 * bytes each. Operates on UTF-8 byte boundaries — if a multi-byte
 * codepoint straddles the cut, the chunk boundary is pushed back to
 * the prior codepoint start so we never produce invalid UTF-8.
 */
export function chunkValue(value: string): string[] {
  const bytes = Buffer.from(value, "utf-8");
  if (bytes.length <= MAX_CLEARTEXT_PER_CHUNK) return [value];

  const chunks: string[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    let end = Math.min(offset + MAX_CLEARTEXT_PER_CHUNK, bytes.length);
    // Walk back if we landed in the middle of a UTF-8 continuation byte
    // (0b10xxxxxx, i.e. (byte & 0xC0) === 0x80). We stop walking once
    // we hit a leading byte; this caps regression at 3 bytes.
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    chunks.push(bytes.slice(offset, end).toString("utf-8"));
    offset = end;
  }
  return chunks;
}

/**
 * Reassemble pages back into the original value. Caller is responsible
 * for passing the pages in correct order (page 1..N).
 */
export function joinChunks(chunks: string[]): string {
  return chunks.join("");
}

/** Heuristic: does this value need chunking? */
export function needsChunking(value: string): boolean {
  return Buffer.byteLength(value, "utf-8") > MAX_CLEARTEXT_PER_CHUNK;
}
