import { describe, expect, it } from "vitest";
import { z } from "zod";
import { deserialize, serialize, typeOf, unwrap } from "../../src/serialize/codec.js";
import { AsyncSchemaError, CodecError } from "../../src/serialize/json-types.js";

const isJsonSafe = (v: unknown): boolean => {
  try {
    return JSON.stringify(v) === JSON.stringify(JSON.parse(JSON.stringify(v)));
  } catch {
    return false;
  }
};

describe("serialize/deserialize round-trip", () => {
  const schema = z.object({
    id: z.bigint(),
    createdAt: z.date(),
    tags: z.array(z.string()),
    counters: z.map(z.number(), z.bigint()),
    note: z.string().optional(),
    nested: z.object({ when: z.date(), level: z.number() }),
    items: z.array(z.object({ at: z.date() })),
    label: z.string().transform((s) => s).pipe(z.string()),
    either: z.union([z.date(), z.string()]),
  });

  const value: z.infer<typeof schema> = {
    id: 123456789012345678n,
    createdAt: new Date("2024-06-01T00:00:00.000Z"),
    tags: ["a", "b"],
    counters: new Map([
      [1, 10n],
      [2, 20n],
    ]),
    nested: { when: new Date("2023-01-01T12:00:00.000Z"), level: 3 },
    items: [{ at: new Date("2022-02-02T00:00:00.000Z") }],
    label: "hello",
    either: new Date("2021-03-03T00:00:00.000Z"),
  };

  it("serialize output is JSON-safe (no Date/BigInt/Map survive)", () => {
    const out = serialize(value, schema) as Record<string, unknown>;
    expect(isJsonSafe(out)).toBe(true);
    expect(typeof out.id).toBe("string");
    expect(typeof out.createdAt).toBe("string");
    expect(Array.isArray(out.counters)).toBe(true);
  });

  it("deserialize(serialize(x)) deep-equals x", () => {
    const round = deserialize(serialize(value, schema), schema);
    expect(round).toEqual(value);
  });

  it("optional field absent round-trips", () => {
    const wire = serialize(value, schema) as Record<string, unknown>;
    expect(wire.note).toBeUndefined();
    expect(deserialize(wire, schema)).toEqual(value);
  });

  it("union picks the string branch when value is a string", () => {
    const v = { ...value, either: "plain" };
    expect(deserialize(serialize(v, schema), schema).either).toBe("plain");
  });
});

describe("wrapper-node unwrapping", () => {
  it("unwraps optional, nullable, default, lazy, pipe to inner kind", () => {
    expect(typeOf(unwrap(z.date().optional()))).toBe("date");
    expect(typeOf(unwrap(z.date().nullable()))).toBe("date");
    expect(typeOf(unwrap(z.date().default(() => new Date())))).toBe("date");
    expect(typeOf(unwrap(z.lazy(() => z.date())))).toBe("date");
    expect(typeOf(unwrap(z.date().readonly()))).toBe("date");
    expect(typeOf(unwrap(z.string().transform((s) => s)))).toBe("string");
  });

  it("walks object with .refine() (object node retains shape in Zod 4)", () => {
    const refined = z
      .object({ at: z.date() })
      .refine((o) => o.at instanceof Date);
    const v = { at: new Date("2024-01-01T00:00:00.000Z") };
    expect(deserialize(serialize(v, refined), refined)).toEqual(v);
  });

  it("null and undefined pass through walk untouched", () => {
    const schema = z.object({ a: z.date().nullable(), b: z.date().optional() });
    const v = { a: null, b: undefined };
    const out = serialize(v, schema) as Record<string, unknown>;
    expect(out.a).toBeNull();
    expect(deserialize(out, schema).a).toBeNull();
  });
});

describe("Map with rich keys/values", () => {
  it("round-trips Date keys and BigInt values", () => {
    const schema = z.map(z.date(), z.bigint());
    const v = new Map([[new Date("2020-01-01T00:00:00.000Z"), 5n]]);
    const wire = serialize(v, schema);
    expect(isJsonSafe(wire)).toBe(true);
    expect(deserialize(wire, schema)).toEqual(v);
  });
});

describe("adversarial / typed-error behavior", () => {
  it("malformed bigint wire (object) -> CodecError, not raw throw", () => {
    const schema = z.object({ id: z.bigint() });
    expect(() => deserialize({ id: { evil: true } }, schema)).toThrow(CodecError);
  });

  it("oversized bigint string -> bounds CodecError", () => {
    const schema = z.object({ id: z.bigint() });
    expect(() => deserialize({ id: "1".repeat(5000) }, schema)).toThrow(/exceeds/);
  });

  it("invalid ISO date wire -> CodecError", () => {
    const schema = z.object({ at: z.date() });
    expect(() => deserialize({ at: "garbage" }, schema)).toThrow(CodecError);
  });

  it("object node given a non-object -> CodecError", () => {
    const schema = z.object({ a: z.string() });
    expect(() => serialize("nope" as never, schema)).toThrow(/expected an object/);
  });

  it("array node given a non-array -> CodecError", () => {
    const schema = z.array(z.string());
    expect(() => serialize("nope" as never, schema)).toThrow(/expected an array/);
  });

  it("union with no matching member -> CodecError", () => {
    const schema = z.union([z.date(), z.bigint()]);
    expect(() => deserialize(true, schema)).toThrow(CodecError);
  });

  it("async-refined schema -> AsyncSchemaError", () => {
    const schema = z.object({ a: z.string().refine(async () => true) });
    expect(() => deserialize({ a: "x" }, schema)).toThrow(AsyncSchemaError);
  });

  it("Zod validation failure (non-async) propagates as ZodError", () => {
    const schema = z.object({ n: z.number().min(10) });
    expect(() => deserialize({ n: 1 }, schema)).toThrow(z.ZodError);
  });

  it("unsupported schema node fails closed", () => {
    const schema = z.object({ s: z.symbol() });
    const v = { s: Symbol("x") };
    expect(() => serialize(v as never, schema)).toThrow(/unsupported schema node "symbol"/);
  });
});

describe("escape hatches and scalars pass through", () => {
  it("z.custom passes through untouched", () => {
    const schema = z.object({ raw: z.custom<{ x: number }>(() => true) });
    const v = { raw: { x: 1 } };
    expect(serialize(v, schema)).toEqual(v);
  });

  it("scalars (string/number/boolean/literal/enum/any) pass through", () => {
    const schema = z.object({
      s: z.string(),
      n: z.number(),
      b: z.boolean(),
      lit: z.literal("k"),
      en: z.enum(["a", "b"]),
      a: z.any(),
    });
    const v = { s: "x", n: 1, b: true, lit: "k" as const, en: "a" as const, a: { any: 1 } };
    expect(serialize(v, schema)).toEqual(v);
    expect(deserialize(serialize(v, schema), schema)).toEqual(v);
  });

  it("union propagates a non-CodecError fault from a member (no swallow)", () => {
    // A z.lazy getter that throws a plain Error is a real fault, not a failed
    // union match — it must propagate immediately, not be tried as a miss.
    const boom = new Error("getter exploded");
    const schema = z.union([
      z.lazy(() => {
        throw boom;
      }),
      z.string(),
    ]);
    expect(() => serialize("x" as never, schema)).toThrow(boom);
  });
});
