/**
 * JSON-safe serialize/deserialize: Date/BigInt/Map/Set <-> wire form.
 * Run: `npx tsx examples/03-serialize-deserialize.ts`
 */
import { z } from "zod";
import { serialize, deserialize } from "zodbridge/serialize";

const Event = z.object({
  id: z.bigint(),
  at: z.date(),
  tags: z.set(z.string()),
  counters: z.map(z.string(), z.bigint()),
});

const value = {
  id: 9007199254740993n,
  at: new Date("2024-06-01T00:00:00.000Z"),
  tags: new Set(["a", "b"]),
  counters: new Map([["hits", 10n]]),
};

const wire = serialize(value, Event);
console.log("JSON-safe:", JSON.stringify(wire));
// no Date/BigInt/Map/Set survive — safe to send over the wire

const round = deserialize(JSON.parse(JSON.stringify(wire)), Event);
console.log("round-trips:", round.id === value.id && round.at.getTime() === value.at.getTime());
// true — rich types reconstructed and Zod-validated
