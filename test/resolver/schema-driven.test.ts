import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { z } from "zod";
import { createMap } from "../../src/map/createMap.js";
import { createResolver } from "../../src/resolver/createResolver.js";

const userMap = createMap(z.object({ id: z.string(), name: z.string() }));
const orgMap = createMap(z.object({ orgId: z.string(), tier: z.number() }));

interface Api {
  getUser: (orgId: string) => Promise<{ id: string; name: string }>;
  getOrg: (orgId: string) => Promise<{ orgId: string; tier: number }>;
}

describe("schema-driven createResolver — fields from maps", () => {
  it("derives validated fields from maps and returns parsed DTOs", async () => {
    const r = createResolver({
      adapter: {
        getUser: async (orgId: string) => ({ id: `u-${orgId}`, name: "Ada" }),
        getOrg: async (orgId: string) => ({ orgId, tier: 2 }),
      } satisfies Api,
      maps: { user: userMap, org: orgMap },
      fields: z.object({ orgId: z.string() }),
      seed: { orgId: "o1" },
      resolvers: {
        org: (ctx) => ctx.adapter.getOrg(ctx.get("orgId") ?? ""),
        user: async (ctx) => {
          const org = await ctx.resolve("org"); // chaining
          return ctx.adapter.getUser(org?.orgId ?? "");
        },
      },
    });

    expect(await r.resolve("org")).toEqual({ orgId: "o1", tier: 2 });
    expect(await r.resolve("user")).toEqual({ id: "u-o1", name: "Ada" });
  });

  it("strips unknown keys from resolver output (over-exposure protection)", async () => {
    const r = createResolver({
      adapter: {},
      maps: { user: userMap },
      resolvers: {
        // adapter row carries an extra secret column
        user: () => ({ id: "u1", name: "Ada", passwordHash: "LEAK" }) as never,
      },
    });
    const user = await r.resolve("user");
    expect(user).toEqual({ id: "u1", name: "Ada" });
    expect(user).not.toHaveProperty("passwordHash");
  });

  it("a resolver output failing its schema REJECTS and is NOT cached", async () => {
    const fn = vi.fn(() => ({ id: 123, name: "x" }) as never); // id must be string
    const r = createResolver({
      adapter: {},
      maps: { user: userMap },
      resolvers: { user: fn },
    });
    await expect(r.resolve("user")).rejects.toThrow(z.ZodError);
    // not cached -> a corrected retry can succeed
    fn.mockReturnValue({ id: "ok", name: "x" } as never);
    expect(await r.resolve("user")).toEqual({ id: "ok", name: "x" });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("scalar dep fields (fields schema) resolve from seed without a map", async () => {
    const r = createResolver({
      adapter: {},
      maps: { org: orgMap },
      fields: z.object({ orgId: z.string() }),
      seed: { orgId: "o9" },
      resolvers: { org: (ctx) => ({ orgId: ctx.get("orgId") ?? "", tier: 1 }) },
    });
    expect(await r.resolve("orgId")).toBe("o9"); // seed, not validated
    expect(await r.resolve("org")).toEqual({ orgId: "o9", tier: 1 });
  });

  it("seed values are NOT validated (trusted caller input)", async () => {
    // org seed deliberately violates orgMap.schema (tier should be number).
    const r = createResolver({
      adapter: {},
      maps: { org: orgMap },
      seed: { org: { orgId: "o1", tier: "not-a-number" } as never },
      resolvers: {},
    });
    // seed is served as-is; no parse, no throw.
    expect(await r.resolve("org")).toEqual({ orgId: "o1", tier: "not-a-number" });
  });

  it("a field with no schema and no resolver is a terminal undefined", async () => {
    const r = createResolver({
      adapter: {},
      maps: { user: userMap },
      resolvers: {},
    });
    expect(await r.resolve("user")).toBeUndefined();
  });

  it("works without a fields object (maps only)", async () => {
    const r = createResolver({
      adapter: {},
      maps: { user: userMap },
      resolvers: { user: () => ({ id: "u1", name: "n" }) },
    });
    expect(await r.resolve("user")).toEqual({ id: "u1", name: "n" });
  });
});

describe("schema-driven createResolver — static types", () => {
  it("resolve(field) is typed as the map's inferred DTO", () => {
    const r = createResolver({
      adapter: {} as Api,
      maps: { user: userMap, org: orgMap },
      fields: z.object({ orgId: z.string() }),
      resolvers: {},
    });
    expectTypeOf(r.resolve("user")).resolves.toEqualTypeOf<
      { id: string; name: string } | undefined
    >();
    expectTypeOf(r.resolve("org")).resolves.toEqualTypeOf<
      { orgId: string; tier: number } | undefined
    >();
    expectTypeOf(r.resolve("orgId")).resolves.toEqualTypeOf<string | undefined>();
  });

  it("resolver fn return type is constrained to the field's DTO", () => {
    // @ts-expect-error - returning the wrong shape for `user` is a type error
    createResolver({
      adapter: {} as Api,
      maps: { user: userMap },
      resolvers: { user: () => ({ id: 1 }) },
    });
  });
});

describe("backward compatibility — hand-written Fields", () => {
  it("the legacy generic signature still works and does NOT validate", async () => {
    interface Fields {
      orgId: string;
      org: { orgId: string; tier: number };
    }
    const r = createResolver<Fields, Api>({
      adapter: {} as Api,
      seed: { orgId: "o1" },
      resolvers: {
        // returns a shape that has no schema -> not validated, served as-is
        org: (ctx) => ({ orgId: ctx.get("orgId") ?? "", tier: 99 }),
      },
    });
    expect(await r.resolve("org")).toEqual({ orgId: "o1", tier: 99 });
    expectTypeOf(r.resolve("orgId")).resolves.toEqualTypeOf<string | undefined>();
  });
});
