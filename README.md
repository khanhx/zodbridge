# zodbridge-ts

[![CI](https://github.com/khanhx/zodbridge/actions/workflows/ci.yml/badge.svg)](https://github.com/khanhx/zodbridge/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/khanhx/zodbridge/branch/main/graph/badge.svg)](https://codecov.io/gh/khanhx/zodbridge)
[![npm version](https://img.shields.io/npm/v/zodbridge-ts.svg)](https://www.npmjs.com/package/zodbridge-ts)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

Schema-first, **decorator-free**, **Zod 4**-driven mapping toolkit for the
DB-entity ↔ response-DTO boundary. No `reflect-metadata`, no class decorators —
your Zod schema is the single source of truth.

Four composable pillars, each available as its own sub-export:

1. **Two-way mapper** (`createMap`) — entity → DTO with auto-reversible renames.
2. **Serialize / deserialize** — JSON-safe codec (Date ↔ ISO, BigInt ↔ string, Map ↔ entries).
3. **Resolver graph** (`createResolver`) — dependency-aware, memoizing, cycle-guarded lazy field resolution over an injected fetch adapter.
4. **Async mapping** (`forwardAsync`) — resolver-backed fields + a dynamic `select` set, validated with async Zod.

```bash
npm install zodbridge-ts zod
```

> **Zod 4 required.** `zod` is a peer dependency pinned to `^4`. The codec
> dispatches on Zod 4's internal `_zod.def.type`; **Zod 3 is not supported.**

TypeScript ≥ 5.0 is required for the `const` type parameter `createMap` uses to
preserve bare rule literals.

## Contents

- [1. Two-way mapper — `createMap`](#1-two-way-mapper--createmap)
  - [Built-in key case conversion](#built-in-key-case-conversion)
- [2. Serialize / deserialize](#2-serialize--deserialize)
- [3. Resolver graph — `createResolver`](#3-resolver-graph--createresolver)
  - [Schema-driven resolvers](#schema-driven-resolvers-validated-output)
- [4. Async mapping — `forwardAsync`](#4-async-mapping--forwardasync)
- [Map ops & resolver extras](#map-ops--resolver-extras)
- [Security](#security)
- [API surface](#api-surface)
- [Examples](#examples)
- [Contributing](#contributing)

---

## 1. Two-way mapper — `createMap`

The dest Zod schema defines the DTO shape. Rules describe how each dest field is
produced from the source entity:

- `'sourceKey'` — string **rename** (auto-reversible, dot-paths supported).
- `(source) => value` — **computed** function (one-way).
- `{ to, from }` — explicit **both-directions** (reversible).

```ts
import { createMap } from "zodbridge-ts";
import { z } from "zod";

const UserDto = z.object({
  id: z.number(),
  fullName: z.string(),
  createdAt: z.string(),
});

const userMap = createMap(UserDto, {
  fullName: (u: { first: string; last: string }) => `${u.first} ${u.last}`,
  createdAt: "created_at", // rename
});

const dto = userMap.forward({ id: 1, first: "Ada", last: "Lovelace", created_at: "2024-01-01" });
// → { id: 1, fullName: "Ada Lovelace", createdAt: "2024-01-01" }  (Zod-validated)

userMap.reverse(dto);
// → { created_at: "2024-01-01" }   (only reversible-mapped source fields)
```

`reverse` emits **only the mapped fields**; a one-way function rule throws
`OneWayRuleError`. Use a `{ to, from }` pair to make a transform reversible.

### Built-in key case conversion

Every mapper instance also has `toSnakeCase` / `toCamelCase` — they recursively
re-case **all** property keys of a value to the target case, no matter the input
casing (snake, camel, Pascal, kebab, SCREAMING_SNAKE all normalize). Only keys
change; values pass through. Mixed-casing objects are converted per key — a key
that can't be tokenized is left as-is.

```ts
userMap.toSnakeCase({ firstName: 1, CreatedAt: 2, "kebab-key": 3 });
// → { first_name: 1, created_at: 2, kebab_key: 3 }

userMap.toCamelCase({ first_name: 1, post_tags: [{ tag_name: "x" }] });
// → { firstName: 1, postTags: [{ tagName: "x" }] }   (recurses objects + arrays)
```

The same functions are exported standalone (and per-key variants too):

```ts
import { toSnakeCase, toCamelCase, toSnakeKey, toCamelKey } from "zodbridge-ts";
```

Notes:
- **Collisions:** if two source keys normalize to the same target (e.g. `userId`
  and `userID` → `user_id`), the last one in iteration order wins.
- **Safety:** a source key that normalizes to `constructor` or `prototype` is
  dropped (never emitted) to prevent prototype pollution.
- **Idempotency:** `toSnakeCase` is idempotent. `toCamelCase` is too, except for
  keys that produce adjacent single-letter words (`a-b` → `aBCD` → `aBcd`) — an
  unusual shape for real DTO keys.

---

## 2. Serialize / deserialize

JSON-safe round-trip driven by the schema. `serialize` converts rich values to
JSON-safe plain values; `deserialize` rebuilds them and validates with Zod.

```ts
import { serialize, deserialize } from "zodbridge-ts/serialize";
import { z } from "zod";

const Event = z.object({ id: z.bigint(), at: z.date(), tally: z.map(z.string(), z.bigint()) });

const wire = serialize({ id: 42n, at: new Date(), tally: new Map([["a", 1n]]) }, Event);
JSON.stringify(wire); // safe — no Date/BigInt/Map left

deserialize(wire, Event); // → original rich values, Zod-validated
```

`deserialize` is **sync-only**; a schema with async refinements throws
`AsyncSchemaError`. Malformed wire input surfaces a typed `CodecError` (never a
raw throw), and BigInt-string length / Map-entry count are bounded against DoS.

---

## 3. Resolver graph — `createResolver`

Declarative, dependency-aware field resolution. Each field's resolver may read
the seed, call the injected `adapter`, depend on other fields (`resolve`), or
fall back to alternate sources (`fallback`). Results are **memoized** (one fetch
per field, even under `Promise.all`), and cycles are guarded.

```ts
import { createResolver } from "zodbridge-ts/resolver";

interface Fields { orgId: string; org: { id: string; plan: string }; plan: string }
interface Api { getOrg: (id: string) => Promise<{ id: string; plan: string }> }

// your injected data source (DB client, HTTP API, etc.)
const api: Api = {
  getOrg: async (id) => ({ id, plan: "pro" }),
};

const ctx = createResolver<Fields, Api>({
  adapter: api,
  seed: { orgId: "o1" },
  resolvers: {
    org: (c) => c.adapter.getOrg(c.get("orgId") ?? ""),
    plan: async (c) => (await c.resolve("org"))?.plan,
  },
});

await ctx.resolve("plan");            // → "pro"  (fetches org once, derives plan)
await ctx.resolveMany("org", "plan"); // { org, plan } — org NOT re-fetched
```

- `get(field)` — synchronous peek of seed + already-resolved values (no I/O).
- `path(field, [..keys])` — pure nested peek (never resolves, never fetches).
- `fallback([deps])` — resolve untouched deps, then retry the calling field.

A resolver that **returns `undefined`** caches `undefined` (forgiving absence).
A resolver that **throws** rejects and is **not cached** — auth/DB failures stay
loud and a later retry can succeed.

**Cycles never hang.** Mutually dependent fields are safe: if `conversation`'s
resolver does `await ctx.resolve("reservation")` and `reservation`'s does
`await ctx.resolve("conversation")`, a re-entry of a field already being resolved
in the same chain returns `undefined` (so a `strategies` candidate falls through
to its next route) — it never deadlocks. Concurrent
`Promise.all` over a shared dependency is unaffected and still dedups to one fetch.

### Schema-driven resolvers (validated output)

Instead of a hand-written `Fields` type, derive the resolvable fields and their
schemas from `createMap` instances. Each resolver's **output is validated** against
its map's schema (unknown keys stripped) before caching — bad adapter data and
over-exposure are caught at the boundary. Pass scalar dependency fields (with no
DTO) via an optional `fields` object.

```ts
import { createResolver } from "zodbridge-ts/resolver";
import { createMap } from "zodbridge-ts";
import { z } from "zod";

const userMap = createMap(z.object({ id: z.string(), name: z.string() }));
const orgMap = createMap(z.object({ orgId: z.string(), tier: z.number() }));

const api = {
  getOrg: async (orgId: string) => ({ orgId, tier: 2 }),
  getUser: async (orgId: string) => ({ id: `u-${orgId}`, name: "Ada" }),
};

const ctx = createResolver({
  adapter: api,
  maps: { user: userMap, org: orgMap },    // validated DTO fields
  fields: z.object({ orgId: z.string() }), // scalar deps (no DTO)
  seed: { orgId: "o1" },
  resolvers: {
    org: (c) => c.adapter.getOrg(c.get("orgId") ?? ""),  // typed as orgMap's DTO
    user: async (c) => {
      const org = await c.resolve("org");                // chaining
      return c.adapter.getUser(org?.orgId ?? "");        // typed as userMap's DTO
    },
  },
});

await ctx.resolve("user"); // → { id: "u-o1", name: "Ada" }  (validated, or rejects)
```

- Resolver output is parsed; a value that fails its schema **rejects and evicts**
  (same loud-failure policy as a thrown resolver).
- **Seed is not validated** — it is trusted caller input (allows partial/scalar seed).
- The hand-written `createResolver<Fields, Adapter>(...)` signature still works
  unchanged (no runtime validation when no schema is attached).

---

## 4. Async mapping — `forwardAsync`

Combine the mapper and the resolver. The `fromResolver` rule pulls a field from
the resolver graph; an optional `select` set restricts which fields (and which
resolver calls) run.

```ts
import { createMap, fromResolver } from "zodbridge-ts";
import { forwardAsync } from "zodbridge-ts/async";
import { createResolver } from "zodbridge-ts/resolver";
import { z } from "zod";

const PostDto = z.object({
  id: z.string(),
  author: z.object({ id: z.string(), name: z.string() }),
});

const postMap = createMap(PostDto, { id: "post_id", author: fromResolver("author") });

// the resolver that backs the `fromResolver("author")` rule
const resolver = createResolver<{ author: { id: string; name: string } }, object>({
  adapter: {},
  resolvers: { author: async () => ({ id: "a1", name: "Ada" }) },
});

await forwardAsync(postMap, { post_id: "p1" }, { resolver });
// → { id: "p1", author: { id: "a1", name: "Ada" } }  (author resolved + validated)

await forwardAsync(postMap, { post_id: "p1" }, { resolver, select: ["id"] });
// → { id: "p1" }  — author's resolver never fires
```

Validation uses `safeParseAsync`, so field-level async `.refine` runs. A partial
`select` validates against a sub-schema derived from the raw `.shape` (Zod 4's
`.pick()/.partial()` throw on refined schemas, so they are never called).
Object-level cross-field refines run only on a **full** select. If any
`fromResolver` resolver throws, the whole `forwardAsync` promise rejects.

---

## Security

- **`select` is NOT an authorization boundary.** It is a performance/shape knob.
  Enforce field-level authorization *before* passing any untrusted selection.
- **Over-exposure.** Resolver-backed fields are parsed through their own dest
  sub-schema, and Zod objects `.strip()` unknown keys by default — so extra
  adapter-row columns (`passwordHash`, …) are dropped. **`z.any()`,
  `.passthrough()`, and `z.record()` DISABLE this** and leak the value verbatim.
  Use closed object schemas for response DTOs.
- **Resolver errors propagate.** Your adapter must enforce authorization and
  throw on denial; the resolver will not swallow it.
- **Prototype pollution.** The dot-path helpers reject `__proto__`, `prototype`,
  and `constructor` segments, so mapping untrusted data cannot poison
  `Object.prototype`.
- **DoS guards.** `deserialize` bounds BigInt-string length and Map-entry count
  before transforming attacker-controlled input.

---

## API surface

| Import path                 | Exports |
|-----------------------------|---------|
| `zodbridge-ts`          | `createMap`, `fromResolver`, `withDefault`, `forwardMany`, `safeForward`, `pick`, `omit`, `compose`, `toSnakeCase`/`toCamelCase`/`toKebabCase`/`toPascalCase`/`toConstantCase` (+ per-key), `serialize`, `deserialize`, `deserializeAsync`, errors, `VERSION` |
| `zodbridge-ts/serialize`| `serialize`, `deserialize`, `deserializeAsync`, `CodecError`, `AsyncSchemaError`, leaf transforms (incl. `setToArray`) |
| `zodbridge-ts/resolver` | `createResolver`, `strategies`, `SKIP`, `GraphContext`, types |
| `zodbridge-ts/async`    | `forwardAsync`, `normalizeSelect`, `UnknownSelectKeyError` |

### Map ops & resolver extras

```ts
import { createMap, compose, pick, withDefault } from "zodbridge-ts";
import { createResolver, strategies, SKIP } from "zodbridge-ts/resolver";

const UserDto = z.object({ id: z.number(), name: z.string(), role: z.string() });
const userMap = createMap(UserDto, {
  name: "full_name",
  role: withDefault("member", "user_role"), // default when source missing
});

userMap.forwardMany([{ id: 1, full_name: "Ada" }]); // batch -> validated DTO[]
userMap.safeForward({ id: "bad" });                 // { success: false, error }
pick(userMap, ["id", "name"]);                      // sub-DTO view (new map)

// resolver: try the fastest source first; first DEFINED value wins.
// A candidate skips by returning `undefined` or the `SKIP` sentinel — `null`
// is a winning value (return `SKIP` to skip when the value would be null).
createResolver({
  adapter,
  resolvers: {
    conversation: strategies(
      (c) => c.adapter.byReservation(c.get("reservationId")),       // undefined -> skip
      (c) => c.adapter.byConversationId(c.get("conversationId")) ?? SKIP, // skip even if null
    ),
  },
});
// force a fresh fetch (e.g. after a write):
await ctx.refresh("org");

// attach a resolver graph to the map itself:
const m = createMap(schema, rules, { resolvers: { org: (c) => c.adapter.getOrg() } });
const ctx = m.toResolver(adapter, seed); // validated against the map's schema
```

Ships dual ESM + CJS with `.d.ts` for every entry. Zero runtime dependencies.

## Examples

Runnable, self-contained use-cases live in [`examples/`](./examples):

| # | Example | Shows |
|---|---------|-------|
| 01 | basic mapping | `forward`/`reverse`, rename + computed + pair rules |
| 02 | case conversion | `toSnakeCase`/`toCamelCase`, value preservation |
| 03 | serialize/deserialize | Date/BigInt/Map/Set JSON round-trip |
| 04 | resolver graph | memoized resolution + `refresh` |
| 05 | smart resolve | `strategies()` fastest-first multi-source |
| 06 | async + select | `forwardAsync` with dynamic `select` |
| 07 | map ops & views | batch/safe, `withDefault`, `pick`/`omit`/`compose`, `map.toResolver` |

```bash
npm run example examples/04-resolver-graph.ts  # run one (tsx)
npm run verify:examples                         # typecheck them all
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). In short: TDD, keep the **100% coverage
gate** green, add a [changeset](https://github.com/changesets/changesets), and
keep changes additive. Security issues → [SECURITY.md](./SECURITY.md) (private
reporting, not public issues).

## License

[MIT](./LICENSE)
