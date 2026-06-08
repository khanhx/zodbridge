import { describe, expect, it, vi } from "vitest";
import { createResolver } from "../../src/resolver/createResolver.js";

interface Fields {
  org: { id: string };
  a: string;
  b: string;
}
interface Api {
  getOrg: () => Promise<{ id: string }>;
}

describe("memoization (concurrent)", () => {
  it("Promise.all over two fields sharing a dep fires the adapter exactly once", async () => {
    const getOrg = vi.fn(async () => {
      // Yield so a naive check-then-act cache would double-fetch.
      await new Promise((res) => setTimeout(res, 5));
      return { id: "o1" };
    });
    const r = createResolver<Fields, Api>({
      adapter: { getOrg },
      resolvers: {
        org: (ctx) => ctx.adapter.getOrg(),
        a: async (ctx) => (await ctx.resolve("org"))?.id,
        b: async (ctx) => (await ctx.resolve("org"))?.id,
      },
    });
    const results = await Promise.all([r.resolve("a"), r.resolve("b")]);
    expect(results[0]).toBe("o1");
    expect(results[1]).toBe("o1");
    expect(getOrg).toHaveBeenCalledTimes(1);
  });

  it("concurrent Promise.all over two fallback-using fields does NOT cross-contaminate", async () => {
    // Each field's resolver delegates to fallback for its own dep. Run both at
    // top level concurrently: each must retry ITS OWN field, not the other's.
    interface F {
      depA: string;
      depB: string;
      fa: string;
      fb: string;
    }
    interface Api {
      loadA: () => Promise<string>;
      loadB: () => Promise<string>;
    }
    const r = createResolver<F, Api>({
      adapter: {
        // async with a tick so the two resolvers genuinely interleave
        loadA: async () => {
          await new Promise((res) => setTimeout(res, 5));
          return "A";
        },
        loadB: async () => {
          await new Promise((res) => setTimeout(res, 5));
          return "B";
        },
      },
      resolvers: {
        // deps are resolver-backed (not seeded), so get() is initially empty and
        // each field MUST go through fallback to derive its value.
        depA: (ctx) => ctx.adapter.loadA(),
        depB: (ctx) => ctx.adapter.loadB(),
        fa: async (ctx) => {
          const d = ctx.get("depA");
          if (d) return `fa:${d}`;
          return ctx.fallback(["depA"]) as Promise<string>;
        },
        fb: async (ctx) => {
          const d = ctx.get("depB");
          if (d) return `fb:${d}`;
          return ctx.fallback(["depB"]) as Promise<string>;
        },
      },
    });
    const results = await Promise.all([r.resolve("fa"), r.resolve("fb")]);
    expect(results).toEqual(["fa:A", "fb:B"]);
  });

  it("concurrent resolve of the same field returns the identical pending promise", async () => {
    const getOrg = vi.fn(async () => ({ id: "o1" }));
    const r = createResolver<Fields, Api>({
      adapter: { getOrg },
      resolvers: { org: (ctx) => ctx.adapter.getOrg() },
    });
    const p1 = r.resolve("org");
    const p2 = r.resolve("org");
    expect(p1).toBe(p2);
    await Promise.all([p1, p2]);
    expect(getOrg).toHaveBeenCalledTimes(1);
  });
});
