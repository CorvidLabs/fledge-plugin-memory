/**
 * Chunking for memories that don't fit in a single Algorand note.
 *
 * Algorand caps tx notes at 1024 bytes. Subtract the JSON envelope
 * (~150 bytes with book/page/total fields) and the encryption layer
 * (envelope adds ~40 bytes, base64 inflates by 4/3) and you have
 * ~600 bytes of plaintext per chunk that reliably fit.
 *
 * On save: the caller decides whether to chunk. `chunkValue` splits on
 * a fixed byte boundary; chunks are reassembled in `joinChunks` by
 * sorting on `page` ascending.
 *
 * On recall: callers collect all txs/ASAs for a given key, group by the
 * save's `created` timestamp (one save = one book), require all pages
 * to be present, and concatenate.
 */

/**
 * Max plaintext bytes per chunk. Conservative — leaves headroom for
 * UTF-8 multi-byte expansion, envelope JSON, and the encryption
 * envelope overhead in `@corvidlabs/ts-algochat`.
 */
export const MAX_CLEARTEXT_PER_CHUNK = 600;

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
