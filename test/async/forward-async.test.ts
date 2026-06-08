import { describe, expect, it } from "vitest";
import { z } from "zod";
import { forwardAsync } from "../../src/async/forwardAsync.js";
import { createMap } from "../../src/map/createMap.js";
import { fromResolver } from "../../src/map/rules.js";
import { createResolver } from "../../src/resolver/createResolver.js";

interface Fields {
  author: { id: string; name: string };
}
interface Api {
  getAuthor: (id: string) => Promise<{ id: string; name: string }>;
}

describe("forwardAsync — resolver-backed fields", () => {
  const destSchema = z.object({
    id: z.string(),
    author: z.object({ id: z.string(), name: z.string() }),
  });
  const map = createMap(destSchema, {
    id: "post_id",
    author: fromResolver("author"),
  });

  const buildResolver = () =>
    createResolver<Fields, Api>({
      adapter: { getAuthor: async (id) => ({ id, name: `Author ${id}` }) },
      resolvers: { author: () => ({ id: "a1", name: "Author a1" }) },
    });

  it("resolves a fromResolver field via the resolver and returns a validated DTO", async () => {
    const dto = await forwardAsync(map, { post_id: "p1" }, { resolver: buildResolver() });
    expect(dto).toEqual({
      id: "p1",
      author: { id: "a1", name: "Author a1" },
    });
  });

  it("applies independent sync rules alongside async fields", async () => {
    const m = createMap(
      z.object({ id: z.string(), shout: z.string(), author: z.object({ id: z.string(), name: z.string() }) }),
      {
        id: "post_id",
        shout: (s: { post_id: string }) => s.post_id.toUpperCase(),
        author: fromResolver("author"),
      },
    );
    const dto = await forwardAsync(m, { post_id: "p1" }, { resolver: buildResolver() });
    expect(dto).toMatchObject({ id: "p1", shout: "P1" });
  });

  it("awaits an async function rule", async () => {
    const m = createMap(z.object({ slug: z.string() }), {
      slug: async (s: { title: string }) => Promise.resolve(s.title.toLowerCase()),
    });
    const r = createResolver<Record<string, never>, object>({ adapter: {} });
    const dto = await forwardAsync(m, { title: "Hello" }, { resolver: r });
    expect(dto).toEqual({ slug: "hello" });
  });

  it("a fromResolver field whose resolver returns undefined is omitted", async () => {
    const m = createMap(
      z.object({ id: z.string(), author: z.object({ id: z.string(), name: z.string() }).optional() }),
      { id: "post_id", author: fromResolver("author") },
    );
    const r = createResolver<{ author: undefined }, object>({
      adapter: {},
      resolvers: { author: () => undefined },
    });
    const dto = await forwardAsync(m, { post_id: "p1" }, { resolver: r });
    expect(dto).toEqual({ id: "p1" });
    expect("author" in dto).toBe(false);
  });

  it("resolver throw rejects the whole forwardAsync (fail-fast)", async () => {
    const r = createResolver<Fields, Api>({
      adapter: { getAuthor: async () => ({ id: "", name: "" }) },
      resolvers: {
        author: () => {
          throw new Error("Forbidden");
        },
      },
    });
    await expect(forwardAsync(map, { post_id: "p1" }, { resolver: r })).rejects.toThrow(
      "Forbidden",
    );
  });

  it("regression: sync forward (Phase 3) still works for non-resolver rules", () => {
    const m = createMap(z.object({ id: z.string(), upper: z.string() }), {
      id: "post_id",
      upper: (s: { post_id: string }) => s.post_id.toUpperCase(),
    });
    expect(m.forward({ post_id: "p1" })).toEqual({ id: "p1", upper: "P1" });
  });
});
