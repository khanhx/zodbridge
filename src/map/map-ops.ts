/**
 * Composable operations over a {@link TypeMapper}: batch mapping, safe (non-throwing)
 * forward, sub-DTO views (pick/omit), and map composition. Kept out of
 * `createMap.ts` to respect the per-file size budget; `createMap` attaches thin
 * instance wrappers so these are available as both methods and free functions.
 */
import type { z } from "zod";

/** Minimal mapper shape these ops need (avoids importing the full createMap type cycle). */
export interface MappableForward {
  forward(source: Record<string, unknown>): unknown;
  reverse(dto: unknown): Partial<Record<string, unknown>>;
  readonly schema: z.ZodObject<any>;
}

/** Result of {@link safeForward}: a discriminated success/failure union. */
export type SafeResult<T> =
  | { success: true; data: T }
  | { success: false; error: z.ZodError };

/** Forward every item in `sources`, returning the validated DTO array. */
export function forwardMany<M extends MappableForward>(
  map: M,
  sources: Array<Record<string, unknown>>,
): Array<ReturnType<M["forward"]>> {
  return sources.map((s) => map.forward(s)) as Array<ReturnType<M["forward"]>>;
}

/** Reverse every DTO in `dtos`, returning the mapped-source array. */
export function reverseMany<M extends MappableForward>(
  map: M,
  dtos: unknown[],
): Array<Partial<Record<string, unknown>>> {
  return dtos.map((d) => map.reverse(d));
}

/**
 * Forward without throwing: returns `{ success: true, data }` or, on a Zod
 * validation failure, `{ success: false, error }`. Non-Zod errors still throw.
 */
export function safeForward<M extends MappableForward>(
  map: M,
  source: Record<string, unknown>,
): SafeResult<ReturnType<M["forward"]>> {
  try {
    return { success: true, data: map.forward(source) as ReturnType<M["forward"]> };
  } catch (err) {
    if (isZodError(err)) return { success: false, error: err };
    throw err;
  }
}

function isZodError(err: unknown): err is z.ZodError {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { name?: string }).name === "ZodError" &&
    Array.isArray((err as { issues?: unknown }).issues)
  );
}
