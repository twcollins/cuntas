# Cúntas: design and working doc

Oct 24, 2026 · @Tom

## Where we are

Iteration 1 is built and tested but not committed: several households per device, an Account & sync screen, a Guide page, and the theme toggle moved to Settings. Cúntas is a personal tool, including on mobile, so data stays on the device unless you sign in to your own server.

| Item | State |
| --- | --- |
| Committed | v0.1 (phases 0 to 2) on `master`, 3 commits |
| Uncommitted | v0.2 plus iteration 1 |
| Checks (2026-10-24) | 186 Vitest tests and 20 Playwright tests pass; lint and typecheck clean; a live two-device passkey run against the Docker stack passes |
| Running locally | Dev web app at localhost:5173; Docker stack (web 8088, API 8787, worker, Postgres) on Colima, rebuilt with iteration 1 |
| Rule packs | UK 2026-27 verified; IE 2026, IE 2027, UK 2027-28 and Scotland provisional |

This doc is the source of truth for design progress; `docs/SPEC.md` stays the source of truth for rules and acceptance criteria.

## Accounts and households

The server already lets one sign-in belong to many households, but the app on a device holds exactly one, so adding a second household or signing in on a new device is hard and can overwrite local data. Built on 2026-10-24: a household switcher, one sign-in screen, and a confirm step before anything is replaced.

### Problems found (review of v0.2)

| # | Problem | Where | Effect |
| --- | --- | --- | --- |
| 1 | The device stores one household (one IndexedDB key) | `lib/store.ts` | No second household; joining or signing in replaces the first |
| 2 | Sign-in silently opens the first server household and overwrites local data with it | `Settings.tsx` ServerSync | Data loss if the local and server households differ |
| 3 | Creating a sign-in is buried in Data & sync, next to export and delete | `Settings.tsx` | Hard to find; mixed with destructive actions |
| 4 | Server address typed by hand, defaulting to localhost:8787, on three screens | Settings, Join, Admin | Confusing on a phone or a hosted server |
| 5 | Onboarding has no "I already have an account" path | `Onboarding.tsx` | A new device must create a throwaway household first |
| 6 | "Members" (people in the plan) and "People with access" (sign-ins) sit on one page with no link between them | `Household.tsx` | Users confuse the two |
| 7 | Two invite buttons: Data & sync invites members only; Household lets owners choose | Settings, PeopleWithAccess | Inconsistent |
| 8 | No way for a non-admin to create a second household on the server from the app | client only; `POST /households` exists | Feature exists but is unreachable |

### Proposed design

1. **Household switcher** at the top of the sidebar (the household name becomes a menu): lists every household on this device and, when signed in, every server household you can open; ends with "Add a household" and "Manage households".
2. **Several households per device.** Store each dataset under its own key, with an index of households and the active one. Migrate the v1 key on first load. Each household carries its own sync state.
3. **Add a household** offers three choices: start a new one, open the demo, or join with an invite link. When signed in, "start new" asks whether to keep it on this device only or also create it on the server.
4. **One Account screen** (new nav item under Household, replacing the sync card in Data & sync): sign in or create a sign-in with a passkey, see which server you're on, sign out. The server address defaults to the one the app was built with (`VITE_API_URL`, or the same origin), behind a "Change server" link.
5. **Never overwrite silently.** After sign-in, list your server households: open one (downloads it as a new local household) or upload the current local household as a new server household. Replacing an existing local copy needs an explicit confirm.
6. **Onboarding** gains a third card, "I already use Cúntas": sign in, then pick a household.
7. **Separate the two kinds of people.** On the Household page, "People in this plan" (tax, pay, pensions) stays; "Who can open this household" moves to the Manage households screen, with one invite button that sets the role.
8. **Manage households screen**: rename, leave, delete from this device, delete on the server (owners), and see role and sync state for each.

&#91;embedded content: household switcher flow · add or sign in, one confirm step\]

Every route adds a household and leaves existing data alone, except one: opening a server household that already has a copy on this device, which asks first.

### Status

- [x] Design approved (2026-10-24)
- [x] Multi-household store; no migration (not live, so local data resets)
- [x] Switcher, Households screen (add, switch, remove, delete on server, who can open it, invite with role)
- [x] Account & sync screen; server address from `VITE_API_URL`
- [x] Sign-in household picker; replacing a local copy asks first
- [x] Onboarding "I already use Cúntas"; invite links work on a device with no household
- [x] Playwright: two households on one device; onboarding sign-in card
- [x] Live check against Docker with virtual passkeys: device A uploads, device B signs in and opens both households, deletes one on the server, a fresh device C joins by invite
- [ ] Live passkey run as a committed test (needs the Docker stack in CI)

