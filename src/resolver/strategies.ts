/**
 * `strategies` — declarative multi-path field resolution. Build a resolver fn
 * from an ordered list of candidate strategies; the first that yields a DEFINED
 * value wins (fastest/cheapest source first). A faithful generalization of the
 * `resolve_conversation`-style pattern (try reservationId, then conversationId,
 * then chatterRefId) without hand-writing the fallthrough each time.
 */
import type { ResolverContext, ResolverFn } from "./context.js";

/**
 * Sentinel returned by a candidate to mean "no value here — fall through to the
 * next strategy", even when its natural result would be `null`. Use this when
 * `null` is a legitimate winning value for the field but a particular path has
 * nothing to offer.
 */
export const SKIP: unique symbol = Symbol("zodbridge.strategies.skip");
export type Skip = typeof SKIP;

/**
 * One candidate way to derive a field. Receives the resolver context (so it can
 * peek seed via `ctx.get`/`ctx.path`, resolve deps via `ctx.resolve`, or call
 * `ctx.adapter`).
 *
 * Return semantics (first DEFINED value wins):
 * - `undefined` → skip (fall through). Ergonomic for `return await ctx.resolve(dep)`,
 *   which yields `undefined` on a cycle/miss and so falls through automatically.
 * - {@link SKIP} → skip (explicit), even if the value would otherwise be `null`.
 * - `null` → WINS — `null` is a defined value.
 * - any other value → WINS.
 * - a thrown error aborts and propagates (NOT a fallthrough).
 */
export type Strategy<Fields, TAdapter, V> = (
  ctx: ResolverContext<Fields, TAdapter>,
) => V | undefined | Skip | Promise<V | undefined | Skip>;

/**
 * Compose ordered strategies into a single resolver fn: each is tried in turn
 * and the first DEFINED result wins. A candidate that returns `undefined` or
 * {@link SKIP} is skipped; `null` (and any other value) is a winning result. If
 * every candidate skips, the field resolves to `undefined`.
 *
 * @example
 * import { strategies, SKIP } from "zodbridge/resolver";
 *
 * createResolver({
 *   adapter,
 *   resolvers: {
 *     conversation: strategies(
 *       (c) => c.adapter.byReservation(c.get("reservationId")),       // undefined -> skip
 *       (c) => c.adapter.byConversationId(c.get("conversationId")) ?? SKIP, // skip even if null
 *       (c) => c.adapter.byChatterRef(c.get("chatterRefId")),
 *     ),
 *   },
 * });
 */
export function strategies<Fields, TAdapter, K extends keyof Fields>(
  ...candidates: Array<Strategy<Fields, TAdapter, Fields[K]>>
): ResolverFn<Fields, TAdapter, K> {
  return async (ctx) => {
    for (const candidate of candidates) {
      const value = await candidate(ctx);
      if (value !== undefined && value !== SKIP) return value as Fields[K];
    }
    return undefined;
  };
}
