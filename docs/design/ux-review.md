# Cúntas: UX review, getting money in

2026-10-25 · Review and proposed design. Status: proposed, not started.

Getting money into Cúntas is the weakest part of the app. There is no way to add a single spend by hand, no way to give a rough monthly spend without importing a statement, and an import leaves you with raw bank text and a column of "Uncategorised" to fix one dropdown at a time. The planning and tax side is strong, but most people will never reach it if the first ten minutes feel like data entry. This review sets out the problems found and a design that makes the first useful result take under three minutes.

## How the review was done

- A fresh household created as a US user, on desktop (1280 px) and phone (390 px), against the dev build on 2026-10-25.
- The first-run path walked end to end: onboarding, the empty Overview, Household, Accounts, Import of a Chase checking CSV (the `chase-checking.csv` fixture), Transactions, Budgets, and Overview again.
- The code behind each screen read to confirm what the screenshots showed (`apps/web/src/pages/*`, `packages/ledger`, `packages/engine`).

## What already works

- Bank detection: 22 presets recognised from the file alone, plus a column mapper for anything else. Re-importing never duplicates.
- "Correct one, offer a rule for the rest" on Transactions is the right idea.
- Budgets can start from last period's spending in one click.
- Bills detects recurring payments and offers common bills to confirm.
- The next-step card on Overview always tells you the one thing to do next.

## Problems, worst first

| # | Problem | Evidence | Effect |
| --- | --- | --- | --- |
| 1 | No manual entry. A cash spend, a transfer to a partner or a bank with no export can't be recorded. | Transactions has no Add button; the schema has no manual source (`categorySource` is user/rule/dictionary/none; nothing marks a hand-entered row) | Anyone without clean CSVs can't use budgets or the plan at all |
| 2 | No "rough monthly spend". The emergency-fund target, waterfall and several steps need essential monthly spending, which only comes from transactions. | `essentialMonthlySpend` in `ledger/src/snapshot.ts` reads transactions only | A new user sees $0 targets and generic advice until they import months of history |
| 3 | Categorising is one dropdown per row, over the full category list, with raw bank text. | Transactions page; "TRADER JOE'S #123 SAN FRANCISCO CA" left uncategorised | Hundreds of rows after a first import; most people stop here |
| 4 | No US merchants in the category dictionary. | `ledger/src/categories.ts` has no Walmart, Target, Costco, Trader Joe's, Starbucks | US imports land almost entirely uncategorised |
| 5 | Import is one file at a time, with a native file button, and ends with a one-line message and no next step. | Import page | No path from "imported" to "categorise" to "budget" |
| 6 | Account choice on import defaults to the first current account, even when the file is clearly another bank. | `Import.tsx` initial `accountId` | Easy to import a card statement into the checking account |
| 7 | Onboarding asks where you live, then throws the answer away (only the currency is kept). With nobody in the household yet, Overview shows Irish rules. | `Onboarding.tsx` calls `startEmpty(name, currency)`; Overview shows "rule pack IE-2026.3" and IE/UK badges for a US household | A US user's first screen talks about Irish tax |
| 8 | Phone: the Transactions table scrolls sideways; category and amount are off screen. | `phone-06-transactions-after` | The main screen is unusable on a phone |
| 9 | 20 items in the sidebar, in four groups, from the first minute. | `Layout.tsx` NAV | Hard to know where to start; Admin, What-if and Tax rules compete with Transactions |
| 10 | After importing last month's statement, "Spending this period" is empty and step 0 still says "Start tracking". | The fixture's September rows on 25 October: outside the current pay period and the 30-day window | The import looks like it did nothing |

Smaller bugs found on the way, worth fixing with the work above:

- A new account created during import gets `jurisdiction: "IE"` for any currency other than GBP, including USD (`Import.tsx`). Accounts' "Add account" also defaults to IE (`Accounts.tsx`).
- Accounts' subtitle still says "in EUR and GBP".
- Household settings show the Irish "Investment Account (Finance Bill 2026)" toggle to a US household.
- The empty net-worth chart draws axes labelled "0k" five times.
- A UK-only household runs the Irish next-step ladder and rule pack, so its explanations mention Irish items such as DIRT (found while writing [ARCHITECTURE.md](../ARCHITECTURE.md)).
- Bank sync creates a synced account as GBP or else EUR, so a USD account would come in as EUR.

