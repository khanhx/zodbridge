/**
 * Map-deriving helpers that produce NEW {@link TypeMapper} instances: sub-DTO
 * views (`pick`/`omit`) and composition (`compose`). Kept separate from
 * `createMap.ts` so it can import `createMap` without a circular dependency.
 */
import { z } from "zod";
import { type TypeMapper, createMap } from "./createMap.js";
import { forwardMany, reverseMany, safeForward } from "./map-ops.js";

type AnyMapper = TypeMapper<z.ZodObject<any>, any>;

/**
 * Build a fresh `z.object` from the chosen `keys` of `schema`'s raw `.shape`.
 * Uses the shape directly (never `.pick()`), so it is safe on refined schemas.
 */
function subObject(schema: z.ZodObject<any>, keys: string[]): z.ZodObject<any> {
  const shape = schema.shape as Record<string, z.ZodType>;
  const picked: Record<string, z.ZodType> = {};
  for (const key of keys) {
    const field = shape[key];
    if (field !== undefined) picked[key] = field;
  }
  return z.object(picked);
}

/** A map over only `keys` of `map`'s DTO (identity rules; no transforms carried). */
export function pick<M extends AnyMapper>(map: M, keys: string[]): AnyMapper {
  return createMap(subObject(map.schema, keys));
}

/** A map over `map`'s DTO minus `keys`. */
export function omit<M extends AnyMapper>(map: M, keys: string[]): AnyMapper {
  const drop = new Set(keys);
  const remaining = Object.keys(map.schema.shape as object).filter((k) => !drop.has(k));
  return createMap(subObject(map.schema, remaining));
}

/**
 * Compose two maps into a DTO->DTO pipeline: `compose(a, b).forward(src)` runs
 * `b.forward(a.forward(src))`, validating against `b`'s schema. Reverse pipes
 * back through `a.reverse(b.reverse(dto))`.
 *
 * `forwardMany`/`safeForward`/`reverseMany` honor the composed pipeline. Reverse
 * only round-trips fields BOTH maps carry a reversible rule for (identity links
 * with no rule emit nothing on reverse). `toResolver` is unsupported on a
 * composed map (it declares no resolver graph) and throws.
 */
export function compose<A extends AnyMapper, B extends AnyMapper>(a: A, b: B): AnyMapper {
  // Base instance supplies schema/shape/case-helpers for b's DTO; forward and
  // reverse pipe through the ORIGINAL maps so their rules are honored.
  const base = createMap(b.schema);
  const composed = { ...base } as AnyMapper;
  composed.forward = (source: Record<string, unknown>) =>
    b.forward(a.forward(source) as Record<string, unknown>);
  composed.reverse = (dto: unknown) => a.reverse(b.reverse(dto as never) as never);
  // Re-wire derived ops over the COMPOSED forward/reverse — base's closures
  // would otherwise bypass the pipeline and silently skip a's transforms.
  composed.forwardMany = (sources) => forwardMany(composed, sources) as never;
  composed.reverseMany = (dtos) => reverseMany(composed, dtos);
  composed.safeForward = (source) => safeForward(composed, source) as never;
  return composed;
}
