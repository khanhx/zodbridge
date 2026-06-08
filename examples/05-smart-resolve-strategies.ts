/**
 * Smart resolve: try multiple sources, fastest-first. A conversation can be
 * found by reservationId, conversationId, or chatterRefId — whichever resolves.
 *
 * First DEFINED value wins. A candidate skips by returning `undefined` or the
 * `SKIP` sentinel; `null` is a winning value (use `SKIP` to skip when the value
 * would be `null`).
 * Run: `npx tsx examples/05-smart-resolve-strategies.ts`
 */
import { SKIP, createResolver, strategies } from "zodbridge/resolver";

interface Fields {
  reservationId: string;
  conversationId: string;
  chatterRefId: string;
  conversation: { id: string; via: string };
}
interface Api {
  byReservation: (id?: string) => Promise<{ id: string; via: string } | undefined>;
  byConversationId: (id?: string) => Promise<{ id: string; via: string } | undefined>;
  byChatterRef: (id?: string) => Promise<{ id: string; via: string } | undefined>;
}

const api: Api = {
  byReservation: async (id) => (id ? { id, via: "reservation" } : undefined),
  byConversationId: async (id) => (id ? { id, via: "conversationId" } : undefined),
  byChatterRef: async (id) => (id ? { id, via: "chatterRef" } : undefined),
};

const make = (seed: Partial<Fields>) =>
  createResolver<Fields, Api>({
    adapter: api,
    seed,
    resolvers: {
      conversation: strategies<Fields, Api, "conversation">(
        (c) => c.adapter.byReservation(c.get("reservationId")),
        (c) => c.adapter.byConversationId(c.get("conversationId")),
        (c) => c.adapter.byChatterRef(c.get("chatterRefId")),
      ),
    },
  });

async function main() {
  console.log("via reservation:", await make({ reservationId: "r1" }).resolve("conversation"));
  console.log("via chatterRef:", await make({ chatterRefId: "ch1" }).resolve("conversation"));
  console.log("none:", await make({}).resolve("conversation")); // undefined

  // null is a winning value; SKIP explicitly falls through.
  const r = createResolver<{ flag: boolean | null }, object>({
    adapter: {},
    resolvers: {
      flag: strategies<{ flag: boolean | null }, object, "flag">(
        () => SKIP, // skip (even though we could return null here)
        () => null, // WINS — a real "explicitly unset" value
      ),
    },
  });
  console.log("flag (null wins):", await r.resolve("flag")); // null
}
void main();