## Design

Four changes do most of the work: a quick-add sheet, a spending estimate for people who won't import, a smarter import that ends in a review queue, and a setup checklist that strings them together.

### 1. Quick add, from anywhere

A **+ Add** button sits at the top right on desktop and as a floating button on phone, on every page. It opens a sheet:

```
┌ Add ───────────────────────────────┐
│  Spent ●   Received ○   Moved ○    │
│                                    │
│  $ [ 12.50          ]  (keypad)    │
│  What for   [ Coffee shop      ]   │
│  [Groceries] [Eating out] [Fuel]   │  ← 6 most used, then "More…"
│  [Transport] [Household] [More…]   │
│                                    │
│  Paid from  Cash ▾      Today ▾    │
│  ☐ This happens every month        │
│                                    │
│            [ Save ]  [ Save + another ]
└────────────────────────────────────┘
```

- Four taps for a typical spend: amount, a category chip, Save. Payee is optional; typing one fills the category from rules and past entries.
- **Paid from** defaults to the last account used; the first time, a **Cash** account is created silently.
- **Moved** records a transfer between two of your accounts, so it doesn't count as spending.
- **This happens every month** creates a Bill (existing feature) instead of, or as well as, the transaction.
- Keyboard: `N` opens it; Enter saves; `Shift+Enter` saves and starts another.
- Hand-entered rows are marked `source: "manual"`. When a later import contains a matching row (same account, amount, date within 3 days), the import offers to merge them, so cash-then-statement users don't double count.

### 2. Monthly spending estimate

For people who don't want to import, or before their first import. Set from the setup checklist or Budgets:

```
Roughly what do you spend in a month?
  Rent or mortgage    [ 1,800 ]
  Groceries           [   600 ]
  Utilities and phone [   250 ]
  Transport           [   200 ]
  Childcare           [     0 ]
  Debt repayments     [   150 ]   (filled from Debts if set)
  Everything else     [   700 ]
                       ───────
                       3,700 a month
```

- Seven lines, mapped to existing categories and waterfall buckets; prefilled from the household's rent/mortgage and debts.
- Stored as `household.spendingEstimate` (per-category monthly amounts and a date).
- `essentialMonthlySpend` uses real transactions when there are at least two full months, and the estimate otherwise. Overview says which: "Based on your estimate" with a link to replace it.
- One tap turns it into the first budget.

### 3. Import that finishes the job

```
Drop bank files here, or [Choose files]
CSV, OFX, QFX, CAMT.053 · several at once

chase-checking.csv   Chase checking ··4417   →  Chase checking (new)   142 rows  Sep 1 – Oct 20
amex.csv             American Express        →  Amex (existing)         58 rows  Sep 3 – Oct 19
                                                                  [ Import 200 transactions ]
```

- Drop files anywhere in the app, not just on Import; several files at once. On phone, files arrive through the share sheet (see [mobile-apps.md](mobile-apps.md), Files in and out).
- **Account matching:** by IBAN / account number in the file, then by the preset plus the last import into an account, then a new account named after the preset. The guess is shown and can be changed, but most people just press Import. New accounts take their type (current or card) from the preset and their country from the currency.
- Unknown CSV layouts still get the column mapper, but it opens with the guess applied and a live preview, and remembers the mapping for that header row.
- **Result screen**, not a one-line message:

```
Imported 200 transactions from 2 files
  12 already imported (skipped)  ·  3 transfers matched
  ✔ 141 categorised automatically
  ● 47 need a category  →  [ Review now ]
Spending Sep 1 – Oct 20: $4,812  ·  [ Set up a budget from this ]
```

- Overview and the step-0 check count an import as "tracking" when it covers any of the last 60 days, and "Spending this period" falls back to the latest month with data, labelled with its dates.

