import { test, expect, describe } from "bun:test";
import { __test } from "../src/permanent.js";

const { reassemble } = __test;

interface E {
  key: string;
  value: string;
  txid: string;
  created: string;
  round: number;
  tombstone: boolean;
  book?: string;
  page?: number;
  total?: number;
}

const ent = (over: Partial<E>): E => ({
  key: "k",
  value: "",
  txid: "tx",
  created: "2026-05-18T00:00:00Z",
  round: 1,
  tombstone: false,
  ...over,
});

describe("permanent reassemble", () => {
  test("legacy single-chunk entries pass through unchanged", () => {
    const input: E[] = [ent({ key: "a", value: "hello", round: 5 })];
    expect(reassemble(input)).toEqual(input);
  });

  test("tombstones pass through unchanged", () => {
    const input: E[] = [ent({ key: "a", tombstone: true, round: 10 })];
    expect(reassemble(input)).toEqual(input);
  });

  test("two pages with matching key+created are joined in page order", () => {
    const input: E[] = [
      ent({ key: "k", value: "World", round: 2, book: "k", page: 2, total: 2, txid: "tx2" }),
      ent({ key: "k", value: "Hello ", round: 1, book: "k", page: 1, total: 2, txid: "tx1" }),
    ];
    const out = reassemble(input);
    expect(out.length).toBe(1);
    expect(out[0].value).toBe("Hello World");
    expect(out[0].round).toBe(2); // max round across pages
    expect(out[0].total).toBe(2);
  });

  test("missing pages drop the whole record (not partial)", () => {
    // total=3 but only 2 pages present
    const input: E[] = [
      ent({ key: "k", value: "A", page: 1, total: 3 }),
      ent({ key: "k", value: "C", page: 3, total: 3 }),
    ];
    const out = reassemble(input);
    expect(out.length).toBe(0);
  });

  test("two separate saves of same key produce two reassembled records", () => {
    // Save 1 (older): 2 chunks
    // Save 2 (newer): 2 chunks at a different timestamp
    const input: E[] = [
      ent({ key: "k", value: "OldA", created: "2026-05-17T00:00:00Z", round: 1, page: 1, total: 2 }),
      ent({ key: "k", value: "OldB", created: "2026-05-17T00:00:00Z", round: 2, page: 2, total: 2 }),
      ent({ key: "k", value: "NewA", created: "2026-05-18T00:00:00Z", round: 5, page: 1, total: 2 }),
      ent({ key: "k", value: "NewB", created: "2026-05-18T00:00:00Z", round: 6, page: 2, total: 2 }),
    ];
    const out = reassemble(input);
    expect(out.length).toBe(2);
    // Both reassembled — caller's "latest by round" picks the newer one
    const values = out.map(e => e.value).sort();
    expect(values).toEqual(["NewANewB", "OldAOldB"]);
  });

  test("mixed single-chunk and multi-chunk entries are both preserved", () => {
    const input: E[] = [
      ent({ key: "single", value: "lonely" }),
      ent({ key: "multi", value: "X", page: 1, total: 2 }),
      ent({ key: "multi", value: "Y", page: 2, total: 2 }),
    ];
    const out = reassemble(input);
    expect(out.length).toBe(2);
    const byKey = Object.fromEntries(out.map(e => [e.key, e.value]));
    expect(byKey).toEqual({ single: "lonely", multi: "XY" });
  });

  test("page numbering must be contiguous 1..total — gap drops the record", () => {
    // total=3 but pages [1, 1, 3] — duplicate page 1, missing page 2
    const input: E[] = [
      ent({ key: "k", value: "A", page: 1, total: 3, txid: "t1" }),
      ent({ key: "k", value: "A'", page: 1, total: 3, txid: "t2" }),
      ent({ key: "k", value: "C", page: 3, total: 3, txid: "t3" }),
    ];
    const out = reassemble(input);
    expect(out.length).toBe(0);
  });
});
