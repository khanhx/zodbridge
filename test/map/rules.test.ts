import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ReverseKeyCollisionError, createMap } from "../../src/map/createMap.js";
import {
  fromResolver,
  getPath,
  isFnRule,
  isFromResolverRule,
  isPairRule,
  isStringRule,
  setPath,
  splitPath,
} from "../../src/map/rules.js";

describe("prototype-pollution guard", () => {
  it("setPath ignores __proto__ and does not pollute Object.prototype", () => {
    const target: Record<string, unknown> = {};
    setPath(target, "__proto__.isAdmin", true);
    expect(({} as Record<string, unknown>).isAdmin).toBeUndefined();
    expect(target.isAdmin).toBeUndefined();
  });

  it("setPath ignores constructor.prototype.x", () => {
    const target: Record<string, unknown> = {};
    setPath(target, "constructor.prototype.x", "pwned");
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });

  it("setPath ignores a forbidden key as a leaf segment", () => {
    const target: Record<string, unknown> = {};
    setPath(target, "prototype", "x");
    expect(Object.prototype.hasOwnProperty.call(target, "prototype")).toBe(false);
  });

  it("setPath ignores a forbidden intermediate without writing nested value", () => {
    const target: Record<string, unknown> = {};
    setPath(target, "a.__proto__.b", "x");
    expect(({} as Record<string, unknown>).b).toBeUndefined();
  });

  it("getPath returns undefined for forbidden segments", () => {
    expect(getPath({ a: 1 }, "__proto__")).toBeUndefined();
    expect(getPath({ a: 1 }, "constructor.x")).toBeUndefined();
  });

  it("the mapper's reverse cannot pollute the prototype via a malicious dest key", () => {
    const m = createMap(z.object({ ["__proto__.isAdmin"]: z.boolean() } as never), {
      ["__proto__.isAdmin"]: "evil",
    } as never);
    m.reverse({ ["__proto__.isAdmin"]: true } as never);
    expect(({} as Record<string, unknown>).isAdmin).toBeUndefined();
  });
});

describe("dot-path helpers", () => {
  it("getPath reads nested own properties", () => {
    expect(getPath({ a: { b: { c: 3 } } }, "a.b.c")).toBe(3);
    expect(getPath({ a: 1 }, "a")).toBe(1);
  });

  it("getPath returns undefined for missing/null/non-object segments", () => {
    expect(getPath({ a: null }, "a.b")).toBeUndefined();
    expect(getPath({ a: 5 }, "a.b")).toBeUndefined();
    expect(getPath(null, "a")).toBeUndefined();
    expect(getPath({}, "missing")).toBeUndefined();
  });

  it("setPath auto-vivifies intermediates and overwrites non-object intermediates", () => {
    const t: Record<string, unknown> = { a: 1 };
    setPath(t, "a.b", 2);
    expect(t).toEqual({ a: { b: 2 } });
    const t2: Record<string, unknown> = {};
    setPath(t2, "x.y.z", "deep");
    expect(t2).toEqual({ x: { y: { z: "deep" } } });
  });

  it("setPath reuses an existing object intermediate", () => {
    const t: Record<string, unknown> = { a: { keep: 1 } };
    setPath(t, "a.b", 2);
    expect(t).toEqual({ a: { keep: 1, b: 2 } });
  });

  it("splitPath splits on dots", () => {
    expect(splitPath("a.b.c")).toEqual(["a", "b", "c"]);
    expect(splitPath("plain")).toEqual(["plain"]);
  });
});

describe("rule type guards", () => {
  it("classifies string, fn, pair, and fromResolver rules", () => {
    const pair = { to: () => 1, from: () => 2 };
    const fr = fromResolver("author");
    expect(isStringRule("x")).toBe(true);
    expect(isFnRule(() => 1)).toBe(true);
    expect(isPairRule(pair)).toBe(true);
    expect(isFromResolverRule(fr)).toBe(true);

    // negatives
    expect(isStringRule(pair)).toBe(false);
    expect(isFnRule("x")).toBe(false);
    expect(isPairRule("x")).toBe(false);
    expect(isPairRule(null as never)).toBe(false);
    expect(isPairRule({ to: 1, from: 2 } as never)).toBe(false);
    expect(isFromResolverRule("x")).toBe(false);
    expect(isFromResolverRule(null as never)).toBe(false);
    expect(isFromResolverRule({ __kind: "other" } as never)).toBe(false);
  });

  it("fromResolver builds a marker with the field name", () => {
    expect(fromResolver("author")).toEqual({ __kind: "fromResolver", field: "author" });
  });
});

describe("build-time reverse-collision detection", () => {
  it("throws when two renames map back to the same source key", () => {
    expect(() =>
      createMap(z.object({ a: z.string(), b: z.string() }), {
        a: "same",
        b: "same",
      }),
    ).toThrow(ReverseKeyCollisionError);
  });

  it("allows distinct rename targets", () => {
    expect(() =>
      createMap(z.object({ a: z.string(), b: z.string() }), { a: "x", b: "y" }),
    ).not.toThrow();
  });
});
