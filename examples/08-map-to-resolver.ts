/**
 * map.toResolver: declare a resolver graph ON the map (against its own typed
 * fields), then build a memoizing, validated resolver from it. The graph lives
 * with the schema — no separate createResolver wiring.
 * Run: `npx tsx examples/08-map-to-resolver.ts`
 */
import { z } from "zod";
import { createMap } from "zodbridge";

// The map's schema defines BOTH the field types and the validation applied to
// each resolver's output (unknown keys are stripped — over-exposure protection).
const ContextDto = z.object({
  orgId: z.string(),
  org: z.object({ id: z.string(), name: z.string() }),
  member: z.object({ id: z.string(), orgName: z.string() }),
});

interface Api {
  getOrg: (id: string) => Promise<{ id: string; name: string }>;
  getMember: (orgId: string) => Promise<{ id: string; orgName: string }>;
}

// Resolvers are declared in createMap's third arg, keyed by the schema's fields.
const contextMap = createMap(
  ContextDto,
  {},
  {
    resolvers: {
      org: (ctx) => (ctx.adapter as Api).getOrg((ctx.get("orgId") as string) ?? ""),
      member: async (ctx) => {
        // chaining: resolve `org` first, then derive `member` from it.
        // `org` is strongly typed as the schema's DTO ({ id, name } | undefined).
        const org = await ctx.resolve("org");
        return org
          ? { ...(await (ctx.adapter as Api).getMember(org.id)), orgName: org.name }
          : undefined;
      },
    },
  },
);

const api: Api = {
  getOrg: async (id) => {
    console.log("  fetch org", id);
    return { id, name: "Acme" };
  },
  getMember: async (orgId) => ({ id: `m-${orgId}`, orgName: "" }),
};

async function main() {
  // Build a resolver bound to an adapter + seed; cache lives on this instance.
  const ctx = contextMap.toResolver<Api>(api, { orgId: "o1" });

  console.log("org:", await ctx.resolve("org")); // { id: "o1", name: "Acme" }
  console.log("member:", await ctx.resolve("member")); // org NOT re-fetched (memoized)

  // Resolve several at once; returns only the requested keys.
  console.log("many:", await ctx.resolveMany("orgId", "org"));

  // Output validation: an adapter row with an extra column is stripped to the schema.
  const leaky = contextMap.toResolver<Api>(
    { ...api, getOrg: async (id) => ({ id, name: "Acme", secret: "LEAK" }) as never },
    { orgId: "o1" },
  );
  console.log("stripped:", await leaky.resolve("org")); // no `secret` key

  // Force a fresh fetch after an upstream write.
  console.log("refresh:", await ctx.refresh("org")); // fetch org again
}
void main();
