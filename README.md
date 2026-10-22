# Cúntas

Privacy-first budgeting and planning for Ireland (and the UK). It turns the r/irishpersonalfinance flowchart into code and tells each household its single next money step, using versioned Irish and UK tax rule packs. Spec: [`docs/SPEC.md`](docs/SPEC.md).

**This is information, not financial advice.** Rule packs are seed data from the spec; verify against Revenue and HMRC before relying on them.

## Quick start (local-first, no server)

```sh
pnpm install          # or: npx pnpm@9.15.0 install
pnpm dev              # http://localhost:5173 — open the demo household or start your own
```

Data lives in the browser (IndexedDB). Export, encrypted backup and delete-all are under **Data & sync**.

## Self-hosted stack (household sharing, bank sync, ECB rates)

```sh
cp .env.example .env  # set passwords and CUNTAS_KEK=$(openssl rand -base64 32)
docker compose up -d --build
# web http://localhost:8080 · api http://localhost:8787 (OpenAPI at /openapi.json)
```

In the web app, go to **Data & sync → Self-hosted server**, create an account with a passkey, and the household syncs as an encrypted, versioned document. Bank sync defaults to a mock provider; set `BANK_PROVIDER=enablebanking` with an Enable Banking application id and key for real PSD2 read-only access.

## Tests

```sh
pnpm test        # Vitest: golden tax tests, engine, importers, ledger, RLS (PGlite), API, worker
pnpm lint        # includes the no-numeric-literals rule for calculators
pnpm typecheck
pnpm test:e2e    # Playwright, desktop and mobile
```

## What's built

| Area | Status |
| --- | --- |
| Rule packs IE 2026, 2027 (provisional); UK 2026-27, 2027-28 | Done, with golden tests |
| Calculators: `ie.payroll` (PRSI by pay date, USC, credits, joint assessment, MyFutureFund), `ie.pensionRelief`, `ie.exitTax`, `ie.deemedDisposal`, `ie.cgt`, `ie.investmentAccount` (flagged), `ie.helpToBuy`, `uk.payroll`, `uk.isaAllowance`, `uk.savingsTax`, `uk.niVoluntary`, `xb.classify` | Done |
| Next-step engine: 7 IE steps with ordered sub-checks, always-on step 2, dismissals, options card | Done |
| Importers: CSV presets (AIB, BOI, PTSB, Revolut, An Post Money, credit union, Monzo, Starling, Barclays, Danske NI), column mapper, OFX, CAMT.053, idempotent re-import | Done (presets built from known layouts; check against real exports) |
| Ledger: EUR/GBP, ECB rates, cross-currency transfer matching, categorisation (rules → dictionary), envelope/cap budgets with rollover and payday periods, payday waterfall, debt planner, net worth with FX effect, goals, export/import round-trip | Done |
| Web PWA: overview, next steps, transactions, budgets, accounts, import, debts, goals, pensions, tax centre, household, data & sync | Done |
| API: passkeys + TOTP, households, invites, encrypted document sync, bank connections, FX, signed rule-pack manifest | Done |
| Postgres with row-level security per household; envelope encryption; audit trail | Done |
| Worker: ECB FX, nightly bank sync, re-consent and tax-deadline reminders | Done (reminders are queued; email/web-push delivery not wired) |

Not yet built: Class S PRSI and self-employed Form 11 flows, UK student loans and pension annual allowance, Scotland sub-pack, payslip check, recurring-bill detection, retirement projection, residence-change what-if, wrapper comparison UI, Capacitor wrapper.
