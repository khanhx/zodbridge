/**
 * `forwardAsync` — the async mapping path. Consumes a resolver graph (Phase 4)
 * for `fromResolver` fields, honors a dynamic `select` set so only requested
 * fields (and their resolver deps) do I/O, and validates with Zod
 * `safeParseAsync` (so async `.refine` runs).
 *
 * Zod 4 constraint: `.pick()`/`.partial()` THROW on object schemas containing
 * refinements, which is exactly the async-refined shape this targets. So a
 * partial `select` is validated against a sub-schema built from the RAW
 * `.shape` (`z.object(pickedShape)`), never by calling `.pick()` on the refined
 * wrapper. Field-level refines on selected fields still run; object-level
 * cross-field refines run only on a full select (documented limitation).
 */
import { z } from "zod";
import { applyForwardRule } from "../map/createMap.js";
import {
  type FromResolver,
  type Rule,
  isFromResolverRule,
  setPath,
} from "../map/rules.js";
import type { ResolverContext } from "../resolver/context.js";

/** Thrown when `select` names a key absent from the dest schema. */
export class UnknownSelectKeyError extends Error {
  readonly keys: string[];
  constructor(keys: string[]) {
    super(
      `forwardAsync select contains key(s) not in the dest schema: ${keys.join(", ")}`,
    );
    this.name = "UnknownSelectKeyError";
    this.keys = keys;
  }
}

type AnyZodObject = z.ZodObject<any>;

interface ForwardAsyncMap<S extends AnyZodObject> {
  readonly schema: S;
  readonly rules: Record<string, Rule | undefined>;
  readonly shape: Record<string, z.ZodType>;
}

export interface ForwardAsyncOptions<Fields, TAdapter> {
  resolver: ResolverContext<Fields, TAdapter>;
  /** Only these dest keys are computed; unselected resolvers never fire. */
  select?: string[];
  /** Opaque extra passed to sync function rules via the source (unused hook). */
  context?: unknown;
}

/**
 * Validate and de-duplicate a `select` list against the dest shape.
 * Unknown keys -> typed {@link UnknownSelectKeyError} (never a raw Zod trace).
 */
export function normalizeSelect(
  select: string[] | undefined,
  shape: Record<string, z.ZodType>,
): string[] | undefined {
  if (select === undefined) return undefined;
  const deduped = Array.from(new Set(select));
  const unknown = deduped.filter(
    (k) => !Object.prototype.hasOwnProperty.call(shape, k),
  );
  if (unknown.length > 0) throw new UnknownSelectKeyError(unknown);
  return deduped;
}

/**
 * Strip a resolver-produced value through its own dest field sub-schema so
 * unknown adapter-row keys (e.g. `passwordHash`) are dropped. NOTE: a field
 * typed `z.any()`/`.passthrough()`/`z.record()` disables this — those leak the
 * value verbatim by design (documented in the README security section).
 */
async function stripField(value: unknown, fieldSchema: z.ZodType): Promise<unknown> {
  const result = await fieldSchema.safeParseAsync(value);
  if (!result.success) return value; // let the full validation surface the error
  return result.data;
}

/**
 * Build a validated DTO asynchronously. `fromResolver` fields pull from the
 * resolver; a resolver throw rejects the whole promise (fail-fast). Returns the
 * full DTO, or a `Partial<Dto>` when `select` is given.
 */
export async function forwardAsync<S extends AnyZodObject, Fields, TAdapter>(
  map: ForwardAsyncMap<S>,
  source: Record<string, unknown>,
  options: ForwardAsyncOptions<Fields, TAdapter>,
): Promise<Partial<z.infer<S>>> {
  const { resolver, select } = options;
  const { schema, rules, shape } = map;

  const selected = normalizeSelect(select, shape);
  const targetKeys = selected ?? Object.keys(shape);

  // Fields resolve sequentially (await per key). The resolver's promise-cache
  // (Phase 4) makes Promise.all safe too, but sequential keeps resolver
  // invocations non-overlapping and is the documented default.
  const assembled: Record<string, unknown> = {};
  for (const key of targetKeys) {
    const rule = rules[key];
    if (isFromResolverRule(rule as Rule)) {
      const field = (rule as FromResolver).field;
      // A resolver throw propagates out of forwardAsync (fail-fast).
      const raw = await resolver.resolve(field as keyof Fields);
      if (raw !== undefined) {
        // `key` is always a key of `shape` (it came from shape keys or a
        // select list validated against shape), so its field schema exists.
        const value = await stripField(raw, shape[key] as z.ZodType);
        setPath(assembled, key, value);
      }
      continue;
    }
    // Sync/computed rules reuse the Phase 3 primitive; an async function rule
    // returns a promise, which we await.
    const produced = applyForwardRule(rule, key, source);
    const value = produced instanceof Promise ? await produced : produced;
    if (value !== undefined) setPath(assembled, key, value);
  }

  // Validate. Full select -> the original schema (all refines run). Partial
  // select -> a sub-schema built from raw .shape (avoids .pick on refined).
  const validator =
    selected === undefined ? schema : buildSubSchema(shape, selected);
  const result = await validator.safeParseAsync(assembled);
  if (!result.success) throw result.error;
  return result.data as Partial<z.infer<S>>;
}

/**
 * Construct a partial-select validator from the dest schema's raw `.shape`,
 * via `z.object(pickedShape)`. Refined wrappers are never `.pick()`-ed (which
 * throws in Zod 4); object-level cross-field refines are intentionally omitted
 * here and run only on a full select.
 */
function buildSubSchema(
  shape: Record<string, z.ZodType>,
  selected: string[],
): z.ZodType {
  const picked: Record<string, z.ZodType> = {};
  for (const key of selected) {
    // `selected` was validated against `shape` by normalizeSelect, so each
    // key is present.
    picked[key] = shape[key] as z.ZodType;
  }
  return z.object(picked);
}
