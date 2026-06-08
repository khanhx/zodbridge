import { describe, expect, it, vi } from "vitest";
import { createResolver } from "../../src/resolver/createResolver.js";
import { strategies } from "../../src/resolver/strategies.js";

const TIMEOUT_MS = 1000;
/** Race a resolution against a timeout — a deadlock would hit the timeout. */
const noHang = <T>(p: Promise<T>): Promise<T> =>
  Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error("DEADLOCK")), TIMEOUT_MS)),
  ]);

describe("cycle-safe c.resolve (no infinite loop / deadlock)", () => {
  it("mutual A<->B via c.resolve, both seeds missing -> undefined (no hang)", async () => {
    interface F {
      conversation: { id: string };
      reservation: { id: string };
    }
    const r = createResolver<F, object>({
      adapter: {},
      resolvers: {
        conversation: async (c) => {
          const res = await c.resolve("reservation");
          return res ? { id: `conv-${res.id}` } : undefined;
        },
        reservation: async (c) => {
          const cv = await c.resolve("conversation");
          return cv ? { id: `res-${cv.id}` } : undefined;
        },
      },
    });
    expect(await noHang(r.resolve("conversation"))).toBeUndefined();
    expect(await noHang(r.resolve("reservation"))).toBeUndefined();
  });

  it("cyclic pair resolves via an alternate route when one is available", async () => {
    interface F {
      reservationId: string;
      conversation: { id: string; via: string };
      reservation: { id: string };
    }
    interface Api {
      convByReservation: (id?: string) => Promise<{ id: string; via: string } | undefined>;
    }
    const r = createResolver<F, Api>({
      adapter: {
        convByReservation: async (id) => (id ? { id: `c-${id}`, via: "reservation" } : undefined),
      },
      // reservationId is seeded -> the reservation route works; the cyclic
      // route (conversation<->reservation) must fall through, not deadlock.
      seed: { reservationId: "r1" },
      resolvers: {
        conversation: strategies<F, Api, "conversation">(
          // 1st route: depends on `reservation` (which depends back on conversation)
          async (c) => {
            const res = await c.resolve("reservation");
            return res ? { id: res.id, via: "reservation-obj" } : undefined;
          },
          // 2nd route: direct via reservationId (the escape hatch)
          (c) => c.adapter.convByReservation(c.get("reservationId")),
        ),
        reservation: async (c) => {
          const cv = await c.resolve("conversation");
          return cv ? { id: cv.id } : undefined;
        },
      },
    });
    // conversation's 1st route cycles -> undefined -> 2nd route via reservationId wins
    expect(await noHang(r.resolve("conversation"))).toEqual({ id: "c-r1", via: "reservation" });
  });

  it("3-node cycle A->B->C->A terminates -> undefined", async () => {
    interface F {
      a: { v: string };
      b: { v: string };
      c: { v: string };
    }
    const r = createResolver<F, object>({
      adapter: {},
      resolvers: {
        a: async (ctx) => (await ctx.resolve("b")) ?? undefined,
        b: async (ctx) => (await ctx.resolve("c")) ?? undefined,
        c: async (ctx) => (await ctx.resolve("a")) ?? undefined,
      },
    });
    expect(await noHang(r.resolve("a"))).toBeUndefined();
  });

  it("self-cycle x->x terminates -> undefined", async () => {
    interface F {
      x: { v: string };
    }
    const r = createResolver<F, object>({
      adapter: {},
      resolvers: {
        x: async (ctx) => (await ctx.resolve("x")) ?? { v: "unreached" },
      },
    });
    // x resolves itself -> ancestor hit -> inner resolve undefined -> falls to { v }
    expect(await noHang(r.resolve("x"))).toEqual({ v: "unreached" });
  });

  it("does NOT regress concurrent dedup (Promise.all over a shared dep)", async () => {
    interface F {
      shared: { id: string };
      a: string;
      b: string;
    }
    interface Api {
      getShared: () => Promise<{ id: string }>;
    }
    const getShared = vi.fn(async () => {
      await new Promise((res) => setTimeout(res, 5));
      return { id: "s1" };
    });
    const r = createResolver<F, Api>({
      adapter: { getShared },
      resolvers: {
        shared: (c) => c.adapter.getShared(),
        a: async (c) => (await c.resolve("shared"))?.id,
        b: async (c) => (await c.resolve("shared"))?.id,
      },
    });
    const out = await noHang(Promise.all([r.resolve("a"), r.resolve("b")]));
    expect(out).toEqual(["s1", "s1"]);
    expect(getShared).toHaveBeenCalledTimes(1); // shared NOT fetched twice
  });

  it("a non-cyclic linear chain still resolves normally", async () => {
    interface F {
      id: string;
      profile: { id: string };
    }
    interface Api {
      getProfile: (id: string) => Promise<{ id: string }>;
    }
    const r = createResolver<F, Api>({
      adapter: { getProfile: async (id) => ({ id }) },
      seed: { id: "u1" },
      resolvers: {
        profile: async (c) => c.adapter.getProfile((await c.resolve("id")) ?? ""),
      },
    });
    expect(await noHang(r.resolve("profile"))).toEqual({ id: "u1" });
  });
});
