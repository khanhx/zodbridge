/**
 * Leaf transforms between rich JS values and their JSON-safe wire forms.
 * Each inverse (wire -> JS) transform validates its input and throws a
 * {@link CodecError} on malformed data, so a hostile wire payload surfaces a
 * typed error instead of a raw `TypeError`/`SyntaxError` or an unbounded stall.
 */

/** Thrown for malformed wire input or unsupported schema nodes during codec walk. */
export class CodecError extends Error {
  /** Path to the offending value, e.g. `user.createdAt`. */
  readonly path: ReadonlyArray<string | number>;
  constructor(message: string, path: ReadonlyArray<string | number> = []) {
    const where = path.length ? ` (at ${path.join(".")})` : "";
    super(`${message}${where}`);
    this.name = "CodecError";
    this.path = path;
  }
}

/** Thrown when `deserialize` is given a schema containing async refinements. */
export class AsyncSchemaError extends Error {
  constructor() {
    super(
      "deserialize is sync-only; this schema has async refinements. " +
        "Remove async .refine()/.superRefine() or validate separately with parseAsync.",
    );
    this.name = "AsyncSchemaError";
  }
}

/**
 * DoS guards on attacker-controlled wire input. A BigInt parsed from a very
 * long numeric string, or a Map rebuilt from a huge entries array, can stall
 * the event loop; these caps reject such input up front.
 */
export const LIMITS = {
  /** Max characters in a BigInt wire string (sign + digits). */
  bigintStringLength: 4096,
  /** Max entries when rebuilding a Map from a wire array. */
  mapEntries: 100_000,
} as const;

// --- Date <-> ISO string ---

export function dateToIso(value: Date, path: ReadonlyArray<string | number>): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new CodecError("expected a valid Date", path);
  }
  return value.toISOString();
}

export function isoToDate(value: unknown, path: ReadonlyArray<string | number>): Date {
  if (typeof value !== "string") {
    throw new CodecError("expected an ISO date string", path);
  }
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    throw new CodecError("invalid ISO date string", path);
  }
  return new Date(ms);
}

// --- BigInt <-> string ---

export function bigintToString(value: bigint, path: ReadonlyArray<string | number>): string {
  if (typeof value !== "bigint") {
    throw new CodecError("expected a bigint", path);
  }
  return value.toString();
}

export function stringToBigint(value: unknown, path: ReadonlyArray<string | number>): bigint {
  if (typeof value !== "string") {
    throw new CodecError("expected a bigint string", path);
  }
  if (value.length > LIMITS.bigintStringLength) {
    throw new CodecError(
      `bigint string exceeds ${LIMITS.bigintStringLength} chars`,
      path,
    );
  }
  if (!/^-?\d+$/.test(value)) {
    throw new CodecError("malformed bigint string", path);
  }
  return BigInt(value);
}

// --- Map <-> entries array ---

export function mapToEntries(
  value: Map<unknown, unknown>,
  path: ReadonlyArray<string | number>,
): Array<[unknown, unknown]> {
  if (!(value instanceof Map)) {
    throw new CodecError("expected a Map", path);
  }
  return Array.from(value.entries());
}

export function entriesToArray(
  value: unknown,
  path: ReadonlyArray<string | number>,
): Array<[unknown, unknown]> {
  if (!Array.isArray(value)) {
    throw new CodecError("expected a Map entries array", path);
  }
  if (value.length > LIMITS.mapEntries) {
    throw new CodecError(`Map entries exceed ${LIMITS.mapEntries}`, path);
  }
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length !== 2) {
      throw new CodecError("malformed Map entry (expected [key, value])", path);
    }
  }
  return value as Array<[unknown, unknown]>;
}

// --- Set <-> array ---

export function setToArray(
  value: Set<unknown>,
  path: ReadonlyArray<string | number>,
): unknown[] {
  if (!(value instanceof Set)) {
    throw new CodecError("expected a Set", path);
  }
  return Array.from(value.values());
}

export function arrayToSetItems(
  value: unknown,
  path: ReadonlyArray<string | number>,
): unknown[] {
  if (!Array.isArray(value)) {
    throw new CodecError("expected a Set values array", path);
  }
  if (value.length > LIMITS.mapEntries) {
    throw new CodecError(`Set values exceed ${LIMITS.mapEntries}`, path);
  }
  return value;
}
