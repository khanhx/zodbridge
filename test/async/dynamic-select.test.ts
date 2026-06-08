import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  UnknownSelectKeyError,
  forwardAsync,
  normalizeSelect,
} from "../../src/async/forwardAsync.js";
import { createMap } from "../../src/map/createMap.js";
import { fromResolver } from "../../src/map/rules.js";
import { createResolver } from "../../src/resolver/createResolver.js";

interface Fields {
  a: string;
  b: string;
}
interface Api {
  getA: () => Promise<string>;
  getB: () => Promise<string>;
}

describe("dynamic select", () => {
  const destSchema = z.object({ a: z.string(), b: z.string() });
  const map = createMap(destSchema, {
    a: fromResolver("a"),
    b: fromResolver("b"),
  });

  it("select skips unselected resolvers (spy: unselected resolver never called)", async () => {
    const getA = vi.fn(async () => "A");
    const getB = vi.fn(async () => "B");
    const resolver = createResolver<Fields, Api>({
      adapter: { getA, getB },
      resolvers: {
        a: (ctx) => ctx.adapter.getA(),
        b: (ctx) => ctx.adapter.getB(),
      },
    });
    const dto = await forwardAsync(map, {}, { resolver, select: ["a"] });
    expect(dto).toEqual({ a: "A" });
    expect(getA).toHaveBeenCalledTimes(1);
    expect(getB).not.toHaveBeenCalled();
  });

  it("unknown select key -> typed UnknownSelectKeyError (not a Zod stack trace)", async () => {
    const resolver = createResolver<Fields, Api>({ adapter: {} as Api });
    await expect(
      forwardAsync(map, {}, { resolver, select: ["nope"] }),
    ).rejects.toThrow(UnknownSelectKeyError);
  });

  it("duplicate select keys are de-duplicated", async () => {
    const getA = vi.fn(async () => "A");
    const resolver = createResolver<Fields, Api>({
      adapter: { getA, getB: async () => "B" },
      resolvers: { a: (ctx) => ctx.adapter.getA() },
    });
    const dto = await forwardAsync(map, {}, { resolver, select: ["a", "a"] });
    expect(dto).toEqual({ a: "A" });
    expect(getA).toHaveBeenCalledTimes(1);
  });

  it("normalizeSelect: undefined passes through, dedups, throws on unknown", () => {
    const shape = { a: z.string(), b: z.string() };
    expect(normalizeSelect(undefined, shape)).toBeUndefined();
    expect(normalizeSelect(["a", "a", "b"], shape)).toEqual(["a", "b"]);
    expect(() => normalizeSelect(["x", "y"], shape)).toThrow(UnknownSelectKeyError);
    try {
      normalizeSelect(["x"], shape);
    } catch (e) {
      expect((e as UnknownSelectKeyError).keys).toEqual(["x"]);
    }
  });

  it("no select computes all fields", async () => {
    const resolver = createResolver<Fields, Api>({
      adapter: { getA: async () => "A", getB: async () => "B" },
      resolvers: {
        a: (ctx) => ctx.adapter.getA(),
        b: (ctx) => ctx.adapter.getB(),
      },
    });
    const dto = await forwardAsync(map, {}, { resolver });
    expect(dto).toEqual({ a: "A", b: "B" });
  });
});
