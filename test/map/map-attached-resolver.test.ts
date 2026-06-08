import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { MapHasNoResolversError, createMap } from "../../src/map/createMap.js";

interface Api {
  getOrg: (id: string) => Promise<{ orgId: string; tier: number }>;
}

describe("createMap.toResolver — graph attached to the map", () => {
  const orgMap = createMap(
    z.object({ orgId: z.string(), org: z.object({ orgId: z.string(), tier: z.number() }) }),
    {},
    {
      resolvers: {
        org: (ctx) => (ctx.adapter as Api).getOrg((ctx.get("orgId") as string) ?? ""),
      },
    },
  );

  it("builds a resolver from the map's schema + declared resolvers", async () => {
    const r = orgMap.toResolver<Api>(
      { getOrg: async (id) => ({ orgId: id, tier: 3 }) },
      { orgId: "o1" },
    );
    expect(await r.resolve("org")).toEqual({ orgId: "o1", tier: 3 });
    expect(await r.resolve("orgId")).toBe("o1");
  });

  it("validates resolver output against the map's field sub-schema (strips extras)", async () => {
    const r = orgMap.toResolver<Api>(
      {
        getOrg: async (id) =>
          ({ orgId: id, tier: 3, secret: "LEAK" }) as { orgId: string; tier: number },
      },
      { orgId: "o1" },
    );
    const org = await r.resolve("org");
    expect(org).toEqual({ orgId: "o1", tier: 3 });
    expect(org).not.toHaveProperty("secret");
  });

  it("exposes the declared resolvers on the map", () => {
    expect(orgMap.resolvers).toBeDefined();
    expect(typeof orgMap.resolvers?.org).toBe("function");
  });

  it("throws MapHasNoResolversError when no resolvers were declared", () => {
    const plain = createMap(z.object({ id: z.string() }));
    expect(plain.resolvers).toBeUndefined();
    expect(() => plain.toResolver({})).toThrow(MapHasNoResolversError);
  });

  it("toResolver without a seed works (resolver-only fields)", async () => {
    const m = createMap(
      z.object({ now: z.number() }),
      {},
      { resolvers: { now: () => 42 } },
    );
    const r = m.toResolver({});
    expect(await r.resolve("now")).toBe(42);
  });

  it("is strongly typed: resolve returns the DTO field type, adapter is typed", async () => {
    const r = orgMap.toResolver<Api>({ getOrg: async (id) => ({ orgId: id, tier: 1 }) });
    // resolve(field) is the schema's inferred field type (not unknown)
    expectTypeOf(r.resolve("orgId")).resolves.toEqualTypeOf<string | undefined>();
    expectTypeOf(r.resolve("org")).resolves.toEqualTypeOf<
      { orgId: string; tier: number } | undefined
    >();
    // adapter carries the TAdapter passed to toResolver
    expectTypeOf(r.adapter).toEqualTypeOf<Api>();
    // get/path are field-typed too
    expectTypeOf(r.get("orgId")).toEqualTypeOf<string | undefined>();
    expect(true).toBe(true);
  });

  it("rejects an unknown field key at the type level", () => {
    const r = orgMap.toResolver<Api>({ getOrg: async (id) => ({ orgId: id, tier: 1 }) });
    // @ts-expect-error - "nope" is not a field of the map's DTO
    void r.resolve("nope");
  });
});
