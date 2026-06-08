import { describe, expect, it, vi } from "vitest";
import { createResolver } from "../../src/resolver/createResolver.js";

describe("cycle protection", () => {
  it("simple a<->b cycle terminates and resolves to undefined", async () => {
    interface Fields {
      a: string;
      b: string;
    }
    const r = createResolver<Fields, object>({
      adapter: {},
      resolvers: {
        a: (ctx) => ctx.fallback(["b"]) as never,
        b: (ctx) => ctx.fallback(["a"]) as never,
      },
    });
    expect(await r.resolve("a")).toBeUndefined();
  });

  it("3-node triangle terminates; resolves with partial seed; each resolver <= once", async () => {
    interface Fields {
      conversation: { id: string };
      conversationId: string;
      chatter: { id: string };
    }
    interface Api {
      getConversation: (id: string) => Promise<{ id: string }>;
      getChatter: (id: string) => Promise<{ id: string }>;
    }
    const getConversation = vi.fn(async (id: string) => ({ id }));
    const getChatter = vi.fn(async (id: string) => ({ id: `chatter-${id}` }));

    const build = (seed: Partial<Fields>) =>
      createResolver<Fields, Api>({
        adapter: { getConversation, getChatter },
        seed,
        resolvers: {
          conversationId: (ctx) => {
            const conv = ctx.get("conversation");
            if (conv) return conv.id;
            return ctx.fallback(["conversation"]) as never;
          },
          conversation: async (ctx) => {
            const id = ctx.get("conversationId");
            if (id) return ctx.adapter.getConversation(id);
            return ctx.fallback(["conversationId", "chatter"]) as never;
          },
          chatter: async (ctx) => {
            const id = ctx.get("conversationId");
            if (id) return ctx.adapter.getChatter(id);
            return ctx.fallback(["conversationId"]) as never;
          },
        },
      });

    // (b) seed conversationId only -> chatter + conversation both resolve.
    getConversation.mockClear();
    getChatter.mockClear();
    const r1 = build({ conversationId: "c1" });
    expect(await r1.resolve("chatter")).toEqual({ id: "chatter-c1" });
    expect(await r1.resolve("conversation")).toEqual({ id: "c1" });
    expect(getChatter).toHaveBeenCalledTimes(1);
    expect(getConversation).toHaveBeenCalledTimes(1);

    // (c) empty seed -> all undefined, terminates (no stack overflow).
    getConversation.mockClear();
    getChatter.mockClear();
    const r2 = build({});
    expect(await r2.resolve("chatter")).toBeUndefined();
    expect(await r2.resolve("conversation")).toBeUndefined();
    expect(await r2.resolve("conversationId")).toBeUndefined();
  });
});
