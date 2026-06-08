/**
 * Schema-driven JSON-safe codec for Zod 4 schemas.
 *
 * `serialize` walks a value alongside its Zod schema and replaces rich runtime
 * types (Date, BigInt, Map) with JSON-safe representations; `deserialize` walks
 * the wire form back into rich values and then validates with Zod.
 *
 * Zod-4 only: all schema-shape reads go through {@link typeOf}/{@link unwrap},
 * which dispatch on the Zod 4 internal `_zod.def.type` (lowercase strings).
 * Zod 3's `_def.typeName` is intentionally unsupported.
 */
import type { z } from "zod";
import {
  AsyncSchemaError,
  CodecError,
  bigintToString,
  arrayToSetItems,
  dateToIso,
  entriesToArray,
  isoToDate,
  mapToEntries,
  setToArray,
  stringToBigint,
} from "./json-types.js";

type AnyZod = z.ZodType;
type Path = ReadonlyArray<string | number>;
type Direction = "serialize" | "deserialize";

// Minimal structural view of the Zod 4 internal def. Centralizes the one place
// the library couples to `_zod.def`, so a Zod minor bump touches only this file.
interface ZodDef {
  type: string;
  innerType?: AnyZod;
  element?: AnyZod;
  shape?: Record<string, AnyZod>;
  keyType?: AnyZod;
  valueType?: AnyZod;
  options?: AnyZod[];
  getter?: () => AnyZod;
  in?: AnyZod;
}

function defOf(schema: AnyZod): ZodDef {
  return (schema as unknown as { _zod: { def: ZodDef } })._zod.def;
}

/** The Zod 4 node kind, e.g. `"object"`, `"array"`, `"date"`. */
export function typeOf(schema: AnyZod): string {
  return defOf(schema).type;
}

/**
 * Peel wrapper nodes that do not change the JSON-safe shape:
 * optional/nullable/default (innerType), pipe/transform (the `in` schema is the
 * wire-facing shape), and lazy (resolve the getter). Object `.refine()` in Zod
 * 4 stays a plain `object` node with its `shape` intact, so it needs no peeling.
 */
export function unwrap(schema: AnyZod): AnyZod {
  let current = schema;
  // Bounded by schema nesting depth; each step strictly descends.
  for (;;) {
    const def = defOf(current);
    switch (def.type) {
      case "optional":
      case "nullable":
      case "default":
      case "nonoptional":
      case "readonly":
      case "catch":
        current = def.innerType as AnyZod;
        break;
      case "pipe":
        // `.transform()` and `.pipe()` both produce a pipe; the `in` side is the
        // shape that wire data is validated against.
        current = def.in as AnyZod;
        break;
      case "lazy":
        current = (def.getter as () => AnyZod)();
        break;
      default:
        return current;
    }
  }
}

