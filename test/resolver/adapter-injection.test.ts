import { describe, expect, expectTypeOf, it } from "vitest";
import { createResolver } from "../../src/resolver/createResolver.js";

interface CustomAdapter {
  getX: (n: number) => Promise<string>;
  label: string;
}

describe("adapter injection + typing", () => {
  it("resolver reaches ctx.adapter with the correct static type", async () => {
    interface Fields {
      value: string;
    }
    const r = createResolver<Fields, CustomAdapter>({
      adapter: { getX: async (n) => `x${n}`, label: "lbl" },
      resolvers: {
        value: (ctx) => {
          expectTypeOf(ctx.adapter).toEqualTypeOf<CustomAdapter>();
          return ctx.adapter.getX(7);
        },
      },
    });
    expect(await r.resolve("value")).toBe("x7");
    expect(r.adapter.label).toBe("lbl");
  });

  it("resolveMany returns only the requested keys (typed Partial<Pick>)", async () => {
    interface Fields {
      a: string;
      b: number;
      c: boolean;
    }
    const r = createResolver<Fields, object>({
      adapter: {},
      seed: { a: "x", b: 2, c: true },
    });
    const out = await r.resolveMany("a", "b");
    expect(out).toEqual({ a: "x", b: 2 });
    expect("c" in out).toBe(false);
    expectTypeOf(out).toEqualTypeOf<Partial<Pick<Fields, "a" | "b">>>();
  });

  it("a resolver can call ctx.resolveMany on the bound context", async () => {
    interface Fields {
      x: string;
      y: string;
      combined: string;
    }
    const r = createResolver<Fields, object>({
      adapter: {},
      seed: { x: "1", y: "2" },
      resolvers: {
        combined: async (ctx) => {
          const { x, y } = await ctx.resolveMany("x", "y");
          return `${x}-${y}`;
        },
      },
    });
    expect(await r.resolve("combined")).toBe("1-2");
  });

  it("resolveMany omits keys that resolve to undefined", async () => {
    interface Fields {
      a: string;
      missing: string;
    }
    const r = createResolver<Fields, object>({ adapter: {}, seed: { a: "x" } });
    const out = await r.resolveMany("a", "missing");
    expect(out).toEqual({ a: "x" });
  });

  it("path peeks nested seed; returns base when keyPath empty; undefined when absent", async () => {
    interface Fields {
      conv: { meta: { id: string } };
      flat: string;
    }
    const r = createResolver<Fields, object>({
      adapter: {},
      seed: { conv: { meta: { id: "z" } }, flat: "f" },
    });
    expect(r.path("conv", ["meta", "id"])).toBe("z");
    expect(r.path("flat", [])).toBe("f");
    expect(r.path("conv", ["nope"])).toBeUndefined();
    // absent field with a non-empty keyPath -> base undefined -> undefined
    expect(r.path("absent" as never, ["x"])).toBeUndefined();
    // absent field with empty keyPath -> undefined
    expect(r.path("absent" as never, [])).toBeUndefined();
  });
});
