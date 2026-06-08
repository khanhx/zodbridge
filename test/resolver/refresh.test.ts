import { describe, expect, it, vi } from "vitest";
import { createResolver } from "../../src/resolver/createResolver.js";

interface Fields {
  orgId: string;
  org: { id: string; version: number };
}
interface Api {
  getOrg: () => Promise<{ id: string; version: number }>;
}

describe("refresh / invalidate — forced re-fetch from adapter", () => {
  it("refresh re-runs the resolver and returns the latest value", async () => {
    let version = 1;
    const getOrg = vi.fn(async () => ({ id: "o1", version: version++ }));
    const r = createResolver<Fields, Api>({
      adapter: { getOrg },
      resolvers: { org: (c) => c.adapter.getOrg() },
    });
    expect(await r.resolve("org")).toEqual({ id: "o1", version: 1 });
    expect(await r.resolve("org")).toEqual({ id: "o1", version: 1 }); // cached
    expect(getOrg).toHaveBeenCalledTimes(1);

    expect(await r.refresh("org")).toEqual({ id: "o1", version: 2 }); // re-fetched
    expect(getOrg).toHaveBeenCalledTimes(2);
    expect(await r.resolve("org")).toEqual({ id: "o1", version: 2 }); // re-cached
    expect(getOrg).toHaveBeenCalledTimes(2);
  });

  it("invalidate forces the next resolve to re-run; returns the context (chainable)", async () => {
    let version = 10;
    const getOrg = vi.fn(async () => ({ id: "o1", version: version++ }));
    const r = createResolver<Fields, Api>({
      adapter: { getOrg },
      resolvers: { org: (c) => c.adapter.getOrg() },
    });
    await r.resolve("org");
    const returned = r.invalidate("org");
    expect(returned).toBe(r); // chainable
    expect(await r.resolve("org")).toEqual({ id: "o1", version: 11 });
    expect(getOrg).toHaveBeenCalledTimes(2);
  });

  it("invalidate can drop multiple fields at once", async () => {
    const getOrg = vi.fn(async () => ({ id: "o1", version: 1 }));
    const r = createResolver<Fields, Api>({
      adapter: { getOrg },
      seed: { orgId: "o1" },
      resolvers: { org: (c) => c.adapter.getOrg() },
    });
    await r.resolve("org");
    r.invalidate("org", "orgId");
    expect(await r.resolve("org")).toEqual({ id: "o1", version: 1 });
    expect(getOrg).toHaveBeenCalledTimes(2);
  });

  it("invalidating a seeded field WITH a resolver prefers the resolver on refresh", async () => {
    const getOrg = vi.fn(async () => ({ id: "fresh", version: 99 }));
    const r = createResolver<Fields, Api>({
      adapter: { getOrg },
      seed: { org: { id: "stale", version: 1 } },
      resolvers: { org: (c) => c.adapter.getOrg() },
    });
    expect(await r.resolve("org")).toEqual({ id: "stale", version: 1 }); // seed first
    expect(getOrg).not.toHaveBeenCalled();
    expect(await r.refresh("org")).toEqual({ id: "fresh", version: 99 }); // resolver
    expect(getOrg).toHaveBeenCalledTimes(1);
  });

  it("invalidating a seed-only field (no resolver) falls back to seed again", async () => {
    const r = createResolver<Fields, Api>({
      adapter: {} as Api,
      seed: { orgId: "o1" },
    });
    expect(await r.resolve("orgId")).toBe("o1");
    expect(await r.refresh("orgId")).toBe("o1"); // no resolver -> re-reads seed
  });

  it("a resolver can invalidate + refresh a dependency via the bound context", async () => {
    let v = 0;
    const getOrg = vi.fn(async () => ({ id: "o1", version: ++v }));
    interface F {
      org: { id: string; version: number };
      latest: { id: string; version: number };
    }
    const r = createResolver<F, Api>({
      adapter: { getOrg },
      resolvers: {
        org: (c) => c.adapter.getOrg(),
        latest: async (c) => {
          await c.resolve("org"); // version 1, cached
          c.invalidate("org"); // bound-context invalidate
          return c.refresh("org"); // bound-context refresh -> version 2
        },
      },
    });
    expect(await r.resolve("latest")).toEqual({ id: "o1", version: 2 });
    expect(getOrg).toHaveBeenCalledTimes(2);
  });

  it("get peek returns undefined after invalidate (settled cleared)", async () => {
    const r = createResolver<Fields, Api>({
      adapter: { getOrg: async () => ({ id: "o1", version: 1 }) },
      resolvers: { org: (c) => c.adapter.getOrg() },
    });
    await r.resolve("org");
    expect(r.get("org")).toEqual({ id: "o1", version: 1 });
    r.invalidate("org");
    expect(r.get("org")).toBeUndefined();
  });
});
