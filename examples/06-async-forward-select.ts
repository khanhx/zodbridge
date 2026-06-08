/**
 * forwardAsync: populate resolver-backed DTO fields, with a dynamic `select`
 * that skips unselected resolver calls (no wasted I/O).
 * Run: `npx tsx examples/06-async-forward-select.ts`
 */
import { z } from "zod";
import { createMap, fromResolver } from "zodbridge";
import { forwardAsync } from "zodbridge/async";
import { createResolver } from "zodbridge/resolver";

const PostDto = z.object({
  id: z.string(),
  author: z.object({ id: z.string(), name: z.string() }),
});

const postMap = createMap(PostDto, { id: "post_id", author: fromResolver("author") });

const resolver = createResolver<{ author: { id: string; name: string } }, object>({
  adapter: {},
  resolvers: {
    author: async () => {
      console.log("  resolving author...");
      return { id: "a1", name: "Ada" };
    },
  },
});

async function main() {
  console.log("full:", await forwardAsync(postMap, { post_id: "p1" }, { resolver }));
  // { id: "p1", author: { id: "a1", name: "Ada" } }

  // select only `id` -> author's resolver never fires
  const fresh = createResolver<{ author: { id: string; name: string } }, object>({
    adapter: {},
    resolvers: { author: async () => ({ id: "a1", name: "Ada" }) },
  });
  console.log("partial:", await forwardAsync(postMap, { post_id: "p1" }, { resolver: fresh, select: ["id"] }));
  // { id: "p1" }
}
void main();
