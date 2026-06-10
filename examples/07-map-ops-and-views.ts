/**
 * Batch + safe mapping, default values, sub-DTO views, composition, and a
 * resolver graph attached to the map.
 * Run: `npx tsx examples/07-map-ops-and-views.ts`
 */
import { z } from "zod";
import { createMap, withDefault, pick, omit, compose } from "zodbridge-ts";

const UserDto = z.object({ id: z.number(), name: z.string(), role: z.string() });
const userMap = createMap(UserDto, {
  name: "full_name",
  role: withDefault("member", "user_role"), // fall back when source missing
});

// Batch
console.log(userMap.forwardMany([
  { id: 1, full_name: "Ada", user_role: "admin" },
  { id: 2, full_name: "Alan" }, // role -> "member"
]));

// Safe (non-throwing)
console.log(userMap.safeForward({ id: "bad", full_name: "x" }).success); // false

// Sub-DTO views
console.log(pick(userMap, ["id", "name"]).forward({ id: 1, name: "Ada" }));
console.log(Object.keys(omit(userMap, ["role"]).shape)); // ["id","name"]

// Compose two maps into a DTO -> DTO pipeline
const cMap = createMap(z.object({ celsius: z.number() }), { celsius: "c" });
const fMap = createMap(z.object({ fahrenheit: z.number() }), {
  fahrenheit: (s: { celsius: number }) => s.celsius * 1.8 + 32,
});
console.log(compose(cMap, fMap).forward({ c: 100 })); // { fahrenheit: 212 }

// Resolver graph declared on the map itself
interface Api {
  getOrg: (id: string) => Promise<{ id: string; tier: number }>;
}
const orgMap = createMap(
  z.object({ orgId: z.string(), org: z.object({ id: z.string(), tier: z.number() }) }),
  {},
  { resolvers: { org: (c) => (c.adapter as Api).getOrg((c.get("orgId") as string) ?? "") } },
);

async function main() {
  const ctx = orgMap.toResolver<Api>(
    { getOrg: async (id) => ({ id, tier: 3 }) },
    { orgId: "o1" },
  );
  console.log("map.toResolver:", await ctx.resolve("org")); // { id: "o1", tier: 3 }
}
void main();
