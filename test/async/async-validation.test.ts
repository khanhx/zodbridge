import { describe, expect, it } from "vitest";
import { z } from "zod";
import { forwardAsync } from "../../src/async/forwardAsync.js";
import { createMap } from "../../src/map/createMap.js";
import { createResolver } from "../../src/resolver/createResolver.js";

describe("async validation", () => {
  const emptyResolver = () =>
    createResolver<Record<string, never>, object>({ adapter: {} });

  it("runs a field-level async .refine via safeParseAsync", async () => {
    const destSchema = z.object({
      handle: z.string().refine(async (v) => v.startsWith("@"), "must start with @"),
    });
    const map = createMap(destSchema, { handle: "raw" });
    const dto = await forwardAsync(map, { raw: "@ada" }, { resolver: emptyResolver() });
    expect(dto).toEqual({ handle: "@ada" });
  });

  it("a failing async refinement surfaces a ZodError", async () => {
    const destSchema = z.object({
      handle: z.string().refine(async (v) => v.startsWith("@"), "must start with @"),
    });
    const map = createMap(destSchema, { handle: "raw" });
    await expect(
      forwardAsync(map, { raw: "ada" }, { resolver: emptyResolver() }),
    ).rejects.toThrow(z.ZodError);
  });

  it("a sync validation failure also surfaces a ZodError", async () => {
    const map = createMap(z.object({ n: z.number().min(10) }), { n: "value" });
    await expect(
      forwardAsync(map, { value: 1 }, { resolver: emptyResolver() }),
    ).rejects.toThrow(z.ZodError);
  });
});
