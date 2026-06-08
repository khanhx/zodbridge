import { describe, expect, it, vi } from "vitest";
import { createResolver } from "../../src/resolver/createResolver.js";

describe("multi-source fallback", () => {
  it("derives a field from a nested seed path with NO adapter call", async () => {
    interface Fields {
      conversation: { metadata: { reservationId: string } };
      reservationId: string;
    }
    const adapter = { fetch: vi.fn() };
    const r = createResolver<Fields, typeof adapter>({
      adapter,
      seed: {
        conversation: { metadata: { reservationId: "r-42" } },
      },
      resolvers: {
        reservationId: (ctx) =>
          (ctx.path("conversation", ["metadata", "reservationId"]) as string) ??
          (ctx.fallback(["conversation"]) as never),
      },
    });
    expect(await r.resolve("reservationId")).toBe("r-42");
    expect(adapter.fetch).not.toHaveBeenCalled();
  });

  it("C1: a fallback-delegating field resolves to its REAL value, not undefined", async () => {
    // seed has conversationId but NOT chatter. `platform` needs chatter.platform;
    // it delegates to fallback(['chatter']); chatter resolves via conversationId.
    interface Fields {
      conversationId: string;
      chatter: { platform: string };
      platform: string;
    }
    interface Api {
      getChatter: (conversationId: string) => Promise<{ platform: string }>;
    }
    const getChatter = vi.fn(async (id: string) => ({ platform: `web:${id}` }));
    const r = createResolver<Fields, Api>({
      adapter: { getChatter },
      seed: { conversationId: "c1" },
      resolvers: {
        chatter: async (ctx) => {
          const id = ctx.get("conversationId");
          return id ? ctx.adapter.getChatter(id) : undefined;
        },
        platform: async (ctx) => {
          const chatter = ctx.get("chatter");
          if (chatter) return chatter.platform;
          return ctx.fallback(["chatter"]) as Promise<string>;
        },
      },
    });
    expect(await r.resolve("platform")).toBe("web:c1");
    expect(getChatter).toHaveBeenCalledTimes(1);
  });

  it("fallback returns undefined when no dep produced a value", async () => {
    interface Fields {
      missing: string;
      target: string;
    }
    const r = createResolver<Fields, object>({
      adapter: {},
      resolvers: {
        target: (ctx) => ctx.fallback(["missing"]) as Promise<string>,
      },
    });
    expect(await r.resolve("target")).toBeUndefined();
  });

  it("fallback called outside any resolver (no current field) returns undefined", async () => {
    interface Fields {
      a: string;
    }
    const r = createResolver<Fields, object>({
      adapter: {},
      seed: { a: "x" },
    });
    expect(await r.fallback(["a"])).toBeUndefined();
  });

  it("fallback retry whose deps are all already touched yields undefined", async () => {
    interface Fields {
      dep: string;
      caller: string;
    }
    const r = createResolver<Fields, object>({
      adapter: {},
      seed: { dep: "d" },
      resolvers: {
        // `caller` always delegates to fallback(['dep']). First pass: dep is
        // untouched -> resolves truthy -> retry re-invokes caller -> fallback
        // again, but dep is now touched (skipped) -> resolvedAny false -> undefined.
        caller: (ctx) => ctx.fallback(["dep"]) as never,
      },
    });
    expect(await r.resolve("caller")).toBeUndefined();
  });
});
