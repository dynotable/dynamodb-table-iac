# Contributing

Standard pnpm workflow:

```sh
pnpm install
pnpm test        # vitest
pnpm typecheck   # tsc --noEmit
pnpm lint        # oxlint
pnpm build       # tsdown (ESM + CJS + d.ts)
```

CI runs all of the above plus `publint` and `@arethetypeswrong/cli` on every PR.

## Fixtures and goldens

Emitter tests compare against hand-written golden files under `tests/golden/`.
A golden is written from the target tool's own documentation first, and the
emitter is then made to match it — never the other way round. Each fixture's
source is recorded in `tests/fixtures/PROVENANCE.md`.
