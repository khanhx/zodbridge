import { describe, expect, it } from "vitest";
import { z } from "zod";
import { forwardAsync } from "../../src/async/forwardAsync.js";
import { createMap } from "../../src/map/createMap.js";
import { fromResolver } from "../../src/map/rules.js";
import { createResolver } from "../../src/resolver/createResolver.js";

interface Fields {
  user: Record<string, unknown>;
}

describe("over-exposure stripping", () => {
  it("extra adapter-row keys are stripped from a closed (.strip default) field", async () => {
    const destSchema = z.object({
      user: z.object({ id: z.string(), name: z.string() }),
    });
    const map = createMap(destSchema, { user: fromResolver("user") });
    const resolver = createResolver<Fields, object>({
      adapter: {},
      resolvers: {
        // adapter returns a full DB row, including a secret column
        user: () => ({ id: "u1", name: "Ada", passwordHash: "LEAK", ssn: "123" }),
      },
    });
    const dto = await forwardAsync(map, {}, { resolver });
    expect(dto.user).toEqual({ id: "u1", name: "Ada" });
    expect(dto.user).not.toHaveProperty("passwordHash");
    expect(dto.user).not.toHaveProperty("ssn");
  });

  it("z.any() field disables strip protection (documented leak)", async () => {
    const destSchema = z.object({ user: z.any() });
    const map = createMap(destSchema, { user: fromResolver("user") });
    const resolver = createResolver<Fields, object>({
      adapter: {},
      resolvers: { user: () => ({ id: "u1", passwordHash: "LEAK" }) },
    });
    const dto = await forwardAsync(map, {}, { resolver });
    // z.any() passes the value verbatim — the leak is by design.
    expect(dto.user).toHaveProperty("passwordHash", "LEAK");
  });

  it("a resolver value that fails its field sub-schema is left for full validation", async () => {
    const destSchema = z.object({ user: z.object({ id: z.string() }) });
    const map = createMap(destSchema, { user: fromResolver("user") });
    const resolver = createResolver<Fields, object>({
      adapter: {},
      resolvers: { user: () => ({ id: 123 }) as never }, // id should be string
    });
    await expect(forwardAsync(map, {}, { resolver })).rejects.toThrow(z.ZodError);
  });
});
