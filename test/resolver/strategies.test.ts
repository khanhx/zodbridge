import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { createResolver } from "../../src/resolver/createResolver.js";
import { SKIP, strategies } from "../../src/resolver/strategies.js";

interface Fields {
  reservationId: string;
  conversationId: string;
  chatterRefId: string;
  conversation: { id: string; via: string };
}
interface Api {
  byReservation: (id: string) => Promise<{ id: string; via: string } | undefined>;
  byConversationId: (id: string) => Promise<{ id: string; via: string } | undefined>;
  byChatterRef: (id: string) => Promise<{ id: string; via: string } | undefined>;
}

const buildApi = () => ({
  byReservation: vi.fn(async (id: string) => (id ? { id, via: "reservation" } : undefined)),
  byConversationId: vi.fn(async (id: string) => (id ? { id, via: "conversationId" } : undefined)),
  byChatterRef: vi.fn(async (id: string) => (id ? { id, via: "chatterRef" } : undefined)),
});

const makeResolver = (api: Api, seed: Partial<Fields>) =>
  createResolver<Fields, Api>({
    adapter: api,
    seed,
    resolvers: {
      conversation: strategies<Fields, Api, "conversation">(
        (c) => c.adapter.byReservation(c.get("reservationId") ?? ""),
        (c) => c.adapter.byConversationId(c.get("conversationId") ?? ""),
        (c) => c.adapter.byChatterRef(c.get("chatterRefId") ?? ""),
      ),
    },
  });

describe("strategies — multi-path fastest-first resolution", () => {
  it("uses the first strategy that yields a value (reservation wins)", async () => {
    const api = buildApi();
    const r = makeResolver(api, { reservationId: "r1", conversationId: "c1" });
    expect(await r.resolve("conversation")).toEqual({ id: "r1", via: "reservation" });
    expect(api.byReservation).toHaveBeenCalledTimes(1);
    expect(api.byConversationId).not.toHaveBeenCalled(); // short-circuited
  });

  it("falls through to a later strategy when earlier ones yield nothing", async () => {
    const api = buildApi();
    const r = makeResolver(api, { conversationId: "c1" }); // no reservationId
    expect(await r.resolve("conversation")).toEqual({ id: "c1", via: "conversationId" });
    expect(api.byReservation).toHaveBeenCalledTimes(1); // tried, returned undefined
    expect(api.byConversationId).toHaveBeenCalledTimes(1);
  });

  it("falls through to the last strategy", async () => {
    const api = buildApi();
    const r = makeResolver(api, { chatterRefId: "ch1" });
    expect(await r.resolve("conversation")).toEqual({ id: "ch1", via: "chatterRef" });
  });

  it("resolves to undefined when no strategy yields a value", async () => {
    const api = buildApi();
    const r = makeResolver(api, {});
    expect(await r.resolve("conversation")).toBeUndefined();
  });

  it("null is a WINNING value (does not fall through)", async () => {
    interface F {
      v: string | null;
    }
    const second = vi.fn(() => "unreached");
    const r = createResolver<F, object>({
      adapter: {},
      resolvers: {
        v: strategies<F, object, "v">(
          () => undefined, // skip
          () => null, // WINS — defined value
          () => second(),
        ),
      },
    });
    expect(await r.resolve("v")).toBeNull();
    expect(second).not.toHaveBeenCalled(); // short-circuited at the null winner
  });

  it("SKIP falls through even when the candidate would otherwise return null", async () => {
    interface F {
      v: string | null;
    }
    const r = createResolver<F, object>({
      adapter: {},
      resolvers: {
        v: strategies<F, object, "v">(
          () => SKIP, // explicit skip
          (): string | null | typeof SKIP => SKIP, // could return null, but skips
          () => "from-third",
        ),
      },
    });
    expect(await r.resolve("v")).toBe("from-third");
  });

  it("undefined still falls through (cycle-fallthrough preserved)", async () => {
    interface F {
      v: string;
    }
    const r = createResolver<F, object>({
      adapter: {},
      resolvers: {
        v: strategies<F, object, "v">(
          () => undefined,
          () => undefined,
          () => "ok",
        ),
      },
    });
    expect(await r.resolve("v")).toBe("ok");
  });

  it("resolves to undefined when every candidate skips", async () => {
    interface F {
      v: string;
    }
    const r = createResolver<F, object>({
      adapter: {},
      resolvers: {
        v: strategies<F, object, "v">(
          () => undefined,
          () => SKIP,
        ),
      },
    });
    expect(await r.resolve("v")).toBeUndefined();
  });

  it("type: SKIP does not widen the resolved field type", () => {
    interface F {
      v: string | null;
    }
    const fn = strategies<F, object, "v">(
      () => SKIP,
      () => null,
      () => "x",
    );
    // the composed resolver fn returns the field type (| undefined), NOT including SKIP
    expectTypeOf(fn).returns.resolves.toEqualTypeOf<string | null | undefined>();
  });

  it("a thrown strategy propagates (not a fallthrough)", async () => {
    interface F {
      v: string;
    }
    const r = createResolver<F, object>({
      adapter: {},
      resolvers: {
        v: strategies<F, object, "v">(() => {
          throw new Error("boom");
        }, () => "unreached"),
      },
    });
    await expect(r.resolve("v")).rejects.toThrow("boom");
  });
});
