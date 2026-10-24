# Cúntas

Privacy-first budgeting and planning for Ireland (and the UK). It turns the r/irishpersonalfinance flowchart into code and tells each household its single next money step, using versioned Irish and UK tax rule packs. Spec: [`docs/SPEC.md`](docs/SPEC.md).

**This is information, not financial advice.** Rule packs are seed data from the spec; verify against Revenue and HMRC before relying on them.

## Quick start (local-first, no server)

```sh
pnpm install          # or: npx pnpm@9.15.0 install
pnpm dev              # http://localhost:5173 — open the demo household or start your own
```

Data lives on the device (IndexedDB), one entry per household; keep several and switch from the menu at the top of the sidebar (**Households** to add or remove). Export, encrypted backup and delete-all are under **Settings**. **Guide** gives a short tour.

## Self-hosted stack (household sharing, bank sync, ECB rates)

```sh
cp .env.example .env  # set passwords and CUNTAS_KEK=$(openssl rand -base64 32)
docker compose up -d --build
# web http://localhost:8080 · api http://localhost:8787 (OpenAPI at /openapi.json)
```

In the web app, go to **Account & sync**, create a sign-in with a passkey, and choose **Sync it** to upload the open household as an encrypted, versioned document, or open a household from the server on this device. Nothing on the device is replaced without a confirm. The server address defaults to `VITE_API_URL` (build time), else `http://localhost:8787`. Bank sync defaults to a mock provider; set `BANK_PROVIDER=enablebanking` with an Enable Banking application id and key for real PSD2 read-only access.

### Server admin

Admins create households for other people (handing them over with a one-time owner invite), rename, suspend (read-only) or delete households, and manage members and roles. They see metadata only, never a household's ledger. Admin rights can only be granted from the server shell, as the database owner:

```sh
docker compose run --rm migrate pnpm --filter @cuntas/api admin list
docker compose run --rm migrate pnpm --filter @cuntas/api admin grant "Your name"   # or a user id or email
```

Then open **Server admin** in the web app (it appears in the menu once you sign in as an admin). Household owners manage their own members under **Household → People with access**.

## Native apps (iOS and Android)

The `apps/web/ios` and `apps/web/android` projects wrap the same PWA with Capacitor 8. Building them needs Xcode (iOS) or Android Studio (Android):

```sh
pnpm --filter @cuntas/web build:native     # web build without the service worker, then cap sync
pnpm --filter @cuntas/web cap:open:ios      # or cap:open:android, then run from the IDE
```

The apps work local-first with no server. To sync with a server, serve the API over HTTPS and set `EXTRA_ORIGINS=capacitor://localhost,https://localhost` and `CROSS_SITE_COOKIES=1`. Passkeys inside the apps also need an associated domain (iOS) or Digital Asset Links (Android) for the API's relying-party id.

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
| Rule packs IE 2026, 2027 (provisional); UK 2026-27, 2027-28; Scotland 2026-27 sub-pack (provisional) | Done, with golden tests |
| Calculators: `ie.payroll` (PRSI by pay date, USC, credits, joint assessment, MyFutureFund), `ie.classS`, `ie.selfAssessment` (Form 11, preliminary tax), `ie.payslipCheck`, `ie.pensionRelief`, `ie.exitTax`, `ie.deemedDisposal`, `ie.cgt`, `ie.investmentAccount` (flagged), `ie.helpToBuy`, `ie.statePension`, `uk.payroll` (Scottish bands, student loans), `uk.studentLoan`, `uk.annualAllowance`, `uk.payslipCheck`, `uk.isaAllowance`, `uk.savingsTax`, `uk.niVoluntary`, `uk.statePension`, `xb.classify`, `xb.projectRetirement`, `xb.compareWrappers` | Done |
| Next-step engine: 7 IE steps with ordered sub-checks (including a tax set-aside check for the self-employed), always-on step 2, dismissals, options card | Done |
| Importers: CSV presets (AIB, BOI, PTSB, Revolut, An Post Money, credit union, Monzo, Starling, Barclays, HSBC UK (two layouts, including the export with no header row), Danske NI), column mapper, OFX, CAMT.053, idempotent re-import | Done (presets built from known layouts; check against real exports) |
| Ledger: EUR/GBP, ECB rates, cross-currency transfer matching, categorisation (rules → dictionary), envelope/cap budgets with rollover and payday periods, payday waterfall, debt planner, net worth with FX effect, goals, recurring-bill detection with price rises and an IE/UK bill calendar, retirement plan, residence what-if, export/import round-trip | Done |
| Web PWA: overview, next steps, transactions, budgets, bills, accounts, import, debts, goals, pensions (with UK annual allowance), retirement, wrapper comparison, tax centre (Form 11, payslip check), what if we moved, household, data & sync, server admin; light, dark or system theme | Done |
| Native apps: Capacitor 8 iOS and Android projects | Generated; not compiled here (no Xcode or Android SDK on the build machine) |
| API: passkeys + TOTP, households, invites with roles, member management, instance admin, encrypted document sync, bank connections, FX, signed rule-pack manifest | Done |
| Postgres with row-level security per household; envelope encryption; audit trail | Done |
| Worker: ECB FX, nightly bank sync, re-consent and tax-deadline reminders | Done (reminders are queued; email/web-push delivery not wired) |

Not yet built: email and web-push delivery for reminders, payslip photo capture (payslips are typed in), the single person child carer credit, and Scottish rates for 2027-28 (the 2026-27 sub-pack is used until they are published).

Figures added in 0.2.0 that are not in the spec (Class S minimum, preliminary tax bases, State Pension rates, UK student loan thresholds, annual allowance, lump sum allowance, UK CGT, Scottish bands) are marked `status: provisional` in their rule-pack sections. Verify them against Revenue, HMRC and the Scottish Government before relying on them.
