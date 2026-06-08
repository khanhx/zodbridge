/**
 * Resolver-graph context: dependency-aware, memoizing, cycle-guarded lazy field
 * resolution. A faithful generalization of a `ContextResolver`-style engine.
 *
 * Invariants (do not "optimize" away):
 *  (a) The promise for a field is stored in `cache` BEFORE the first await, so
 *      concurrent `Promise.all` over a shared dep fires its resolver once.
 *  (b) The touched-check (`cache` ∪ `inProgress`) serializes a field's re-entry,
 *      breaking cycles.
 *  (c) A resolver that THROWS rejects and evicts its cache entry — errors are
 *      never coerced to `undefined` and never cached. Only a RETURNED `undefined`
 *      is cached as a terminal value.
 *  (d) `fallback` retries the calling field by re-invoking its resolver FUNCTION
 *      directly, bypassing the step-1 cache short-circuit, so a momentarily
 *      `undefined` field can still resolve once a dependency becomes available.
 *  (e) The calling field for `fallback` is bound per resolver invocation (a
 *      field-bound context), NOT read from shared instance state — so two
 *      fallback-using resolvers running concurrently never contaminate each
 *      other's retry target.
 */
import type { z } from "zod";
import { getPath } from "../map/rules.js";

/** A resolver function for one field; may use the context to derive its value. */
export type ResolverFn<Fields, TAdapter, K extends keyof Fields> = (
  ctx: ResolverContext<Fields, TAdapter>,
) => Fields[K] | undefined | Promise<Fields[K] | undefined>;

/** Registry of per-field resolvers (declarative; not class methods). */
export type ResolverRegistry<Fields, TAdapter> = {
  [K in keyof Fields]?: ResolverFn<Fields, TAdapter, K>;
};

/**
 * Per-field Zod schemas used to validate resolver outputs at runtime. Built by
 * the schema-driven `createResolver` overload from `maps` + `fields`; a field
 * with no entry here is not validated (e.g. hand-written-`Fields` callers).
 */
export type ResolverSchemas<Fields> = Partial<Record<keyof Fields, z.ZodType>>;

/** Construction config for a resolver graph. */
export interface ResolverConfig<Fields, TAdapter> {
  adapter: TAdapter;
  seed?: Partial<Fields>;
  resolvers?: ResolverRegistry<Fields, TAdapter>;
  /**
   * Optional per-field schemas. When present for a field, its resolver's output
   * is parsed (and unknown keys stripped) before caching; a parse failure
   * rejects `resolve` and evicts the entry. Seed values are NOT validated.
   */
  schemas?: ResolverSchemas<Fields>;
  /**
   * Optional observer fired after a field's resolver settles successfully (post
   * validation), for tracing/debugging. Never fired for seed/terminal values.
   * Throwing here does not affect resolution (the hook is best-effort).
   */
  onResolve?: (field: keyof Fields, value: unknown) => void;
}

/** The context object handed to every resolver and returned to callers. */
export interface ResolverContext<Fields, TAdapter> {
  readonly adapter: TAdapter;
  /** Resolve one field: cache -> seed -> resolver -> `undefined`. Memoized. */
  resolve<K extends keyof Fields>(field: K): Promise<Fields[K] | undefined>;
  /** Resolve several fields; returns only the requested keys. */
  resolveMany<K extends keyof Fields>(
    ...fields: K[]
  ): Promise<Partial<Pick<Fields, K>>>;
  /** Cache peek: the resolved value if present, else `undefined`. No I/O. */
  get<K extends keyof Fields>(field: K): Fields[K] | undefined;
  /** Pure nested peek into seed + cache for `field`. Never resolves, never I/O. */
  path<K extends keyof Fields>(field: K, keyPath: string[]): unknown;
  /** Resolve untouched `deps`, then retry the calling field's resolver fn. */
  fallback(deps: Array<keyof Fields>): Promise<unknown>;
  /**
   * Forget a field's cached value (and any settled peek) so the next `resolve`
   * re-runs its resolver. Use after a write to force a fresh fetch from the
   * adapter. Seed values are also dropped for the field. Returns `this`.
   */
  invalidate(...fields: Array<keyof Fields>): ResolverContext<Fields, TAdapter>;
  /** Invalidate then re-resolve `field` — a forced sync re-fetch from the adapter. */
  refresh<K extends keyof Fields>(field: K): Promise<Fields[K] | undefined>;
}