function walk(schema: AnyZod, value: unknown, dir: Direction, path: Path): unknown {
  if (value === null || value === undefined) return value;

  const node = unwrap(schema);
  const def = defOf(node);

  switch (def.type) {
    case "object": {
      if (typeof value !== "object" || Array.isArray(value)) {
        throw new CodecError("expected an object", path);
      }
      const shape = def.shape as Record<string, AnyZod>;
      const src = value as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(shape)) {
        if (Object.prototype.hasOwnProperty.call(src, key)) {
          out[key] = walk(shape[key] as AnyZod, src[key], dir, [...path, key]);
        }
      }
      return out;
    }

    case "array": {
      if (!Array.isArray(value)) throw new CodecError("expected an array", path);
      const element = def.element as AnyZod;
      return value.map((item, i) => walk(element, item, dir, [...path, i]));
    }

    case "map": {
      const keyType = def.keyType as AnyZod;
      const valueType = def.valueType as AnyZod;
      if (dir === "serialize") {
        const entries = mapToEntries(value as Map<unknown, unknown>, path);
        return entries.map(([k, v], i) => [
          walk(keyType, k, dir, [...path, i, "key"]),
          walk(valueType, v, dir, [...path, i, "value"]),
        ]);
      }
      const entries = entriesToArray(value, path);
      const out = new Map<unknown, unknown>();
      entries.forEach(([k, v], i) => {
        out.set(
          walk(keyType, k, dir, [...path, i, "key"]),
          walk(valueType, v, dir, [...path, i, "value"]),
        );
      });
      return out;
    }

    case "set": {
      const valueType = def.valueType as AnyZod;
      if (dir === "serialize") {
        const items = setToArray(value as Set<unknown>, path);
        return items.map((item, i) => walk(valueType, item, dir, [...path, i]));
      }
      const items = arrayToSetItems(value, path);
      return new Set(items.map((item, i) => walk(valueType, item, dir, [...path, i])));
    }

    case "union": {
      // Try each member; first that walks without a CodecError wins. Mirrors
      // Zod's own "first match" union semantics for the JSON-safe shape. A
      // non-CodecError (e.g. a throwing z.lazy getter) is a real fault and
      // propagates immediately rather than being treated as a failed match.
      const options = def.options as AnyZod[];
      let lastError: CodecError = new CodecError("no union member matched", path);
      for (const option of options) {
        try {
          return walk(option, value, dir, path);
        } catch (err) {
          if (!(err instanceof CodecError)) throw err;
          lastError = err;
        }
      }
      throw lastError;
    }

    case "date":
      return dir === "serialize"
        ? dateToIso(value as Date, path)
        : isoToDate(value, path);

    case "bigint":
      return dir === "serialize"
        ? bigintToString(value as bigint, path)
        : stringToBigint(value, path);

    // Scalars and explicit escape hatches pass through untouched.
    case "string":
    case "number":
    case "boolean":
    case "nan":
    case "null":
    case "undefined":
    case "literal":
    case "enum":
    case "any":
    case "unknown":
    case "void":
    case "custom":
      return value;

    default:
      // Fail closed: an unhandled object-like node would otherwise silently
      // skip its inner schema. Use z.custom() for genuinely opaque values.
      throw new CodecError(`unsupported schema node "${def.type}"`, path);
  }
}

/**
 * Convert a rich value into a JSON-safe plain value per its Zod schema.
 * Date -> ISO string, BigInt -> string, Map -> `[key, value][]`, recursing
 * through objects, arrays, maps and unions. The result survives
 * `JSON.parse(JSON.stringify(...))` with no loss for supported types.
 */
export function serialize<S extends AnyZod>(value: z.infer<S>, schema: S): unknown {
  return walk(schema, value, "serialize", []);
}

function isZodAsyncError(err: unknown): boolean {
  const name = (err as { constructor?: { name?: string } } | null)?.constructor?.name;
  return name === "$ZodAsyncError";
}

/**
 * Rebuild rich values from their JSON-safe wire form per `schema`, then
 * validate with Zod. Leaf transforms validate their input and surface a typed
 * {@link CodecError} on malformed data, so untrusted JSON never escapes as a
 * raw throw or an unbounded stall. Sync-only: an async-refined schema throws
 * {@link AsyncSchemaError}.
 */
export function deserialize<S extends AnyZod>(json: unknown, schema: S): z.infer<S> {
  const rebuilt = walk(schema, json, "deserialize", []);
  try {
    return schema.parse(rebuilt) as z.infer<S>;
  } catch (err) {
    if (isZodAsyncError(err)) throw new AsyncSchemaError();
    throw err;
  }
}

/**
 * Async variant of {@link deserialize}: rebuilds rich values then validates with
 * `parseAsync`, so schemas containing async `.refine`/`.superRefine` are
 * supported (no {@link AsyncSchemaError}). The same leaf-transform safety and
 * DoS bounds apply during the rebuild.
 */
export async function deserializeAsync<S extends AnyZod>(
  json: unknown,
  schema: S,
): Promise<z.infer<S>> {
  const rebuilt = walk(schema, json, "deserialize", []);
  return (await schema.parseAsync(rebuilt)) as z.infer<S>;
}