## Light and dark toggle

Done on 2026-10-24: the toggle no longer sits in the sidebar footer; it lives only in Settings (formerly Data & sync), in an Appearance card near the bottom, above Delete everything. The default stays "System", so most people never need it.

- Sidebar footer now shows only the sync state.
- The control and its labels are unchanged, so the existing Playwright checks still find it.
- Done: with the Account & sync screen in place, Data & sync is now "Settings" and Appearance stays there.

## User guide

Done on 2026-10-24: a Guide page at `/guide` (sidebar, under Household) gives a one-screen tour of every feature, each entry linking to its page.

| Section | Covers |
| --- | --- |
| Get started | Household, Accounts, Import: the three steps the planner needs |
| Day to day | Overview, Transactions, Budgets, Bills |
| Plan | Next steps, Debts, Goals, Pensions, Retirement, Compare wrappers |
| Tax | Tax centre, What if we moved |
| Your data and sharing | Households, Account & sync, inviting people, Settings; ends with the guidance-not-advice note |

- Playwright test added (`e2e/features.spec.ts`): the Guide opens, a link reaches its page, and no theme toggle is left in the sidebar. Passes on desktop and mobile.
- Next: link the Guide from onboarding and from empty states (for example "No accounts yet"); the sharing entries were updated for the Account & sync and Households screens.

## Mobile: App Store and Google Play

Decided 2026-10-24: the apps are a personal tool that keeps all data on the phone, with no hosted server; signing in to your own server stays optional. That makes on-device storage, a phone-first layout and an app lock the core work; native passkeys and deep links matter only for people who self-host. Store rules below are from memory, not checked this session; verify each against the current Apple and Google policy pages before submission.

### What blocks a store release today

| Area | Today | Needed | Why |
| --- | --- | --- | --- |
| Passkeys | Browser WebAuthn from the PWA | Native passkey plugin (iOS AuthenticationServices, Android Credential Manager); associated domains / Digital Asset Links on the API domain | WebAuthn in the app's web view is unreliable or unavailable, so sign-in would fail |
| Storage | IndexedDB in the web view | Native storage (SQLite or file) behind the same store API; data encrypted at rest | The phone is the only copy for most people, and the OS can clear web-view storage under pressure; add an export-to-Files reminder as a backstop |
| Deep links | `/join#token` and the bank callback open in a browser | Universal Links (iOS) and App Links (Android) for invites and the bank consent return | Invites and PSD2 consent must come back into the app |
| Layout | Sidebar plus hamburger menu; no safe-area handling | Bottom tab bar (Overview, Transactions, Next steps, Plan, More), `viewport-fit=cover`, safe-area insets, 44 pt touch targets | Store reviewers and phone users expect native navigation |
| App lock | None | Optional Face ID / fingerprint lock and a blurred app-switcher snapshot | Expected for finance apps; protects data on a shared phone |
| Account deletion | Admin can delete households; users can't delete their sign-in | In-app "Delete my account" | Apple requires it for any app that lets you create an account, including on a self-hosted server |
| Server address | Typed by hand | No server by default; "Use my own server" stays under Account & sync (done, address prefilled from the build) | Most people never need a server |

### Store requirements to plan for

- **Publisher:** Apple expects apps in financial services to come from an organisation account, not an individual; Google Play asks every app to complete a financial features declaration.
- **Minimum functionality:** a thin web wrapper risks rejection (Apple guideline 4.2); the native passkeys, app lock, notifications and offline storage above are the native value.
- **Privacy:** Apple privacy labels and a privacy manifest; Google Play Data safety form. With data on the device only, both can declare no data collected; self-hosted sync goes to the user's own server.
- **Notifications:** consent-expiry and bill reminders via APNs and FCM need the worker to send pushes, plus certificates and keys.
- **Testing:** TestFlight for iOS; Google Play closed testing (a new personal developer account must run a closed test with testers for a set period before going public).
- **Assets:** icons at each size, splash screen, 6.7" and 5.5" iPhone and phone/tablet Android screenshots, a privacy policy URL and support URL.
- **Positioning:** keep "guidance, not advice" and no named products, so the app isn't treated as regulated financial advice.

### Decided and still open