/** Shared empty ancestor set for top-level resolution chains (never mutated). */
const EMPTY_ANCESTORS: ReadonlySet<never> = new Set<never>();

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function defer<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export class GraphContext<Fields, TAdapter>
  implements ResolverContext<Fields, TAdapter>
{
  readonly adapter: TAdapter;
  private readonly seed: Partial<Fields>;
  private readonly resolvers: ResolverRegistry<Fields, TAdapter>;
  private readonly schemas: ResolverSchemas<Fields>;
  private readonly onResolve?: (field: keyof Fields, value: unknown) => void;
  /** Durable promise-cache: every attempted field lives here. */
  private readonly cache = new Map<keyof Fields, Promise<unknown>>();
  /** Synchronously-readable settled values, for `get`/`path` peeks. */
  private readonly settled = new Map<keyof Fields, unknown>();
  /** Fields with an in-flight resolver; transient cycle guard. */
  private readonly inProgress = new Set<keyof Fields>();
  /** Fields explicitly invalidated: prefer the resolver over seed on next resolve. */
  private readonly invalidated = new Set<keyof Fields>();

  constructor(config: ResolverConfig<Fields, TAdapter>) {
    this.adapter = config.adapter;
    this.seed = config.seed ?? {};
    this.resolvers = config.resolvers ?? {};
    this.schemas = config.schemas ?? {};
    this.onResolve = config.onResolve;
  }

  /** Synchronous peek of seed first, then any settled resolved value. */
  private peek<K extends keyof Fields>(field: K): Fields[K] | undefined {
    const seeded = this.seed[field];
    if (seeded !== undefined) return seeded;
    return this.settled.get(field) as Fields[K] | undefined;
  }

  get<K extends keyof Fields>(field: K): Fields[K] | undefined {
    return this.peek(field);
  }

  path<K extends keyof Fields>(field: K, keyPath: string[]): unknown {
    const base = this.peek(field);
    if (base === undefined) return undefined;
    if (keyPath.length === 0) return base;
    return getPath(base, keyPath.join("."));
  }

  /** Public entry: a fresh resolution chain with no ancestors. */
  resolve<K extends keyof Fields>(field: K): Promise<Fields[K] | undefined> {
    return this.resolveWithin(field, EMPTY_ANCESTORS);
  }

  /**
   * Resolve `field` within a chain whose currently-resolving fields are
   * `ancestors`. If `field` is itself an ancestor, this is a dependency cycle
   * (mutual A<->B, longer A->B->C->A, or self x->x): return `undefined` so the
   * caller (e.g. a `strategies` candidate) falls through to its next route,
   * instead of awaiting its own still-pending promise (which would deadlock).
   *
   * The ancestor check runs BEFORE the `cache.has` short-circuit, so a CONCURRENT
   * caller (a parallel `Promise.all` chain — `field` is in-flight but NOT its
   * ancestor) still receives the shared pending promise and dedups normally.
   */
  private resolveWithin<K extends keyof Fields>(
    field: K,
    ancestors: ReadonlySet<keyof Fields>,
  ): Promise<Fields[K] | undefined> {
    // (0) Cycle guard: `field` is being resolved above me in THIS chain.
    if (ancestors.has(field)) {
      return Promise.resolve(undefined) as Promise<Fields[K] | undefined>;
    }

    // (1) Already attempted -> return the (possibly pending) cached promise.
    const cached = this.cache.get(field);
    if (cached !== undefined) return cached as Promise<Fields[K] | undefined>;

    const resolver = this.resolvers[field];
    // After an explicit invalidate, prefer the resolver over seed so `refresh`
    // pulls fresh adapter data instead of the stale seed value.
    const preferResolver = this.invalidated.has(field) && resolver !== undefined;

    // (2) Seed yields a value -> cache a resolved promise.
    const seeded = this.seed[field];
    if (seeded !== undefined && !preferResolver) {
      const p = Promise.resolve(seeded) as Promise<Fields[K] | undefined>;
      this.cache.set(field, p);
      return p;
    }

    // (3) A resolver exists -> store an in-flight promise BEFORE awaiting.
    if (resolver) {
      this.invalidated.delete(field);
      const deferred = defer<Fields[K] | undefined>();
      this.cache.set(field, deferred.promise);
      this.inProgress.add(field);
      // Child chain = my ancestors + me, so a transitive re-entry of `field` trips (0).
      const childAncestors = new Set(ancestors).add(field);
      this.runResolver(field, resolver, deferred, childAncestors);
      return deferred.promise;
    }

    // (4) No seed, no resolver -> terminal `undefined`.
    const p = Promise.resolve(undefined) as Promise<Fields[K] | undefined>;
    this.cache.set(field, p);
    return p;
  }

  /**
   * A context bound to `self` and the chain's `ancestors`: identical to the
   * top-level context except `resolve`/`fallback` carry the chain so cycles
   * break (see {@link resolveWithin}) and `fallback` retries the right field.
   * Binding per invocation (not shared instance state) keeps concurrent
   * resolutions from contaminating each other.
   */
  private boundContext<K extends keyof Fields>(
    self: K,
    ancestors: ReadonlySet<keyof Fields>,
  ): ResolverContext<Fields, TAdapter> {
    return {
      adapter: this.adapter,
      resolve: (field) => this.resolveWithin(field, ancestors),
      resolveMany: (...fields) => this.resolveMany(...fields),
      get: (field) => this.get(field),
      path: (field, keyPath) => this.path(field, keyPath),
      fallback: (deps) => this.fallbackFor(self, deps, ancestors),
      invalidate: (...fields) => this.invalidate(...fields),
      refresh: (field) => this.refresh(field),
    };
  }

  invalidate(...fields: Array<keyof Fields>): ResolverContext<Fields, TAdapter> {
    for (const field of fields) {
      this.cache.delete(field);
      this.settled.delete(field);
      // Only flag fields that have a resolver to prefer — a seed-only field has
      // nothing to prefer over seed, so flagging it would just leak a dead key.
      if (this.resolvers[field] !== undefined) this.invalidated.add(field);
    }
    return this;
  }

  refresh<K extends keyof Fields>(field: K): Promise<Fields[K] | undefined> {
    this.invalidate(field);
    return this.resolve(field);
  }

  /** Fire the best-effort `onResolve` observer; never let it break resolution. */
  private emitResolved(field: keyof Fields, value: unknown): void {
    if (!this.onResolve) return;
    try {
      this.onResolve(field, value);
    } catch {
      // observer is diagnostic only — swallow.
    }
  }

  private runResolver<K extends keyof Fields>(
    field: K,
    resolver: ResolverFn<Fields, TAdapter, K>,
    deferred: Deferred<Fields[K] | undefined>,
    ancestors: ReadonlySet<keyof Fields>,
  ): void {
    const ctx = this.boundContext(field, ancestors);
    Promise.resolve()
      .then(() => resolver(ctx))
      .then((value) => this.validate(field, value))
      .then(
        (value) => {
          this.settled.set(field, value);
          // Settled fields are guarded by the durable cache; drop the transient flag.
          this.inProgress.delete(field);
          this.emitResolved(field, value);
          deferred.resolve(value);
        },
        (error) => {
          // (c) Throw/validation-failure -> evict so a later retry can re-run;
          // never cache as undefined, never serve unvalidated data.
          this.cache.delete(field);
          this.inProgress.delete(field);
          deferred.reject(error);
        },
      );
  }

  /**
   * Validate a resolver's output against its field schema (if any). A defined
   * value is parsed (unknown keys stripped); a parse failure throws the ZodError,
   * which the reject branch turns into an eviction. `undefined` is the forgiving
   * absence terminal and is never validated.
   */
  private async validate<K extends keyof Fields>(
    field: K,
    value: Fields[K] | undefined,
  ): Promise<Fields[K] | undefined> {
    const schema = this.schemas[field];
    if (schema === undefined || value === undefined) return value;
    return (await schema.parseAsync(value)) as Fields[K];
  }

  /** Resolve untouched `deps`, then retry `self`'s resolver if any produced a value. */
  private async fallbackFor<K extends keyof Fields>(
    self: K,
    deps: Array<keyof Fields>,
    ancestors: ReadonlySet<keyof Fields>,
  ): Promise<unknown> {
    let resolvedAny = false;
    for (const dep of deps) {
      // (b) touched-check: skip deps already cached or in progress. This is
      // `fallback`'s own cycle guard and is intentionally SEPARATE from
      // `resolveWithin`'s step-0 ancestor check (which guards direct `c.resolve`
      // re-entry) — both entry points need their own guard; do not merge them.
      if (this.cache.has(dep) || this.inProgress.has(dep)) continue;
      const value = await this.resolveWithin(dep, ancestors);
      if (value) resolvedAny = true;
    }
    if (!resolvedAny) return undefined;
    // (d) Retry the calling field by re-invoking its resolver fn directly with a
    // context still bound to `self` (so nested fallbacks retry the right field).
    // `fallbackFor` is only reachable from a field-bound context built in
    // runResolver, which requires a resolver — so `self`'s resolver exists.
    const resolver = this.resolvers[self] as ResolverFn<Fields, TAdapter, K>;
    return resolver(this.boundContext(self, ancestors));
  }

  /**
   * Top-level `fallback` has no calling field, so there is nothing to retry.
   * Resolvers always receive a field-bound context whose `fallback` does retry;
   * this entry exists only to satisfy the public {@link ResolverContext} shape.
   */
  fallback(_deps: Array<keyof Fields>): Promise<unknown> {
    return Promise.resolve(undefined);
  }

  async resolveMany<K extends keyof Fields>(
    ...fields: K[]
  ): Promise<Partial<Pick<Fields, K>>> {
    // No reset needed: each field clears its own inProgress flag when it settles,
    // and the durable cache is the real guard — safe under concurrent callers.
    const out: Partial<Pick<Fields, K>> = {};
    for (const field of fields) {
      const value = await this.resolve(field);
      if (value !== undefined) out[field] = value as Fields[K];
    }
    return out;
  }
}