### 4. Review queue for categories

Replaces scrolling Transactions to fix categories one row at a time.

```
Review  47 left                                   [Skip]  [Done for now]

  TRADER JOE'S          8 transactions · $412.30 · Sep 2 – Oct 18
  (Trader Joe's #123 San Francisco CA)

  [Groceries]  [Eating out]  [Household]  [Shopping]  [More…]

  ☑ Always use this for Trader Joe's
```

- Groups uncategorised rows by **cleaned merchant**, largest total first, so the first 10 decisions usually cover most of the money.
- One tap categorises the whole group and, with the box ticked (default), creates the rule. Undo appears for 10 seconds.
- **Merchant cleaning** (new in `ledger`): strip store numbers, card numbers, city/state suffixes, "POS", "PPD ID", "SQ *", "PAYPAL *" and similar, keeping the raw text for search and rules.
- **US dictionary:** add the top ~200 US merchants and US bill payees to `categories.ts`, as Ireland and the UK have. With cleaning, this should take a typical US import from about half uncategorised to under a fifth.
- Phone: swipe left to skip, tap a chip to file.
- A "Review 47" badge sits on Transactions in the nav until the queue is empty.

### 5. Setup checklist instead of a blank Overview

A new household sees a checklist on Overview until it's done; it replaces step 0 of the ladder while showing.

```
Get set up                                     2 of 4 done
 ✔ You       Alex, US (Texas), $85,000 a year
 ✔ Accounts  Chase checking, Amex
 ● Spending  [Import statements]  or  [Give a rough monthly figure]
 ○ Budget    Made for you from your spending, ready to adjust
```

- Onboarding's "Where do you live?" creates the first person with that residence, and asks for a first name, so Overview starts with the right country's rules and wording. Pay and state come in the checklist, not onboarding.
- Each line opens the relevant sheet in place (quick add, import, estimate) instead of navigating away.
- When the checklist is done, the next-step card takes over as today.

### 6. Fewer things on screen

- **Navigation:** five main items, the rest under More.
  - Desktop sidebar: Overview, Transactions, Budgets, Plan (Next steps, Debts, Goals, Bills), Tax; then a collapsed "More" with Accounts, Pensions, Retirement, Compare wrappers, What if we moved, Tax rules, Import, Household, Settings, Guide.
  - Phone: the bottom tab bar from [mobile-apps.md](mobile-apps.md), with **+ Add** as a centre button.
- **Hide what doesn't apply:** Irish-only options (Investment Account, deemed disposal) for households with nobody in Ireland, US-only ones likewise; Server admin only when signed in as admin; Households and Account & sync under Settings unless more than one household exists.
- **Phone Transactions:** one row per transaction, payee and category chip on the left, amount on the right, date as a section header; tap a row to edit. No table.
- **Empty states** say what to do and offer the action, e.g. the net-worth chart shows "Add an account or import a statement to see this" instead of empty axes.

## Plan

Each phase ships on its own and is tested before the next.

| Phase | Work | Size | Done when |
| --- | --- | --- | --- |
| 1 | Fix the bugs listed above; onboarding creates the first person with residence; nav trimmed and country-specific options hidden | S | A new US household's first Overview shows US rules and no Irish options |
| 2 | Quick add (manual transactions, Cash account, Moved, monthly → Bill), `source: "manual"`, merge on import | M | A cash spend takes 4 taps; a later import of the same spend doesn't double count |
| 3 | Spending estimate, used by the snapshot until two months of data exist; first budget from it | M | A household with no transactions gets a real emergency-fund target |
| 4 | Import: multiple files, drop anywhere, account matching, remembered mappings, result screen, 60-day tracking rule | M | Importing two statements needs no choices beyond pressing Import |
| 5 | Merchant cleaning, US dictionary, review queue with group-and-rule | L | After a first US import, under 20% of spending is uncategorised, and the queue clears it in under 2 minutes |
| 6 | Setup checklist; phone Transactions list; empty states | M | A new user reaches a first budget in under 3 minutes (timed on the demo flow) |

