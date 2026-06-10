/**
 * Convert response/JSON key casing without touching values.
 * Run: `npx tsx examples/02-case-conversion.ts`
 */
import { z } from "zod";
import { createMap, toSnakeCase, toCamelCase } from "zodbridge-ts";

const map = createMap(z.object({ id: z.number() }));

// Every mapper instance carries the converters (also exported standalone).
console.log(map.toSnakeCase({ firstName: 1, CreatedAt: 2, "kebab-key": 3 }));
// { first_name: 1, created_at: 2, kebab_key: 3 }

console.log(toCamelCase({ first_name: 1, post_tags: [{ tag_name: "x" }] }));
// { firstName: 1, postTags: [{ tagName: "x" }] }  (recurses objects + arrays)

// Values pass through by reference — only keys change. The return type re-keys
// too: `out` is typed `{ created_at: Date }`.
const at = new Date("2024-01-01T00:00:00Z");
const out = toSnakeCase({ createdAt: at });
console.log("value preserved:", out.created_at === at); // true
