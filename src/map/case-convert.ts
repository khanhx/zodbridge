/**
 * Recursive object-key case conversion. `toSnakeCase`/`toCamelCase` re-case ALL
 * property keys of a value to the target case regardless of the input keys'
 * original casing (snake, camel, Pascal, kebab, SCREAMING_SNAKE all normalize).
 *
 * Only KEYS change. Values pass through untouched; recursion descends plain
 * objects and arrays only — Dates, Maps, Sets, class instances, and primitives
 * are returned as-is so their internal data is never reshaped.
 */

/** Keys that would poison `Object.prototype` — never emitted as output keys. */
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

/**
 * Split an identifier into lowercase word tokens, the casing-neutral form every
 * target case is rebuilt from. Handles delimiters (`_`, `-`, space), camel/Pascal
 * humps, acronym runs (`HTTPServer` -> `http`,`server`), and digit groups.
 */
export function splitWords(key: string): string[] {
  return (
    key
      // acronym followed by a word: "HTTPServer" -> "HTTP Server"
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      // lower/digit followed by upper: "fooBar"/"foo2Bar" -> "foo Bar"
      .replace(/([a-z\d])([A-Z])/g, "$1 $2")
      // letter followed by digit group: "v2" -> "v 2"
      .replace(/([A-Za-z])(\d)/g, "$1 $2")
      // any non-alphanumeric run is a delimiter
      .split(/[^A-Za-z0-9]+/)
      .filter((w) => w.length > 0)
      .map((w) => w.toLowerCase())
  );
}

/** Convert a single key to `snake_case`; leave unconvertible keys untouched. */
export function toSnakeKey(key: string): string {
  const words = splitWords(key);
  // Nothing tokenizable (e.g. "$$$", "_") -> leave the key as-is rather than
  // collapsing it to "" and losing the property.
  if (words.length === 0) return key;
  return words.join("_");
}

/** Convert a single key to `camelCase`; leave unconvertible keys untouched. */
export function toCamelKey(key: string): string {
  const words = splitWords(key);
  if (words.length === 0) return key;
  return words
    .map((word, i) => (i === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join("");
}

/** True only for plain objects (own data records), not Date/Map/Set/class instances. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function convert(value: unknown, keyFn: (key: string) => string): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => convert(item, keyFn));
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      const converted = keyFn(key);
      if (FORBIDDEN_KEYS.has(converted)) continue;
      out[converted] = convert(value[key], keyFn);
    }
    return out;
  }
  // Primitives, Date, Map, Set, class instances: returned unchanged.
  return value;
}

// --- type-level key re-casing ---
//
// These mapped types model the COMMON case — camelCase/PascalCase <-> snake_case
// on plain identifier keys (`firstName` <-> `first_name`). They intentionally do
// NOT replicate the full runtime tokenizer: acronym grouping (`HTTPServer`),
// digit boundaries, kebab/space delimiters, and multiple leading underscores
// (`__id`) can yield a type that differs from the runtime key. For normal DTO
// keys the type is exact; for these exotic cases the runtime is authoritative.
// Values are preserved (only keys change), and Date/Map/Set/array/primitive are
// passed through untouched.

/** Insert `_` before each interior uppercase letter, then lowercase. */
type CamelToSnake<S extends string> = S extends `${infer Head}${infer Tail}`
  ? Head extends Uppercase<Head>
    ? Head extends Lowercase<Head>
      ? `${Head}${CamelToSnake<Tail>}` // digit/symbol: no separator
      : `_${Lowercase<Head>}${CamelToSnake<Tail>}`
    : `${Head}${CamelToSnake<Tail>}`
  : S;

/** Drop a single leading `_` produced when the first letter was uppercase. */
type StripLeadingUnderscore<S extends string> = S extends `_${infer Rest}` ? Rest : S;

type SnakeKey<S extends string> = StripLeadingUnderscore<CamelToSnake<S>>;

/** Collapse `_x` groups into `X` (snake/kebab -> camelCase). */
type SnakeToCamel<S extends string> = S extends `${infer Head}_${infer Tail}`
  ? `${Head}${Capitalize<SnakeToCamel<Tail>>}`
  : S extends `${infer Head}-${infer Tail}`
    ? `${Head}${Capitalize<SnakeToCamel<Tail>>}`
    : S;

/** Public type of {@link toSnakeCase}: keys recursively snake_cased. */
export type SnakeCased<T> = T extends Array<infer E>
  ? Array<SnakeCased<E>>
  : T extends Date | Map<unknown, unknown> | Set<unknown>
    ? T
    : T extends object
      ? { [K in keyof T as K extends string ? SnakeKey<K> : K]: SnakeCased<T[K]> }
      : T;

/** Public type of {@link toCamelCase}: keys recursively camelCased. */
export type CamelCased<T> = T extends Array<infer E>
  ? Array<CamelCased<E>>
  : T extends Date | Map<unknown, unknown> | Set<unknown>
    ? T
    : T extends object
      ? { [K in keyof T as K extends string ? SnakeToCamel<K> : K]: CamelCased<T[K]> }
      : T;

/**
 * Recursively re-case all property keys of `value` to `snake_case`. The return
 * type maps keys for the common identifier case (see {@link SnakeCased}).
 */
export function toSnakeCase<T>(value: T): SnakeCased<T> {
  return convert(value, toSnakeKey) as SnakeCased<T>;
}

/**
 * Recursively re-case all property keys of `value` to `camelCase`. The return
 * type maps keys for the common identifier case (see {@link CamelCased}).
 */
export function toCamelCase<T>(value: T): CamelCased<T> {
  return convert(value, toCamelKey) as CamelCased<T>;
}

const capitalize = (word: string): string =>
  word.charAt(0).toUpperCase() + word.slice(1);

/** Convert a single key to `kebab-case`; leave unconvertible keys untouched. */
export function toKebabKey(key: string): string {
  const words = splitWords(key);
  if (words.length === 0) return key;
  return words.join("-");
}

/** Convert a single key to `PascalCase`; leave unconvertible keys untouched. */
export function toPascalKey(key: string): string {
  const words = splitWords(key);
  if (words.length === 0) return key;
  return words.map(capitalize).join("");
}

/** Convert a single key to `CONSTANT_CASE`; leave unconvertible keys untouched. */
export function toConstantKey(key: string): string {
  const words = splitWords(key);
  if (words.length === 0) return key;
  return words.join("_").toUpperCase();
}

/** Recursively re-case all property keys of `value` to `kebab-case`. */
export function toKebabCase<T = unknown>(value: T): T {
  return convert(value, toKebabKey) as T;
}

/** Recursively re-case all property keys of `value` to `PascalCase`. */
export function toPascalCase<T = unknown>(value: T): T {
  return convert(value, toPascalKey) as T;
}

/** Recursively re-case all property keys of `value` to `CONSTANT_CASE`. */
export function toConstantCase<T = unknown>(value: T): T {
  return convert(value, toConstantKey) as T;
}
