import { describe, expect, it } from "vitest";
import { z } from "zod";
import { deserialize, deserializeAsync, serialize } from "../../src/serialize/codec.js";
import { CodecError } from "../../src/serialize/json-types.js";

describe("Set support", () => {
  it("serialize Set -> array; deserialize array -> Set (round-trip)", () => {
    const schema = z.object({ tags: z.set(z.string()) });
    const v = { tags: new Set(["a", "b"]) };
    const wire = serialize(v, schema) as { tags: unknown };
    expect(Array.isArray(wire.tags)).toBe(true);
    expect(JSON.stringify(wire)).toBe('{"tags":["a","b"]}');
    const back = deserialize(wire, schema);
    expect(back.tags).toBeInstanceOf(Set);
    expect([...back.tags]).toEqual(["a", "b"]);
  });

  it("Set of rich values (dates) round-trips", () => {
    const schema = z.set(z.date());
    const d = new Date("2024-01-01T00:00:00.000Z");
    const wire = serialize(new Set([d]), schema);
    const back = deserialize(wire, schema);
    expect([...back][0]?.getTime()).toBe(d.getTime());
  });

  it("serialize rejects a non-Set for a set field", () => {
    const schema = z.object({ tags: z.set(z.string()) });
    expect(() => serialize({ tags: ["a"] } as never, schema)).toThrow(/expected a Set/);
  });

  it("deserialize rejects a non-array wire for a set field", () => {
    const schema = z.object({ tags: z.set(z.string()) });
    expect(() => deserialize({ tags: "nope" }, schema)).toThrow(CodecError);
  });

  it("deserialize rejects an oversized set wire array (DoS bound)", () => {
    const schema = z.object({ tags: z.set(z.string()) });
    const huge = Array.from({ length: 100_001 }, (_, i) => String(i));
    expect(() => deserialize({ tags: huge }, schema)).toThrow(/Set values exceed/);
  });
});

describe("deserializeAsync", () => {
  it("validates against an async-refined schema (no AsyncSchemaError)", async () => {
    const schema = z.object({
      handle: z.string().refine(async (v) => v.startsWith("@"), "must start with @"),
    });
    const out = await deserializeAsync({ handle: "@ada" }, schema);
    expect(out).toEqual({ handle: "@ada" });
  });

  it("rebuilds rich values then validates", async () => {
    const schema = z.object({ at: z.date() });
    const out = await deserializeAsync({ at: "2024-01-01T00:00:00.000Z" }, schema);
    expect(out.at).toBeInstanceOf(Date);
  });

  it("a failing async refinement rejects with a ZodError", async () => {
    const schema = z.object({
      handle: z.string().refine(async (v) => v.startsWith("@"), "must start with @"),
    });
    await expect(deserializeAsync({ handle: "ada" }, schema)).rejects.toThrow(z.ZodError);
  });

  it("malformed wire still surfaces a CodecError during rebuild", async () => {
    const schema = z.object({ id: z.bigint() });
    await expect(deserializeAsync({ id: { evil: true } }, schema)).rejects.toThrow(CodecError);
  });
});
