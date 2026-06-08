import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { applyForwardRule, createMap } from "../../src/map/createMap.js";
import { fromResolver } from "../../src/map/rules.js";

describe("applyForwardRule (shared forward primitive)", () => {
  const src = { first: "Ada", last: "Lovelace", meta: { id: "x" } };
  it("undefined rule copies by dest key (dot-path aware)", () => {
    expect(applyForwardRule(undefined, "first", src)).toBe("Ada");
    expect(applyForwardRule(undefined, "meta.id", src)).toBe("x");
  });
  it("string rule renames", () => {
    expect(applyForwardRule("first", "fullName", src)).toBe("Ada");
  });
  it("pair rule uses `to`", () => {
    expect(applyForwardRule({ to: (s: typeof src) => s.last, from: () => "" }, "x", src)).toBe(
      "Lovelace",
    );
  });
  it("function rule computes", () => {
    expect(applyForwardRule((s: typeof src) => `${s.first} ${s.last}`, "x", src)).toBe(
      "Ada Lovelace",
    );
  });
  it("fromResolver rule yields undefined on the sync path", () => {
    expect(applyForwardRule(fromResolver("author"), "author", src)).toBeUndefined();
  });
});

describe("createMap.forward", () => {
  const destSchema = z.object({
    id: z.number(),
    fullName: z.string(),
    createdAt: z.string(),
  });

  const map = createMap(destSchema, {
    fullName: (s: { first: string; last: string }) => `${s.first} ${s.last}`,
    createdAt: "created_at",
  });

  it("builds a validated DTO via rename + computed + copy", () => {
    const dto = map.forward({
      id: 1,
      first: "Ada",
      last: "Lovelace",
      created_at: "2024-01-01",
    });
    expect(dto).toEqual({
      id: 1,
      fullName: "Ada Lovelace",
      createdAt: "2024-01-01",
    });
  });

  it("forward return type is inferred from the dest schema (bare literal, no `as const`)", () => {
    const dto = map.forward({ id: 1, first: "a", last: "b", created_at: "x" });
    expectTypeOf(dto).toEqualTypeOf<{ id: number; fullName: string; createdAt: string }>();
  });

  it("validates: invalid assembled DTO throws ZodError", () => {
    const m = createMap(z.object({ n: z.number() }), { n: (_s: unknown) => "nope" as never });
    expect(() => m.forward({})).toThrow(z.ZodError);
  });

  it("unmapped dest key is copied by matching name from source", () => {
    const m = createMap(z.object({ a: z.string(), b: z.number() }), { b: "count" });
    expect(m.forward({ a: "x", count: 5 })).toEqual({ a: "x", b: 5 });
  });

  it("optional dest field omitted when source missing (Zod optional applies)", () => {
    const m = createMap(z.object({ a: z.string(), note: z.string().optional() }), {});
    expect(m.forward({ a: "x" })).toEqual({ a: "x" });
  });

  it("nested dot-path rule maps correctly", () => {
    const m = createMap(z.object({ id: z.string() }), { id: "meta.id" });
    expect(m.forward({ meta: { id: "abc" } })).toEqual({ id: "abc" });
  });

  it("pair rule applies its `to` direction on forward", () => {
    const m = createMap(z.object({ cents: z.number() }), {
      cents: { to: (s: { dollars: number }) => s.dollars * 100, from: (v: number) => v / 100 },
    });
    expect(m.forward({ dollars: 3 })).toEqual({ cents: 300 });
  });

  it("forward skips a fromResolver field (left for the async path)", () => {
    const m = createMap(z.object({ a: z.string(), author: z.string().optional() }), {
      a: "src_a",
      author: fromResolver("author"),
    });
    expect(m.forward({ src_a: "x" })).toEqual({ a: "x" });
  });

  it("createMap defaults to an empty rule map", () => {
    const m = createMap(z.object({ a: z.string() }));
    expect(m.forward({ a: "x" })).toEqual({ a: "x" });
    expect(m.rules).toEqual({});
  });

  it("exposes frozen rules and raw shape", () => {
    expect(Object.isFrozen(map.rules)).toBe(true);
    expect(Object.keys(map.shape)).toEqual(["id", "fullName", "createdAt"]);
    expect(map.schema).toBe(destSchema);
  });
});