- Decided: personal tool, device-only storage, no hosted server, no paid aggregator by default. Bank sync stays a self-hosted option.
- Open: who publishes. Apple's expectation of an organisation account for finance apps may still apply to a budgeting tool; check before enrolling.
- Open: whether to ship the native apps at all, or install the PWA to the home screen, which avoids store review entirely.

## USA support

Planned on 24 Oct 2026, not started. US support launches on the web app and both store apps at once, with all 50 states and Washington, D.C., and without US student loans. The person using the app checks the US tax figures each year and loads new ones from a file; we don't verify them. There are four phases, and launch comes after the third. Because the app is device-only, the US needs no new servers, and no US bank connections are planned.

### What changes in the code

The code assumes two countries and two currencies in about 20 places (`Jurisdiction = "IE" | "UK"`, `Currency = "EUR" | "GBP"`, the importer's `country`, the providers' `listInstitutions`).

| Area | Change | Size |
| --- | --- | --- |
| Money and FX | Add USD to `Currency`. Rates move from EUR/GBP pairs to any pair via EUR, since the ECB also publishes USD. | M |
| Jurisdictions | Add `US`, and states as sub-packs the way Scotland is (`rules/us/<state>/`). Tax years are calendar years. | M |
| Household model | Filing status (single, married filing jointly or separately, head of household) and state of residence per member. Dependants. All defaulted so existing exports still load. | M |
| Rule packs | `rules/us/2026.yaml` and `2027.yaml`: federal brackets, standard deduction, FICA (Social Security wage base, Medicare and additional Medicare), retirement and HSA limits. Sources: IRS revenue procedures for inflation adjustments, Publication 15-T, SSA wage base notices. | L |
| Calculators | `us.payroll` (pre-tax 401(k), HSA, Section 125 deductions; federal withholding; FICA), `us.selfEmployed` (SE tax, quarterly estimates and safe harbour), `us.retirementLimits` (401(k), IRA and Roth IRA with income phase-outs, catch-up), `us.socialSecurity` (benefit estimate by claiming age). Golden tests for each, written first. | L |
| Engine | `steps/us/` following the r/personalfinance flowchart: budget, starter emergency fund, employer match, high-interest debt, full emergency fund, HSA, Roth IRA, 401(k) up to the limit, then other goals. Thresholds in a `us/flowchart.yaml`. | L |
| Importers | CSV presets for Chase, Bank of America, Wells Fargo, Capital One, Citi, American Express and Discover. `MM/DD/YYYY` already parses. QFX is OFX, so it works already. | M |
| Web app | en-US wording (checking for current, 401(k) for pension), USD formatting, a US option in onboarding, US screens in the Tax centre. | M |
| Guidance wording | Check the engine copy against US rules on investment advice. It stays general and names no products. | S |

### Phases

1. **Groundwork.** Country and currency become open sets, with FX through EUR. Rule packs get a schema and can be loaded from a file, with the Tax rules screen and the check prompt (next section). This also works for Ireland and the UK. Gate: every current test passes, with no change in Irish or UK output.
2. **Federal tax and the US plan.** Payroll, self-employed tax, retirement limits, the US engine steps, bank presets and en-US wording. Gate: golden tests match IRS worked examples.
3. **All 50 states and D.C.** One sub-pack and calculator per state, each with its own source and golden tests against that state's published examples or withholding tables. Gate: every state has a pack, sources and golden tests. **Launch** on the web and both stores after this phase, with US store listings and privacy labels.
4. **After launch.** Social Security estimate, Roth conversion and backdoor Roth notes, and US–Ireland and US–UK cross-border cases (US citizens taxed on worldwide income, FBAR and FATCA reporting, PFIC treatment of Irish and UK funds).

US student loans are left out. The app says it doesn't calculate them, and people can add a loan as an ordinary debt.

### Tax rules you check yourself

Decided 24 Oct 2026: you check the US figures yourself, against the official sources, and load each new year's figures from a file. The app ships the current year's federal and state packs marked `provisional` and unchecked, so it works on first run and asks you to check straight away.

**The file.** It's the same YAML the app is built from: country, tax year, version, status, effective dates, and sections of figures, each with a source link. It holds figures only, no code, so the App Store and Google Play allow it. (Apple's guideline 2.5.2 bars downloaded code, not data.) Federal figures go in one file per year (`us-2027.yaml`). Each state has its own file (`us-ca-2027.yaml`), so you only check the states your household lives in.

**The prompt**

