# zodbridge

## 0.2.0

### Minor Changes

- 5ce2874: Initial release of zodbridge — a schema-first, decorator-free, Zod 4-driven
  mapping toolkit:

  - **Two-way mapper** (`createMap`): entity ↔ DTO with auto-reversible renames,
    computed/pair/default rules, batch + safe forward, `pick`/`omit`/`compose`
    views, and recursive key case conversion (`toSnakeCase`/`toCamelCase`/...).
  - **Serialize/deserialize**: JSON-safe codec (Date/BigInt/Map/Set), validate-then
    -transform, DoS bounds, sync + async.
  - **Resolver graph** (`createResolver`): memoizing, cycle-safe, dependency-aware
    resolution over an injected adapter, with `strategies()` multi-source resolution
    (SKIP sentinel; `null` wins), `refresh`/`invalidate`, and schema-driven validated
    output.
  - **Async mapping** (`forwardAsync`): resolver-backed fields with a dynamic
    `select` set and over-exposure stripping.

  Zero runtime dependencies, dual ESM/CJS with `.d.ts`, strongly typed throughout.
