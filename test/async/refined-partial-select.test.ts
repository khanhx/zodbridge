import { describe, expect, it } from "vitest";
import { z } from "zod";
import { forwardAsync } from "../../src/async/forwardAsync.js";
import { createMap } from "../../src/map/createMap.js";
import { createResolver } from "../../src/resolver/createResolver.js";

describe("refined schema + partial select (Zod 4)", () => {
  const emptyResolver = () =>
    createResolver<Record<string, never>, object>({ adapter: {} });

  // Object-level cross-field refine -> .pick()/.partial() would THROW in Zod 4.
  const destSchema = z
    .object({
      x: z.string(),
      y: z.string(),
    })
    .refine((o) => o.x !== o.y, "x and y must differ");

  const map = createMap(destSchema, { x: "src_x", y: "src_y" });

  it("partial select does NOT throw the Zod 4 .pick/.partial-on-refinement error", async () => {
    const dto = await forwardAsync(
      map,
      { src_x: "a", src_y: "a" }, // would FAIL the object-level refine if it ran
      { resolver: emptyResolver(), select: ["x"] },
    );
    // object-level refine skipped on partial select -> no error, only x present
    expect(dto).toEqual({ x: "a" });
  });

  it("partial select with a required field not selected does not fail", async () => {
    const dto = await forwardAsync(map, { src_x: "a", src_y: "b" }, {
      resolver: emptyResolver(),
      select: ["x"],
    });
    expect(dto).toEqual({ x: "a" });
    expect("y" in dto).toBe(false);
  });

  it("full select runs the object-level refine (surfaces ZodError on violation)", async () => {
    await expect(
      forwardAsync(map, { src_x: "same", src_y: "same" }, { resolver: emptyResolver() }),
    ).rejects.toThrow(z.ZodError);
  });

  it("field-level refine still runs on a selected field", async () => {
    const schema = z
      .object({
        x: z.string().refine((v) => v.length > 1, "too short"),
        y: z.string(),
      })
      .refine((o) => o.x !== o.y);
    const m = createMap(schema, { x: "src_x", y: "src_y" });
    await expect(
      forwardAsync(m, { src_x: "a" }, { resolver: emptyResolver(), select: ["x"] }),
    ).rejects.toThrow(z.ZodError);
  });
});