| When | Where it shows | What it says |
| --- | --- | --- |
| From 1 Jan, while the year has no checked federal file, or no checked file for a member's state | Banner on Overview and Tax; badge on Settings → Tax rules | "Check your 2027 US tax figures. Until you do, results use figures you haven't checked." |
| From 1 Nov, when the IRS has usually published next year's figures | Same banner; can be hidden for 30 days | "2027 US tax figures are usually out by now. Add them when you're ready." |
| A file is loaded but not confirmed | Tax rules screen | "Not checked yet" on each section |
| A member moves to another state | Household screen | Add that state's file |

Results that use unchecked figures, or last year's figures for this year, are labelled "Figures not checked" and say which year they used.

**Updating the rules each year.** The in-app Guide shows these steps.

1. Go to Settings → Tax rules → "Start 2027 from 2026". The app saves a file with last year's figures, the year and dates moved on, the status set to `provisional`, and every figure marked to check next to its source link. It covers only the federal file and your household's states.
2. Open each source and edit the figures in any text editor. The sources are the IRS revenue procedure for inflation adjustments, Publication 15-T, the Social Security wage base notice, and your state's revenue department. A file someone else prepared works too, but still needs checking.
3. Go to Settings → Tax rules → "Add rule file" and choose the file. On a phone, pick it from Files (iPhone) or Downloads (Android), or use "Open in Cúntas" from the share sheet.
4. The app checks the file. It must have the right shape, a source link on every section, sensible numbers (rates between 0 and 1, thresholds in rising order) and a year that matches its dates. Errors name the line, and nothing changes if the file fails.
5. A review screen shows each figure next to last year's, with the change and the source link. Tick each section, or "I've checked all of these". The app records the date and the file's fingerprint (SHA-256).
6. The new figures apply from the start of their year. Last year's stay in use for earlier dates.

If a file changes, its fingerprint changes and it needs checking again. Settings lists the loaded files with their fingerprints and checked dates. You can remove them, and they're included in the encrypted backup.

**What it changes in the code.** Today packs are compiled in (`generated.ts`) and looked up from a fixed list (`packOn`). This needs:

- a zod schema per pack type, used at build time and for loaded files
- a registry that merges built-in and loaded packs, stored per device in IndexedDB (`cuntas:rulepacks:v1`)
- a "checked" record per pack: fingerprint, date and sections ticked
- the template export, the Tax rules screen and the prompts
- tests for rejected files, which pack wins, and the label when last year's figures are used

### Open questions

- Do we publish draft rule files each year, or does everyone start from "Start 2027 from 2026"? Drafts save each person retyping figures, and they'd still check them.
- Should Ireland and the UK move to the same you-check model, or keep packs we maintain?
- Who writes and sources the first 51 state packs? Some states have flat rates, and some add county or city income tax (Maryland, Indiana, New York City). Are local taxes left out at launch?

## Backlog

24 items: 5 done in iteration 1, 2 must-dos before any release (P0), and the rest split between missing spec features, the mobile path and the four USA phases, re-prioritised for a device-only app.

