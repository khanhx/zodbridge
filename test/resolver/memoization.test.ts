import { describe, expect, it, vi } from "vitest";
import { createResolver } from "../../src/resolver/createResolver.js";

interface Fields {
  orgId: string;
  org: { id: string; name: string };
  a: string;
  b: string;
  orphan: string;
}
interface Api {
  getOrg: (id: string) => Promise<{ id: string; name: string }>;
}

describe("memoization (sequential)", () => {
  it("a shared dependency's adapter call fires exactly once", async () => {
    const getOrg = vi.fn(async (id: string) => ({ id, name: "Acme" }));
    const r = createResolver<Fields, Api>({
      adapter: { getOrg },
      seed: { orgId: "o1" },
      resolvers: {
        org: (ctx) => ctx.adapter.getOrg(ctx.get("orgId") ?? ""),
        a: async (ctx) => (await ctx.resolve("org"))?.name ?? "",
        b: async (ctx) => (await ctx.resolve("org"))?.id ?? "",
      },
    });
    const out = await r.resolveMany("a", "b");
    expect(out).toEqual({ a: "Acme", b: "o1" });
    expect(getOrg).toHaveBeenCalledTimes(1);
  });

  it("cache survives inProgress.clear(): resolver fires once across two top-level calls", async () => {
    const fn = vi.fn(() => undefined);
    const r = createResolver<Fields, Api>({
      adapter: {} as Api,
      resolvers: { orphan: fn },
    });
    await r.resolveMany("orphan");
    await r.resolveMany("orphan");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("get peeks seed and resolved values; missing -> undefined", async () => {
    const r = createResolver<Fields, Api>({
      adapter: { getOrg: async (id) => ({ id, name: "X" }) },
      seed: { orgId: "o1" },
      resolvers: { org: (ctx) => ctx.adapter.getOrg("o1") },
    });
    expect(r.get("orgId")).toBe("o1");
    expect(r.get("org")).toBeUndefined();
    await r.resolve("org");
    expect(r.get("org")).toEqual({ id: "o1", name: "X" });
    expect(r.get("a")).toBeUndefined();
  });
});
