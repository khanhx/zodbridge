import { describe, expect, it } from "vitest";
import {
  AsyncSchemaError,
  CodecError,
  LIMITS,
  bigintToString,
  dateToIso,
  entriesToArray,
  isoToDate,
  mapToEntries,
  stringToBigint,
} from "../../src/serialize/json-types.js";

describe("leaf transforms round-trip", () => {
  it("Date <-> ISO", () => {
    const d = new Date("2024-01-02T03:04:05.678Z");
    const iso = dateToIso(d, []);
    expect(iso).toBe("2024-01-02T03:04:05.678Z");
    expect(isoToDate(iso, []).getTime()).toBe(d.getTime());
  });

  it("BigInt <-> string", () => {
    const b = 9007199254740993n;
    const s = bigintToString(b, []);
    expect(s).toBe("9007199254740993");
    expect(stringToBigint(s, [])).toBe(b);
  });

  it("negative BigInt <-> string", () => {
    expect(stringToBigint(bigintToString(-42n, []), [])).toBe(-42n);
  });

  it("Map <-> entries", () => {
    const m = new Map<number, string>([
      [1, "a"],
      [2, "b"],
    ]);
    const entries = mapToEntries(m, []);
    expect(entries).toEqual([
      [1, "a"],
      [2, "b"],
    ]);
    const back = new Map(entriesToArray(entries, []) as Array<[number, string]>);
    expect(back).toEqual(m);
  });
});

describe("leaf transforms reject malformed input", () => {
  it("dateToIso rejects non-Date and invalid Date", () => {
    expect(() => dateToIso("x" as unknown as Date, [])).toThrow(CodecError);
    expect(() => dateToIso(new Date("nope"), [])).toThrow(CodecError);
  });

  it("isoToDate rejects non-string and invalid string", () => {
    expect(() => isoToDate(123, [])).toThrow(CodecError);
    expect(() => isoToDate("not-a-date", [])).toThrow(CodecError);
  });

  it("bigintToString rejects non-bigint", () => {
    expect(() => bigintToString(1 as unknown as bigint, [])).toThrow(CodecError);
  });

  it("stringToBigint rejects non-string, over-length, and malformed", () => {
    expect(() => stringToBigint(1, [])).toThrow(CodecError);
    expect(() =>
      stringToBigint("1".repeat(LIMITS.bigintStringLength + 1), []),
    ).toThrow(/exceeds/);
    expect(() => stringToBigint("12.3", [])).toThrow(/malformed/);
    expect(() => stringToBigint("abc", [])).toThrow(/malformed/);
  });

  it("mapToEntries rejects non-Map", () => {
    expect(() => mapToEntries([] as unknown as Map<unknown, unknown>, [])).toThrow(
      CodecError,
    );
  });

  it("entriesToArray rejects non-array, oversized, and malformed entries", () => {
    expect(() => entriesToArray({}, [])).toThrow(CodecError);
    const huge = { length: LIMITS.mapEntries + 1 } as unknown as unknown[];
    expect(() => entriesToArray(Array.from(huge), [])).toThrow(/exceed/);
    expect(() => entriesToArray([[1]], [])).toThrow(/malformed/);
    expect(() => entriesToArray(["x"], [])).toThrow(/malformed/);
  });
});

describe("error types", () => {
  it("CodecError includes path in message and exposes path array", () => {
    const err = new CodecError("boom", ["a", 0, "b"]);
    expect(err.message).toContain("a.0.b");
    expect(err.path).toEqual(["a", 0, "b"]);
    expect(err.name).toBe("CodecError");
  });

  it("CodecError without path has no location suffix", () => {
    expect(new CodecError("boom").message).toBe("boom");
  });

  it("AsyncSchemaError has a clear message", () => {
    const err = new AsyncSchemaError();
    expect(err.name).toBe("AsyncSchemaError");
    expect(err.message).toMatch(/sync-only/);
  });
});