Phases 1 and 6 overlap with the phone layout in mobile-apps.md phase 2; do them together.

### Progress

**Phase 1, done 2026-10-26.** A new US household's first Overview shows the US pack and ladder, greets the person by name, and has no Irish options (checked in `e2e/us.spec.ts`).

- Onboarding asks for a first name and creates that person resident where the household lives (`createEmptyDataset(..., first)`).
- New accounts, from Accounts, import or bank sync, take their country from their currency and the household's home, not IE. OFX, QFX, CAMT.053 and bank sync keep USD instead of turning it into EUR.
- Accounts' subtitle no longer says "EUR and GBP". The Investment Account option shows only when someone lives in Ireland; Compare wrappers is hidden when nobody lives in Ireland or the UK.
- The empty net-worth and spending charts say what to do instead of drawing empty axes.
- For members not resident in Ireland, the ladder leaves out DIRT, Irish pension relief limits and the Irish relief deadline.
- Sidebar: the main list is Overview, Transactions, Import, Accounts, Budgets, Next steps (Bills, Debts, Goals), Tax centre; everything else is under More, collapsed until opened.

Changed from the design above:

- Import and Accounts stay in the main list until quick add (phase 2) and drop-anywhere import (phase 4) give another way in.
- Households and Account & sync sit under More rather than inside Settings, which keeps one place for them and needs no new links.
- A UK-only household still runs the Irish step order and thresholds; only the Irish-only text is removed. A UK ladder is separate work.
- The first person's date of birth is a placeholder (1 January 1990) until edited. The "You" line of the setup checklist (phase 6) should ask for it with pay and state.

**Phase 2, done 2026-10-26.** A cash spend takes four taps (+ Add, amount, category chip, Save), and a later import of the same payment merges into it rather than double counting (`packages/ledger/test/manual.test.ts`, `e2e/quick-add.spec.ts`).

- **+ Add** in the sidebar on desktop, a floating button on phone, **Add transaction** on Transactions, and `N` on a keyboard open the sheet. Spent, Received or Moved; amount; optional payee, which fills the category; six category chips (most used, then common ones) and a More menu; account; date; "every month" adds a monthly bill. Enter saves; Shift+Enter or **Save and add another** keeps the sheet open.
- Rows entered by hand carry `source: "manual"`, show a "by hand" badge on Transactions and can be deleted there (a move deletes both sides).
- The Cash account is created on first use with `tracksBalance: false`: its spending counts, its balance is shown as "Not tracked" and stays out of net worth, so cash spending doesn't drive net worth negative.
- Typing "Netflix" picked Commute and fuel because the dictionary's `tfl` matched inside it; short brand names in that pattern now match whole words only.

Changed from the design above:

- An import merges a matching hand-entered row on its own (same account and amount, dates within 3 days) and reports how many it matched, instead of asking. That keeps import free of extra choices, which phase 4 aims for.
- Moved can't use the Cash wallet as the destination, since its balance isn't kept; depositing cash is recorded as Moved from Cash.
- The phone button is a floating one at the bottom right until the bottom tab bar from mobile-apps.md phase 2 gives it a centre slot.

## Testing

- Unit tests for merchant cleaning (a table of real-looking bank strings and expected names), the account matcher, manual/import merging, and the estimate fallback in the snapshot.
- Playwright: a new user path, desktop and phone: onboarding → quick add three spends → estimate → budget; and onboarding → drop two files → review queue → budget. Both assert no sideways scroll at 390 px.
- A timed run of each path before and after, recorded in this file.

## Open questions

- Should quick add allow splitting one payment across categories (e.g. a supermarket shop with household items)? Useful, but adds a step; proposed for later.
- Default budget style for new users: envelope (zero-based) is the current default; simple caps may suit most people better at first.
- Should the review queue also show "auto" categorisations for a quick confirm, or only uncategorised rows?
- Receipt photos on phone: out of scope for now; they need storage and would add a camera permission.
