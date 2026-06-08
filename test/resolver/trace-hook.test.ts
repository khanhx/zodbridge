import { describe, expect, it, vi } from "vitest";
import { createResolver } from "../../src/resolver/createResolver.js";

interface Fields {
  orgId: string;
  org: { id: string };
}
interface Api {
  getOrg: () => Promise<{ id: string }>;
}

describe("onResolve trace hook", () => {
  it("fires after a resolver field settles (with field + value)", async () => {
    const onResolve = vi.fn();
    const r = createResolver<Fields, Api>({
      adapter: { getOrg: async () => ({ id: "o1" }) },
      resolvers: { org: (c) => c.adapter.getOrg() },
      onResolve,
    });
    await r.resolve("org");
    expect(onResolve).toHaveBeenCalledWith("org", { id: "o1" });
  });

  it("does NOT fire for seed or terminal-undefined values", async () => {
    const onResolve = vi.fn();
    const r = createResolver<Fields, Api>({
      adapter: {} as Api,
      seed: { orgId: "o1" },
      onResolve,
    });
    await r.resolve("orgId"); // seed
    await r.resolve("org"); // terminal undefined (no resolver)
    expect(onResolve).not.toHaveBeenCalled();
  });

  it("a throwing observer does not break resolution (best-effort)", async () => {
    const r = createResolver<Fields, Api>({
      adapter: { getOrg: async () => ({ id: "o1" }) },
      resolvers: { org: (c) => c.adapter.getOrg() },
      onResolve: () => {
        throw new Error("observer boom");
      },
    });
    expect(await r.resolve("org")).toEqual({ id: "o1" });
  });

  it("no hook configured is a no-op", async () => {
    const r = createResolver<Fields, Api>({
      adapter: { getOrg: async () => ({ id: "o1" }) },
      resolvers: { org: (c) => c.adapter.getOrg() },
    });
    expect(await r.resolve("org")).toEqual({ id: "o1" });
  });
});
