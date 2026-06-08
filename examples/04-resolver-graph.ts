/**
 * Resolver graph: memoized, dependency-aware lazy resolution over an adapter.
 * Run: `npx tsx examples/04-resolver-graph.ts`
 */
import { createResolver } from "zodbridge/resolver";

interface Fields {
  orgId: string;
  org: { id: string; plan: string };
  plan: string;
}
interface Api {
  getOrg: (id: string) => Promise<{ id: string; plan: string }>;
}

const api: Api = {
  getOrg: async (id) => {
    console.log("  fetch org", id);
    return { id, plan: "pro" };
  },
};

const ctx = createResolver<Fields, Api>({
  adapter: api,
  seed: { orgId: "o1" },
  resolvers: {
    org: (c) => c.adapter.getOrg(c.get("orgId") ?? ""),
    plan: async (c) => (await c.resolve("org"))?.plan,
  },
});

async function main() {
  console.log("plan:", await ctx.resolve("plan")); // fetches org once
  console.log("both:", await ctx.resolveMany("org", "plan")); // org NOT re-fetched
  console.log("after write, refresh:", await ctx.refresh("org")); // forced re-fetch
}
void main();
