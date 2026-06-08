/**
 * Rule kinds for {@link createMap} and the dot-path get/set helpers they use.
 *
 * Rule kinds (by JS type):
 * - `string`            — rename: copy `source[ruleValue]` to the dest key. Auto-reversible.
 * - `(source) => value` — computed function, one-way (no reverse unless paired).
 * - `{ to, from }`      — explicit both-directions, reversible.
 * - `FromResolver`      — value pulled from a resolver graph (async path, Phase 5).
 */

/** A function rule: derive a dest value from the whole source object. */
export type FnRule<S, V> = (source: S) => V;

/** A reversible rule with explicit forward (`to`) and inverse (`from`) maps. */
export interface PairRule<S, V> {
  to: (source: S) => V;
  from: (value: V) => unknown;
}

/** Marker for a dest field resolved from a resolver graph (consumed by Phase 5). */
export interface FromResolver {
  readonly __kind: "fromResolver";
  readonly field: string;
}

/**
 * Default-value rule: read `source` (a source key, defaults to the dest key)
 * and fall back to `value` when the source is `undefined`. Reverse-safe: the
 * default is dropped on reverse and only the read key round-trips.
 */
export interface DefaultRule<V = unknown> {
  readonly __kind: "default";
  readonly value: V;
  readonly source?: string;
}

/** Any rule a dest key may be configured with. */
export type Rule<S = any, V = any> =
  | string
  | FnRule<S, V>
  | PairRule<S, V>
  | FromResolver
  | DefaultRule<V>;

/** Build a {@link FromResolver} marker for `field` in the resolver graph. */
export function fromResolver(field: string): FromResolver {
  return { __kind: "fromResolver", field };
}

/**
 * Build a {@link DefaultRule}: use `source` (or the dest key) from the entity,
 * falling back to `value` when absent.
 */
export function withDefault<V>(value: V, source?: string): DefaultRule<V> {
  return { __kind: "default", value, source };
}

// --- type guards ---

export function isStringRule(rule: Rule): rule is string {
  return typeof rule === "string";
}

export function isFromResolverRule(rule: Rule): rule is FromResolver {
  return (
    typeof rule === "object" &&
    rule !== null &&
    (rule as FromResolver).__kind === "fromResolver"
  );
}

export function isPairRule(rule: Rule): rule is PairRule<any, any> {
  return (
    typeof rule === "object" &&
    rule !== null &&
    typeof (rule as PairRule<any, any>).to === "function" &&
    typeof (rule as PairRule<any, any>).from === "function"
  );
}

export function isDefaultRule(rule: Rule): rule is DefaultRule {
  return (
    typeof rule === "object" &&
    rule !== null &&
    (rule as DefaultRule).__kind === "default"
  );
}

export function isFnRule(rule: Rule): rule is FnRule<any, any> {
  return typeof rule === "function";
}

// --- prototype-pollution-safe dot-path helpers ---

/** Path segments that, if written, could poison `Object.prototype`. */
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function isForbidden(key: string): boolean {
  return FORBIDDEN_KEYS.has(key);
}

/** Split a dot-path into segments. A plain key (no dot) yields a single segment. */
export function splitPath(path: string): string[] {
  return path.split(".");
}

/**
 * Read a nested value by dot-path. Returns `undefined` if any segment is
 * missing or if a segment is a forbidden prototype key (read is skipped, not
 * served from the prototype chain).
 */
export function getPath(source: unknown, path: string): unknown {
  let current: unknown = source;
  for (const segment of splitPath(path)) {
    if (isForbidden(segment)) return undefined;
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Write a nested value by dot-path, auto-vivifying intermediate objects.
 * Forbidden prototype keys at any segment are skipped entirely, so a hostile
 * `__proto__.isAdmin` path can never mutate `Object.prototype`.
 */
export function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = splitPath(path);
  let current: Record<string, unknown> = target;
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i] as string;
    if (isForbidden(segment)) return;
    if (i === segments.length - 1) {
      current[segment] = value;
      return;
    }
    const next = current[segment];
    if (typeof next !== "object" || next === null) {
      const fresh: Record<string, unknown> = {};
      current[segment] = fresh;
      current = fresh;
    } else {
      current = next as Record<string, unknown>;
    }
  }
}
