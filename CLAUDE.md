# Cúntas: working agreement

- Read `docs/SPEC.md` before each phase; keep it updated when a decision changes.
- Test-first for `packages/rules` and `packages/engine`. Golden tests (`packages/rules/test/golden.test.ts`) are never edited to pass.
- No tax figure in code outside `packages/rules/rules/**/*.yaml`. ESLint rejects numeric literals in `packages/rules/src/calculators/**` except 0, 1 and 100.
- After editing a rule pack, run `pnpm build:packs` (a test fails if `generated.ts` is stale).
- Money is integer minor units plus an ISO currency; never floats. Use `applyRate`, `toMinor`, `splitEvenly` from `@cuntas/rules`.
- Every rule-pack section carries a `source` URL; packs carry `status: provisional | verified`. A section added to a verified pack without official confirmation carries its own `status: provisional`.
- Guidance, not advice: no named products or providers in engine output.
- Each pull request: tests, migration if needed, and a one-paragraph entry in `CHANGELOG.md`.

## Commands

- `pnpm install`, then `pnpm test` (Vitest, all packages), `pnpm lint`, `pnpm typecheck`
- `pnpm dev` runs the web app (local-first; no server needed)
- `docker compose up` runs web, api, worker and Postgres
- `pnpm test:e2e` runs Playwright against the web app
- `pnpm --filter @cuntas/api admin grant <user>` grants server admin (needs `DATABASE_ADMIN_URL`, the owner role)
- `pnpm --filter @cuntas/web build:native` builds the Capacitor apps' web bundle and syncs `ios/` and `android/`

## Layout

- `packages/rules`: YAML rule packs + pure calculators (`ie.payroll`, `uk.isaAllowance`, `xb.classify`, ...); regional sub-packs (Scotland) in `rules/uk/scotland/`
- `packages/engine`: next-step engine; one file per step in `src/steps/ie/`
- `packages/importers`: CSV presets, OFX, CAMT.053; fixtures in `fixtures/`
- `packages/ledger`: dataset schema (zod), transfers, FX, categorisation, budgets, debts, net worth, export, snapshot builder
- `packages/providers`: `BankDataProvider` interface, Enable Banking and mock adapters
- `packages/db`: Drizzle schema, SQL migrations with row-level security
- `apps/web`: React PWA; `apps/api`: Hono API; `apps/worker`: pg-boss jobs
