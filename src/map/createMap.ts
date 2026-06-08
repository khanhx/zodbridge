/**
 * `createMap(destSchema, rules)` — synchronous, Zod-validated entity -> DTO
 * mapper. The dest Zod schema is the shape source of truth. Simple string
 * renames and `{ to, from }` pairs auto-reverse; computed function rules are
 * one-way unless paired.
 */
import type { z } from "zod";
import { createResolver } from "../resolver/createResolver.js";
import type { ResolverContext, ResolverRegistry } from "../resolver/context.js";
import {
  type CamelCased,
  type SnakeCased,
  toCamelCase,
  toSnakeCase,
} from "./case-convert.js";
import {
  type SafeResult,
  forwardMany as forwardManyOp,
  reverseMany as reverseManyOp,
  safeForward as safeForwardOp,
} from "./map-ops.js";
import {
  type DefaultRule,
  type FromResolver,
  type Rule,
  getPath,
  isDefaultRule,
  isFnRule,
  isFromResolverRule,
  isPairRule,
  isStringRule,
  setPath,
} from "./rules.js";

/**
 * Resolver graph declared on a map: each field of the dest DTO `Dest` may have
 * a resolver typed against `Dest` and the adapter `TAdapter`.
 */
export type MapResolvers<Dest = Record<string, unknown>, TAdapter = unknown> =
  ResolverRegistry<Dest, TAdapter>;

/** Options for {@link createMap}, parameterized by the dest DTO and adapter type. */
export interface CreateMapOptions<Dest = Record<string, unknown>, TAdapter = unknown> {
  /**
   * Resolver graph for this map's fields, against the map's own dest schema.
   * Enables `map.toResolver(adapter)` and resolver-backed `forwardAsync` without
   * a separate `createResolver` call. Each resolver's output is typed against the
   * DTO field it produces. NOTE: `ctx.adapter` is typed as the concrete adapter
   * only at the `toResolver(adapter)` call site — inside these declarations it is
   * `unknown` (the adapter is not known at `createMap` time); cast it if needed.
   */
  resolvers?: MapResolvers<Dest, TAdapter>;
}

/** Thrown when `reverse` meets a one-way function rule that has no inverse. */
export class OneWayRuleError extends Error {
  readonly key: string;
  constructor(key: string) {
    super(
      `Cannot reverse dest key "${key}": it is mapped by a one-way function ` +
        `rule. Use a { to, from } pair rule to make it reversible.`,
    );
    this.name = "OneWayRuleError";
    this.key = key;
  }
}

/** Thrown when `toResolver` is called on a map that declared no resolvers. */
export class MapHasNoResolversError extends Error {
  constructor() {
    super(
      "createMap.toResolver requires a resolver graph: pass " +
        "`createMap(schema, rules, { resolvers })`.",
    );
    this.name = "MapHasNoResolversError";
  }
}

/** Thrown at build time when two rules reverse onto the same source key. */
export class ReverseKeyCollisionError extends Error {
  constructor(sourceKey: string, a: string, b: string) {
    super(
      `Reverse-key collision: dest keys "${a}" and "${b}" both map back to ` +
        `source key "${sourceKey}". Disambiguate one of them.`,
    );
    this.name = "ReverseKeyCollisionError";
  }
}

type AnyZodObject = z.ZodObject<any>;

/** Rule map: each dest key may carry a rule; unmapped keys are copied by name. */
export type RuleMap<Dest> = Partial<Record<keyof Dest & string, Rule>>;

export interface TypeMapper<S extends AnyZodObject, R extends RuleMap<z.infer<S>>> {
  /** Build a validated DTO from a source entity (sync path). */
  forward(source: Record<string, unknown>): z.infer<S>;
  /** Forward every item in a list, returning the validated DTO array. */
  forwardMany(sources: Array<Record<string, unknown>>): Array<z.infer<S>>;
  /** Forward without throwing: `{ success, data }` or `{ success: false, error }`. */
  safeForward(source: Record<string, unknown>): SafeResult<z.infer<S>>;
  /** Invert reversible rules; returns only mapped source fields. */
  reverse(dto: z.infer<S>): Partial<Record<string, unknown>>;
  /** Reverse every DTO in a list. */
  reverseMany(dtos: Array<z.infer<S>>): Array<Partial<Record<string, unknown>>>;
  /**
   * Recursively re-case ALL property keys of `value` to `snake_case`,
   * regardless of their original casing. Keys only; values pass through.
   */
  toSnakeCase<T>(value: T): SnakeCased<T>;
  /**
   * Recursively re-case ALL property keys of `value` to `camelCase`,
   * regardless of their original casing. Keys only; values pass through.
   */
  toCamelCase<T>(value: T): CamelCased<T>;
  /**
   * Build a resolver graph from THIS map's schema fields plus the resolver
   * graph declared in `createMap`'s options. The resolver validates each field's
   * output against the matching dest sub-schema (over-exposure protection).
   * Throws if no `resolvers` were declared on the map.
   */
  toResolver<TAdapter>(
    adapter: TAdapter,
    seed?: Partial<z.infer<S>>,
  ): ResolverContext<z.infer<S>, TAdapter>;
  /** The dest schema (shape source of truth). */
  readonly schema: S;
  /** Configured rules, frozen. */
  readonly rules: R;
  /** Raw `.shape` of the dest object — used by the async path (Phase 5). */
  readonly shape: Record<string, z.ZodType>;
  /** Resolver graph declared on this map (if any), for `toResolver`/forwardAsync. */
  readonly resolvers?: MapResolvers<z.infer<S>>;
}

