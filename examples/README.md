# Examples

Runnable use-cases for `zodbridge-ts`. Each file is self-contained.

| File | Shows |
|------|-------|
| [01-basic-mapping.ts](./01-basic-mapping.ts) | `createMap` forward/reverse — rename + computed rules |
| [02-case-conversion.ts](./02-case-conversion.ts) | `toSnakeCase`/`toCamelCase` key conversion (values preserved) |
| [03-serialize-deserialize.ts](./03-serialize-deserialize.ts) | JSON-safe Date/BigInt/Map/Set round-trip |
| [04-resolver-graph.ts](./04-resolver-graph.ts) | `createResolver` memoized resolution + `refresh` |
| [05-smart-resolve-strategies.ts](./05-smart-resolve-strategies.ts) | `strategies()` — try multiple sources, fastest-first |
| [06-async-forward-select.ts](./06-async-forward-select.ts) | `forwardAsync` with dynamic `select` (skips unselected I/O) |
| [07-map-ops-and-views.ts](./07-map-ops-and-views.ts) | batch/safe forward, `withDefault`, `pick`/`omit`/`compose` |
| [08-map-to-resolver.ts](./08-map-to-resolver.ts) | `map.toResolver` — resolver graph declared on the map, chaining, validation, `refresh` |

## Run

These import from the package name (`zodbridge-ts`) exactly as a consumer would.
In this repo they resolve to `../src` via `examples/tsconfig.json`.

```bash
npx tsx examples/01-basic-mapping.ts
# typecheck them all:
npx tsc -p examples/tsconfig.json
```

In your own project, `npm install zodbridge-ts zod` and the same imports work
against the published package.
