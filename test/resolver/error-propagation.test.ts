import { describe, expect, it, vi } from "vitest";
import { createResolver } from "../../src/resolver/createResolver.js";

describe("error propagation (forgiving = absence only, not thrown errors)", () => {
  it("a throwing resolver REJECTS resolve (not coerced to undefined) and is NOT cached", async () => {
    interface Fields {
      orgId: string;
    }
    let attempt = 0;
    const r = createResolver<Fields, object>({
      adapter: {},
      resolvers: {
        orgId: () => {
          attempt += 1;
          if (attempt === 1) throw new Error("Forbidden");
          return "o1";
        },
      },
    });
    await expect(r.resolve("orgId")).rejects.toThrow("Forbidden");
    // Not cached: a subsequent resolve re-invokes and can now succeed.
    expect(await r.resolve("orgId")).toBe("o1");
    expect(attempt).toBe(2);
  });

  it("a rejecting async resolver propagates the rejection", async () => {
    interface Fields {
      data: string;
    }
    const r = createResolver<Fields, object>({
      adapter: {},
      resolvers: {
        data: async () => {
          throw new Error("DB down");
        },
      },
    });
    await expect(r.resolve("data")).rejects.toThrow("DB down");
  });

  it("a resolver RETURNING undefined resolves to undefined and is cached", async () => {
    interface Fields {
      maybe: string;
    }
    const fn = vi.fn(() => undefined);
    const r = createResolver<Fields, object>({
      adapter: {},
      resolvers: { maybe: fn },
    });
    expect(await r.resolve("maybe")).toBeUndefined();
    expect(await r.resolve("maybe")).toBeUndefined();
    expect(fn).toHaveBeenCalledTimes(1); // cached terminal undefined
  });

  it("error in one field does not poison an independent field", async () => {
    interface Fields {
      bad: string;
      good: string;
    }
    const r = createResolver<Fields, object>({
      adapter: {},
      seed: { good: "ok" },
      resolvers: {
        bad: () => {
          throw new Error("boom");
        },
      },
    });
    await expect(r.resolve("bad")).rejects.toThrow("boom");
    expect(await r.resolve("good")).toBe("ok");
  });
});