/** Apply a single forward rule for `destKey`, returning the mapped value. */
export function applyForwardRule(
  rule: Rule | undefined,
  destKey: string,
  source: Record<string, unknown>,
): unknown {
  if (rule === undefined) {
    // No rule: copy by matching dest key from source (dot-path aware).
    return getPath(source, destKey);
  }
  if (isStringRule(rule)) {
    return getPath(source, rule);
  }
  if (isPairRule(rule)) {
    return rule.to(source);
  }
  if (isDefaultRule(rule)) {
    const read = getPath(source, rule.source ?? destKey);
    return read === undefined ? rule.value : read;
  }
  if (isFnRule(rule)) {
    return rule(source);
  }
  // FromResolver markers are resolved only on the async path; sync forward
  // treats them as absent (the field is filled by forwardAsync).
  return undefined;
}

/**
 * Build a two-way mapper. The `const` type parameter on `R` preserves bare
 * object-literal rule values (string-literal renames) without the caller
 * writing `as const` (requires TypeScript >= 5.0).
 */
export function createMap<
  S extends AnyZodObject,
  const R extends RuleMap<z.infer<S>>,
>(
  schema: S,
  rules: R = {} as R,
  options: CreateMapOptions<z.infer<S>> = {},
): TypeMapper<S, R> {
  const shape = schema.shape as Record<string, z.ZodType>;
  const destKeys = Object.keys(shape);
  const mapResolvers = options.resolvers;

  // Build-time reverse-collision detection: any two reversible rules whose
  // inverse targets the same source key are a configuration error.
  const reverseTargets = new Map<string, string>();
  for (const destKey of Object.keys(rules) as Array<keyof R & string>) {
    const rule = rules[destKey] as Rule | undefined;
    if (rule !== undefined && isStringRule(rule)) {
      const existing = reverseTargets.get(rule);
      if (existing) throw new ReverseKeyCollisionError(rule, existing, destKey);
      reverseTargets.set(rule, destKey);
    }
  }

  function forward(source: Record<string, unknown>): z.infer<S> {
    const out: Record<string, unknown> = {};
    for (const destKey of destKeys) {
      const rule = rules[destKey as keyof R & string] as Rule | undefined;
      if (isFromResolverRule(rule as Rule)) continue; // async-only
      const value = applyForwardRule(rule, destKey, source);
      if (value !== undefined) setPath(out, destKey, value);
    }
    return schema.parse(out) as z.infer<S>;
  }

  function reverse(dto: z.infer<S>): Partial<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    const dtoObj = dto as Record<string, unknown>;
    for (const destKey of Object.keys(rules) as Array<keyof R & string>) {
      const rule = rules[destKey] as Rule | undefined;
      if (rule === undefined) continue;
      const destValue = getPath(dtoObj, destKey);
      if (isStringRule(rule)) {
        setPath(out, rule, destValue);
      } else if (isPairRule(rule)) {
        setPath(out, destKey, rule.from(destValue));
      } else if (isDefaultRule(rule)) {
        // Round-trip the read key; the default itself is forward-only.
        setPath(out, (rule as DefaultRule).source ?? destKey, destValue);
      } else if (isFromResolverRule(rule as Rule)) {
        // Resolver-backed fields have no source inverse; skip.
        continue;
      } else {
        // One-way function rule, no inverse.
        throw new OneWayRuleError(destKey);
      }
    }
    return out;
  }

  type Dest = z.infer<S>;

  function toResolver<TAdapter>(
    adapter: TAdapter,
    seed?: Partial<Dest>,
  ): ResolverContext<Dest, TAdapter> {
    if (!mapResolvers) {
      throw new MapHasNoResolversError();
    }
    // Per-field schemas from this map's own shape (over-exposure protection).
    const schemas: Record<string, z.ZodType> = {};
    for (const key of Object.keys(shape)) {
      schemas[key] = shape[key] as z.ZodType;
    }
    return createResolver<Dest, TAdapter>({
      adapter,
      seed,
      resolvers: mapResolvers as ResolverRegistry<Dest, TAdapter>,
      schemas: schemas as Record<keyof Dest, z.ZodType>,
    });
  }

  const mapper: TypeMapper<S, R> = {
    forward,
    reverse,
    forwardMany: (sources) => forwardManyOp(mapper, sources) as Array<Dest>,
    reverseMany: (dtos) => reverseManyOp(mapper, dtos),
    safeForward: (source) => safeForwardOp(mapper, source) as SafeResult<Dest>,
    toSnakeCase,
    toCamelCase,
    toResolver,
    schema,
    rules: Object.freeze({ ...rules }) as R,
    shape,
    resolvers: mapResolvers,
  };
  return mapper;
}

export type { FromResolver };
