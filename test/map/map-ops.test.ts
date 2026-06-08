import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createMap } from "../../src/map/createMap.js";
import { forwardMany, reverseMany, safeForward } from "../../src/map/map-ops.js";
import { compose, omit, pick } from "../../src/map/map-views.js";
import { withDefault } from "../../src/map/rules.js";

const UserDto = z.object({ id: z.number(), name: z.string() });
const userMap = createMap(UserDto, { name: "full_name" });

describe("forwardMany / reverseMany (batch)", () => {
  it("forwardMany maps a list", () => {
    const out = userMap.forwardMany([
      { id: 1, full_name: "Ada" },
      { id: 2, full_name: "Alan" },
    ]);
    expect(out).toEqual([
      { id: 1, name: "Ada" },
      { id: 2, name: "Alan" },
    ]);
  });
  it("reverseMany inverts a list", () => {
    expect(userMap.reverseMany([{ id: 1, name: "Ada" }])).toEqual([{ full_name: "Ada" }]);
  });
  it("standalone forwardMany/reverseMany work too", () => {
    expect(forwardMany(userMap, [{ id: 1, full_name: "x" }])).toEqual([{ id: 1, name: "x" }]);
    expect(reverseMany(userMap, [{ id: 1, name: "x" }])).toEqual([{ full_name: "x" }]);
  });
});

describe("safeForward (non-throwing)", () => {
  it("returns success with data on valid input", () => {
    const r = userMap.safeForward({ id: 1, full_name: "Ada" });
    expect(r).toEqual({ success: true, data: { id: 1, name: "Ada" } });
  });
  it("returns failure with the ZodError on invalid input", () => {
    const r = userMap.safeForward({ id: "nope", full_name: "Ada" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toBeInstanceOf(z.ZodError);
  });
  it("standalone safeForward works", () => {
    expect(safeForward(userMap, { id: 1, full_name: "x" }).success).toBe(true);
  });
  it("re-throws non-Zod errors", () => {
    const boom = createMap(z.object({ x: z.number() }), {
      x: () => {
        throw new Error("not zod");
      },
    });
    expect(() => boom.safeForward({})).toThrow("not zod");
  });
});

describe("pick / omit (sub-DTO views)", () => {
  const full = createMap(z.object({ id: z.number(), name: z.string(), secret: z.string() }));
  it("pick keeps only chosen keys", () => {
    const view = pick(full, ["id", "name"]);
    expect(view.forward({ id: 1, name: "Ada", secret: "x" })).toEqual({ id: 1, name: "Ada" });
  });
  it("omit drops chosen keys", () => {
    const view = omit(full, ["secret"]);
    expect(view.forward({ id: 1, name: "Ada", secret: "x" })).toEqual({ id: 1, name: "Ada" });
  });
  it("pick ignores unknown keys", () => {
    const view = pick(full, ["id", "nope"]);
    expect(Object.keys(view.shape)).toEqual(["id"]);
  });
});

describe("compose (DTO -> DTO pipeline)", () => {
  it("forwards through both maps in order", () => {
    const a = createMap(z.object({ celsius: z.number() }), { celsius: "c" });
    const b = createMap(z.object({ fahrenheit: z.number() }), {
      fahrenheit: (s: { celsius: number }) => s.celsius * 1.8 + 32,
    });
    const cToF = compose(a, b);
    expect(cToF.forward({ c: 100 })).toEqual({ fahrenheit: 212 });
  });
  it("reverse pipes back through both (each map's rules honored)", () => {
    // a: source.raw -> mid.m ;  b: mid.m -> dto.x
    const a = createMap(z.object({ m: z.number() }), { m: "raw" });
    const b = createMap(z.object({ x: z.number() }), { x: "m" });
    const composed = compose(a, b);
    // reverse: dto.x -> b.reverse -> { m } -> a.reverse -> { raw }
    expect(composed.reverse({ x: 5 })).toEqual({ raw: 5 });
  });

  it("derived ops (forwardMany/safeForward/reverseMany) honor the composed pipeline", () => {
    const a = createMap(z.object({ celsius: z.number() }), { celsius: "c" });
    const b = createMap(z.object({ fahrenheit: z.number() }), {
      fahrenheit: (s: { celsius: number }) => s.celsius * 1.8 + 32,
    });
    const cToF = compose(a, b);
    // would be wrong if derived ops bypassed the pipeline (base identity)
    expect(cToF.forwardMany([{ c: 0 }, { c: 100 }])).toEqual([
      { fahrenheit: 32 },
      { fahrenheit: 212 },
    ]);
    expect(cToF.safeForward({ c: 100 })).toEqual({ success: true, data: { fahrenheit: 212 } });

    // reverseMany over the composed pipeline (both maps' rules honored)
    const a2 = createMap(z.object({ m: z.number() }), { m: "raw" });
    const b2 = createMap(z.object({ x: z.number() }), { x: "m" });
    expect(compose(a2, b2).reverseMany([{ x: 5 }, { x: 9 }])).toEqual([
      { raw: 5 },
      { raw: 9 },
    ]);
  });

  it("toResolver throws on a composed map (no declared graph)", () => {
    const composed = compose(createMap(z.object({ x: z.number() })), createMap(z.object({ x: z.number() })));
    expect(() => composed.toResolver({})).toThrow();
  });
});

describe("withDefault rule", () => {
  it("uses source value when present, default when missing", () => {
    const m = createMap(z.object({ role: z.string(), tier: z.number() }), {
      role: withDefault("member", "user_role"),
      tier: withDefault(0),
    });
    expect(m.forward({ user_role: "admin", tier: 5 })).toEqual({ role: "admin", tier: 5 });
    expect(m.forward({})).toEqual({ role: "member", tier: 0 });
  });
  it("reverses by round-tripping the read key (default dropped)", () => {
    const m = createMap(z.object({ role: z.string() }), {
      role: withDefault("member", "user_role"),
    });
    expect(m.reverse({ role: "admin" })).toEqual({ user_role: "admin" });
  });
  it("reverse without a source key round-trips the dest key", () => {
    const m = createMap(z.object({ tier: z.number() }), { tier: withDefault(0) });
    expect(m.reverse({ tier: 3 })).toEqual({ tier: 3 });
  });
});
