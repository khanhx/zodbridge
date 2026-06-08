import { describe, expect, it } from "vitest";
import { z } from "zod";
import { OneWayRuleError, createMap } from "../../src/map/createMap.js";

describe("createMap.reverse", () => {
  it("round-trips string-rename rules", () => {
    const m = createMap(z.object({ createdAt: z.string(), id: z.number() }), {
      createdAt: "created_at",
      id: "user_id",
    });
    const dto = m.forward({ created_at: "2024", user_id: 7 });
    expect(m.reverse(dto)).toEqual({ created_at: "2024", user_id: 7 });
  });

  it("reverses a { to, from } pair rule cleanly", () => {
    const m = createMap(z.object({ cents: z.number() }), {
      cents: { to: (s: { cents: number }) => s.cents, from: (v: number) => v / 100 },
    });
    expect(m.reverse({ cents: 500 })).toEqual({ cents: 5 });
  });

  it("emits only mapped fields (unmapped dest keys absent)", () => {
    const m = createMap(z.object({ a: z.string(), b: z.string() }), { a: "src_a" });
    const out = m.reverse({ a: "x", b: "y" });
    expect(out).toEqual({ src_a: "x" });
    expect("b" in out).toBe(false);
  });

  it("throws OneWayRuleError for an un-paired function rule", () => {
    const m = createMap(z.object({ full: z.string() }), {
      full: (s: { first: string }) => s.first,
    });
    expect(() => m.reverse({ full: "Ada" })).toThrow(OneWayRuleError);
    try {
      m.reverse({ full: "Ada" });
    } catch (e) {
      expect((e as OneWayRuleError).key).toBe("full");
    }
  });

  it("skips fromResolver-backed fields on reverse", () => {
    const m = createMap(z.object({ a: z.string(), author: z.string() }), {
      a: "src_a",
      author: { __kind: "fromResolver", field: "author" },
    });
    // author has no source inverse; only the rename is emitted.
    expect(m.reverse({ a: "x", author: "Ada" })).toEqual({ src_a: "x" });
  });

  it("skips a dest key whose rule value is explicitly undefined", () => {
    const m = createMap(z.object({ a: z.string(), b: z.string() }), {
      a: "src_a",
      b: undefined,
    });
    expect(m.reverse({ a: "x", b: "y" })).toEqual({ src_a: "x" });
  });

  it("reverses nested dot-path rename", () => {
    const m = createMap(z.object({ id: z.string() }), { id: "meta.id" });
    expect(m.reverse({ id: "abc" })).toEqual({ meta: { id: "abc" } });
  });
});
