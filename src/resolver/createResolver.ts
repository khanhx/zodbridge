/**
 * `createResolver` — factory for a dependency-aware, memoizing, cycle-guarded
 * resolver graph with an injected generic fetch adapter. See {@link GraphContext}
 * for the resolution algorithm and its invariants.
 *
 * Two call styles:
 *  1. **Hand-written fields** — `createResolver<Fields, Adapter>({ resolvers, ... })`.
 *     Fields are statically typed; resolver outputs are NOT validated at runtime.
 *  2. **Schema-driven** — `createResolver({ maps, fields?, resolvers, ... })`.
 *     Resolvable fields and their Zod schemas are derived from `createMap`
 *     instances (`maps`) plus an optional scalar-dep `fields` object; each
 *     resolver's output is parsed (unknown keys stripped) before caching.
 *
 * Field names that collide with JavaScript object internals (`__proto__`,
 * `constructor`, `prototype`) are not supported — the `resolvers`/`seed`
 * registries are plain objects, so such keys do not register as own properties.
 * Use ordinary identifier field names.
 */
import type { z } from "zod";
import {
  GraphContext,
  type ResolverConfig,
  type ResolverContext,
  type ResolverRegistry,
  type ResolverSchemas,
} from "./context.js";

/** Minimal structural view of a `createMap` instance (avoids a hard dep cycle). */
export interface SchemaSource<T = unknown> {
  readonly schema: z.ZodType<T>;
}

/** Field set derived from a map of {@link SchemaSource}s (each map's inferred DTO). */
type FieldsFromMaps<M extends Record<string, SchemaSource>> = {
  [K in keyof M]: M[K] extends SchemaSource<infer T> ? T : never;
};

/** Field set derived from an optional scalar `fields` object schema. */
type FieldsFromSchema<F extends z.ZodObject<any> | undefined> = F extends z.ZodObject<any>
  ? z.infer<F>
  : Record<never, never>;

/** Merged resolvable field set: mapped DTO fields + scalar dep fields. */
export type SchemaResolverFields<
  M extends Record<string, SchemaSource>,
  F extends z.ZodObject<any> | undefined,
> = FieldsFromMaps<M> & FieldsFromSchema<F>;

/** Config for the schema-driven `createResolver` overload. */
export interface SchemaResolverConfig<
  M extends Record<string, SchemaSource>,
  F extends z.ZodObject<any> | undefined,
  TAdapter,
> {
  adapter: TAdapter;
  /** `createMap` instances whose dest schemas define validated DTO fields. */
  maps: M;
  /** Optional object schema for scalar dependency fields (e.g. `orgId`). */
  fields?: F;
  seed?: Partial<SchemaResolverFields<M, F>>;
  resolvers?: ResolverRegistry<SchemaResolverFields<M, F>, TAdapter>;
}

// Hand-written-fields overload (validation off unless schemas supplied).
export function createResolver<Fields, TAdapter>(
  config: ResolverConfig<Fields, TAdapter>,
): ResolverContext<Fields, TAdapter>;

// Schema-driven overload: fields inferred from maps + scalar fields; outputs validated.
export function createResolver<
  M extends Record<string, SchemaSource>,
  TAdapter,
  F extends z.ZodObject<any> | undefined = undefined,
>(
  config: SchemaResolverConfig<M, F, TAdapter>,
): ResolverContext<SchemaResolverFields<M, F>, TAdapter>;

export function createResolver(
  config: ResolverConfig<unknown, unknown> & {
    maps?: Record<string, SchemaSource>;
    fields?: z.ZodObject<any>;
  },
): ResolverContext<unknown, unknown> {
  const schemas = config.maps ? buildSchemas(config.maps, config.fields) : config.schemas;
  return new GraphContext<unknown, unknown>({
    adapter: config.adapter,
    seed: config.seed,
    resolvers: config.resolvers,
    schemas,
    onResolve: config.onResolve,
  });
}

/** Build the runtime `field -> Zod schema` lookup from maps + scalar fields. */
function buildSchemas(
  maps: Record<string, SchemaSource>,
  fields: z.ZodObject<any> | undefined,
): ResolverSchemas<Record<string, unknown>> {
  // Null-prototype map so the schema lookup is a clean own-key store. (Field
  // names that collide with object internals like `__proto__` are not a
  // supported case anyway — see the createResolver docs — but a null proto
  // keeps this lookup itself free of prototype-chain surprises.)
  const out: Record<string, z.ZodType> = Object.create(null);
  for (const key of Object.keys(maps)) {
    out[key] = maps[key]!.schema;
  }
  if (fields) {
    const shape = fields.shape as Record<string, z.ZodType>;
    for (const key of Object.keys(shape)) {
      out[key] = shape[key]!;
    }
  }
  return out;
}

export type { ResolverConfig, ResolverContext };
export type { ResolverFn, ResolverRegistry, ResolverSchemas } from "./context.js";
