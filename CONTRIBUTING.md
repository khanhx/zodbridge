# Contributing to zodbridge-ts

Thanks for helping out! This is a small, focused, zero-runtime-dependency library
with a **100% test-coverage gate** — contributions must keep it green.

## Setup

```bash
npm ci
npm test            # vitest, all tests
npm run test:coverage  # enforces 100% lines/branches/functions/statements
npm run typecheck   # tsc --noEmit, strict
npm run build       # tsup dual ESM/CJS + .d.ts
npm run verify:dist # smoke-imports the built bundles (ESM + CJS)
```

Node ≥ 20. `zod ^4` is a peer dependency (Zod 3 is unsupported).

## Ground rules

- **TDD.** Write a failing test first, then make it pass.
- **100% coverage is non-negotiable.** If a branch is genuinely unreachable, remove
  the dead code rather than adding a contrived test.
- **Additive, backward-compatible.** Don't break public signatures without a major
  changeset and a clear rationale.
- **Keep files small** (~200 LoC) and single-purpose. Prefer composition.
- **No new runtime dependencies.**
- Match existing style; comments explain *why*, not *what*.

## Submitting a change

1. Fork, branch from `main`.
2. Make the change with tests; ensure `typecheck`, `test:coverage`, `build`,
   `verify:dist` all pass.
3. **Add a changeset:** `npx changeset` — pick patch/minor/major and write a
   one-line summary. Commit it.
4. Open a PR. CI runs the full matrix (Node 20/22/24) and the coverage gate.

## Reporting bugs / security

- Bugs: open an issue with a minimal reproduction.
- Security: see [SECURITY.md](./SECURITY.md) — do **not** open a public issue.