| Item | Area | Priority | Status | Notes |
| --- | --- | --- | --- | --- |
| Commit v0.2 and iteration 1 on a branch; open a PR | Housekeeping | P0 | Not started | All uncommitted on `master` |
| Verify provisional rule packs | Rules | P0 | Not started | IE 2026, IE 2027, UK 2027-28, Scotland, plus v0.2 sections |
| Native storage behind the store API | Mobile | P1 | Designed | The phone is the only copy for most people |
| Phone layout: bottom tabs, safe areas | Mobile | P1 | Designed | Also helps the PWA |
| App lock and an export-to-Files reminder | Mobile | P1 | Designed | Face ID / fingerprint; backstop for lost phones |
| Broker CSV import for holdings and lots | Investing (phase 3) | P1 | Not started | Data model exists; no importer |
| Workday log for trans-border relief | Cross-border (phase 4) | P1 | Not started | Today only a flag |
| Native passkeys and associated domains | Mobile | P2 | Designed | Only for people who self-host |
| Universal Links and App Links | Mobile | P2 | Designed | Invites and bank consent; self-host only |
| Local notifications for bills and consent expiry | Mobile | P2 | Not started | On-device, no push service |
| Delete my sign-in (API endpoint and screen) | Account | P2 | Not started | Apple requirement when sign-ups happen in the app |
| Live passkey test in CI | Testing | P2 | Not started | Passed by hand against Docker on 2026-10-24 |
| Single person child carer credit | Rules | P2 | Not started | Not in seed data |
| Link the Guide from onboarding and empty states | Guide | P2 | Not started | Small |
| Tick finished checklists in `docs/SPEC.md` | Housekeeping | P2 | Not started | All still unchecked |
| USA phase 1: country and currency as open sets, FX via EUR | USA | P1 | Done | 2026-10-24, uncommitted on `iteration-1`: USD and US as open sets, FX via EUR, rule files with schema, Tax rules screen, checks and prompts; IE and UK output unchanged (golden tests untouched) |
| USA phase 2: federal tax, US plan steps, bank presets, en-US wording | USA | P1 | Done | Built 24–25 Oct 2026, uncommitted on iteration-1. Federal pack 2026 (us/2026.yaml), us.payroll, us.retirementLimits, us.estimatedTax; golden tests from Rev. Proc. 2025-32, Pub. 590-A and Pub. 505 (590-A example 1 shows 6,825 against its own rounding rule's 6,830; tests follow the rule). US ladder (r/personalfinance order) in the engine; presets for Chase, BofA, Wells Fargo, Capital One, Citi, Amex, Discover; en-US wording. To check: US CSV layouts against real exports, flowchart thresholds against the wiki. No-income-tax states fully covered (federal only needed). |
| USA phase 3: state income tax sub-packs | USA | P2 | Done | All 50 states and D.C.; launch follows this phase. Decided 25 Oct 2026: local income taxes out at launch (results say where they apply); build in batches. Batch 1 done 25 Oct (uncommitted): state pack type, schema, calculator, state per member, Tax rules and prompts; 24 states — the 9 with no wage tax plus AZ, CO, GA, ID, IL, IN, IA, KY, LA, MA, MI, MS, NC, PA, UT. Priority states (25 Oct, user request): Indiana, Virginia, Texas made as complete as possible — Virginia added in full; Indiana with all 92 county taxes (exception to local-out), renter's deduction and 65+ low-income exemption; Texas already complete. Batch 2 done 26 Oct: all 50 states and D.C. have provisional 2026 packs with sources and golden tests (published examples where they map onto a return, otherwise hand-worked from the rules). State EITCs and most age-dependent child credits aren't modelled. Launch tasks (US store listings, privacy labels) remain. To check: AZ rate (azdor.gov unreadable), ID 2026 zero band, UT draft credit figures. |
| USA phase 4: Social Security, Roth notes, US–IE and US–UK cross-border | USA | P2 | Done 2026-10-28 (repo) | FBAR, FATCA, PFIC for the diaspora; totalization and spousal benefits not modelled |
| Several households per device, with switcher | Households | P0 | Done | 2026-10-24; no migration, local data resets |
| Sign-in household picker; no silent overwrite | Households | P0 | Done | 2026-10-24 |
| Account & sync screen; default server address | Households | P1 | Done | 2026-10-24 |
| In-app user guide | Guide | P2 | Done | 2026-10-24, `/guide` |
| Move the light/dark toggle | Settings | P2 | Done | 2026-10-24, Settings |

## Decision log

| Date | Decision | Why |
| --- | --- | --- |
| 2026-10-24 | US support comes to the web app and both store apps | Owner's call; one launch for every platform |
| 2026-10-24 | US launch covers all 50 states and D.C. | Owner's call; no state is shown as federal-only |
| 2026-10-24 | US student loans are left out | Federal repayment plans change too often to keep right |
| 2026-10-24 | You check US tax figures yourself and load new ones from a file each year | Owner's call; the app has no server to push updates, and a file holds data only, which both stores allow |
| 2026-10-24 | Personal tool on every platform: data on the device only; a self-hosted server stays optional | Owner's call; avoids a hosted service, a paid aggregator and regulatory review |
| 2026-10-24 | Household redesign approved and built | Fixes the silent-overwrite path and makes several households possible |
| 2026-10-24 | No migration from the v1 storage key; local data resets | Not live yet, so there is nothing to carry over |
| 2026-10-24 | Destructive or replacing actions use the browser's confirm dialog | Works the same in the PWA and the Capacitor apps; a styled dialog can replace it later |
| 2026-10-24 | Household redesign goes to review before any code | It changes on-device storage; an unapproved storage change is costly to undo |
| 2026-10-24 | Theme toggle lives only in Settings; default stays System | Rarely changed, and it crowded the sidebar footer |
| 2026-10-24 | User guide is an in-app page, not a separate document | Each entry links straight to the feature, and it works offline and in the native apps |
