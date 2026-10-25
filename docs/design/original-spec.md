# Cúntas — Personal Finance & Budgeting App Spec (Ireland first, UK-compatible)

Oct 22, 2026 · @Tom

## Summary

Build a privacy-first budgeting and financial-planning app whose core is the Irish personal finance flowchart turned into code: it tells each user their single next best money step, using real Irish tax rules, and handles people whose money spans Ireland and the UK.

- **Market gap.** No consumer app models Irish rules (USC, PRSI, age-banded pension relief, exit tax and deemed disposal, the new Investment Account) or IE-UK dual lives. Irish options are bank-tied (An Post Money Manager, Revolut) or UK-centric (Emma, Plum). UK churn is high: Money Dashboard and Moneyhub both left consumer apps.
- **Jurisdictions.** Republic of Ireland is the primary rules pack. A UK rules pack (England/Wales/NI first, Scotland later) runs alongside it. A cross-border layer handles residence, double-tax credits, currency and wrapper mismatches (for example, UK ISAs are not tax-free for an Irish resident).
- **Scope of this version.** Single household, web-first (installable PWA), bank sync through a licensed aggregator plus CSV/OFX import, manual assets and pensions, and an explainable next-step engine. Not regulated financial advice.
- **Working name.** "Cúntas" (Irish for account). Swap freely.

**How to use this with Claude Code.** Hand over the whole doc (export as Markdown into `docs/SPEC.md`). Build in the phase order in the build plan section. Rule figures in this spec are seed data for versioned rule packs, never hard-coded constants. Each phase lists acceptance criteria to turn into tests.

## The flowchart as the product's backbone

Every screen in the app should answer one question from the r/irishpersonalfinance flowchart (v2.1): "what should my next euro do?" The app turns each step into a measurable state, checks it against the user's real data, and shows the first step not yet met.

Reconciled with the v2.1 chart image (u/The\_Iron\_Grind) on 22 October 2026. The chart dates from 2022, so the third column adds rules it predates. Its thresholds are the app's defaults; users can change them.

| # | Chart step | Chart's rule | Added for 2026/27 | What the app does |
| --- | --- | --- | --- | --- |
| 0 | Track expenses, budget, set goals | Pay in this order: rent or mortgage (with home insurance), food, essential bills (energy, toiletries), income-earning costs (commute, phone, internet), minimum debt payments. Non-essential bills (TV, mobile, broadband) are paid in full only after the starter fund. Switch providers regularly: mortgage, energy, broadband, insurance, loans | LPT, motor tax, NCT, health insurance renewals | Payday waterfall that allocates pay in the chart's order; switching reminders at renewal dates |
| 1 | Build an emergency fund | The greater of EUR 1,500 or one month's net salary, in a current or savings account | DIRT on interest | Target = max(EUR 1,500, net monthly pay) |
| 2 | Employer-matched contributions | If the employer matches pension contributions, pay the minimum for the full match and nothing more; then the same for a 1:1 stock match scheme | MyFutureFund auto-enrolment and State top-up | Flags unclaimed pension or stock match; shows auto-enrolment status |
| 3 | Reduce existing debt | High-interest debt (above 8%): avalanche or snowball. Then raise the emergency fund to the greater of EUR 4,500-9,000 or 3-6 months' net salary. Then moderate debt (5-8%): avalanche or snowball | BNPL, PCP car finance | Payoff planner comparing avalanche and snowball; second emergency-fund target |
| 4 | Required investments | Save for required large purchases due soon, such as college fees, a car for work, professional certifications |  | Sinking funds with due dates and monthly amounts |
| 5 | Additional retirement savings | Save a percentage of pre-tax income equal to half your age (30 = 15%, 40 = 20%, 50 = 25%, 60 = 30%). If below, raise contributions in the employer scheme; if self-employed or no scheme, use an Executive Pension or PRSA | Revenue age-band relief limits and EUR 115,000 cap still bound tax relief | Half-your-age gauge; retirement projection; relief headroom |
| 6 | Advanced methods and goals | No home: save a deposit monthly so that savings plus current rent exceed one month's expected mortgage payment. Children's college fees: plan for them. Then choose: more discretionary spending; maximum pension (age-band limits, up to EUR 46,000 a year); savings for goals within 3-5 years, investments for goals beyond 5 years; overpay the mortgage by about 10%; invest through a trading platform. Higher-rate taxpayers may keep pension contributions ahead of deposit saving (deferred gratification) | Investment Account from 1 July 2027; exit tax and deemed disposal; Help to Buy up to EUR 35,000 | Mortgage-readiness test; college fund; side-by-side comparison of the options using after-tax figures; no named platforms |

Steps 0, 2, 3 and 6 contain ordered sub-checks (for example pension match before stock match), so the engine models each step as a short sequence, not a single test. The UK pack reuses the same seven steps with UK content: workplace pension match and Lifetime ISA at step 2, ISAs and SIPPs at steps 5-6. A dual-jurisdiction user sees one ladder, with each step tagged IE, UK or both.

## Current solutions and the gaps

Existing tools track spending well but none plans with Irish tax rules or across the IE-UK border; that planning layer is the product.

| Solution | Markets | Model | Does well | Gap for our user |
| --- | --- | --- | --- | --- |
| [An Post Money Manager](https://www.anpost.com/Money/Discover-your-App/Money-Manager) | IE | Free, inside An Post Money app; powered by Tink | Links all Irish banks and cards; budgets and alerts | Spending only: no pensions, tax, investments or UK |
| Revolut built-in analytics | IE, UK | Free, bank-native | Very high Irish adoption; categories, vaults | Sees its own accounts best; no planning or Irish tax logic |
| AIB, BOI, PTSB apps | IE | Free, bank-native | Basic spend insights | Single-bank view |
| [Emma](https://emma-app.com) | UK (some EUR use) | Freemium | Aggregation, subscriptions, budgets | UK-first; no Irish tax, no IE pensions |
| [Plum](https://www.fstech.co.uk/fst/Ireland_Gets_Plum_Deal_For_Smart_Saving.php) | UK, IE | Freemium | Automated saving | Saving automation, not planning |
| Snoop, Monzo | UK | Free / paid add-on | Bills, pots, payday budgeting | UK only |
| YNAB | Global | Paid, around USD 109 a year | Zero-based budgeting method | No EU bank sync, no tax or pension model |
| [Actual Budget](https://actualbudget.org) | Global, self-hosted | Open source | Envelope budgeting, local-first, EU sync via [Enable Banking](https://actualbudget.org/docs/advanced/bank-sync/enable-banking) | Budgeting only; technical setup |
| [Moneyhub](https://moneyhub.com/app-end-of-service-announcement) | UK | Closed consumer app, 14 Aug 2026 | Pensions and net worth in one place | Gone; users looking for a home |

The UK market keeps losing consumer aggregators: Money Dashboard closed in 2023 and Moneyhub's app was decommissioned in August 2026, both pivoting to B2B. Sustainable economics matter (see open decisions).

**Gaps the app fills**

1. A next-step plan driven by Irish rules, not generic "50/30/20" advice.
2. Take-home pay, pension relief headroom, and investment-wrapper comparisons calculated from versioned Irish and UK rule packs.
3. One view of EUR and GBP money with correct cross-border treatment (UK ISA, UK pensions, NI State Pension record, frontier work).
4. Deemed-disposal and tax-deadline calendar (Form 11 by 31 October, CGT payment dates).
5. Data the user owns: local-first, exportable, no selling of transaction data.

## Republic of Ireland rules to model

The IE rule pack ships with 2026 and 2027 tax years. Budget 2027 (6 October 2026) changed bands, credits, USC, CGT, the fund exit-tax rate and created a new Investment Account; Finance Bill 2026 will finalise details, so every value below is seed data to verify against Revenue before release.

**Income tax, credits, USC, PRSI** ([KPMG Budget 2027 rates](https://kpmg.com/ie/en/insights/tax/budget-2027/tax-rates-and-credits.html))

| Item | 2026 | 2027 |
| --- | --- | --- |
| 20% band, single | EUR 44,000 | EUR 46,500 |
| 20% band, married one income | EUR 53,000 | EUR 55,500 |
| 20% band, married two incomes (max) | EUR 88,000 | EUR 93,000 |
| 20% band, one-parent family | EUR 48,000 | EUR 50,500 |
| Personal credit, single | EUR 2,000 | EUR 2,125 |
| Employee (PAYE) and earned income credits | EUR 2,000 each | EUR 2,125 each |
| Rent tax credit, single / couple (max) | EUR 1,000 / 2,000 | EUR 1,150 / 2,300 |
| USC 0.5% / 2% / 3% / 8% | to 12,012 / to 28,700 / to 70,044 / above | to 12,012 / to 30,300 / to 70,044 / above |
| USC exemption threshold | total income EUR 13,000 | EUR 13,000 |
| Self-employed USC surcharge | 11% above EUR 100,000 | 11% above EUR 100,000 |
| Employee PRSI (Class A1) | 4.2% to 30 Sep; 4.35% from 1 Oct | 4.35% to 30 Sep; 4.5% from 1 Oct |

PRSI changes mid-year, so the engine must apply rates by pay date, not by tax year. PRSI exemption and the sliding-scale credit (EUR 352 to EUR 424 a week) need weekly logic.

**Capital and investment taxes**

| Item | Rule | Source |
| --- | --- | --- |
| CGT rate | 33%, falling to 31% for disposals from 7 Oct 2026 (development land stays 33%) | [William Fry](https://www.williamfry.com/?p=163326) |
| CGT annual exemption | EUR 1,270 per person; payment dates 15 Dec (Jan-Nov disposals) and 31 Jan (Dec disposals) | [Raisin](https://www.raisin.com/en-ie/taxes/capital-gains-tax-property) |
| Exit tax on funds and ETFs | 38% in 2026; 35% from 1 Jan 2027; no annual exemption, no loss offset | [Crowe](https://www.crowe.com/ie/insights/budget-2027-highlights) |
| Deemed disposal | Unchanged: tax on unrealised gains every 8 years outside the new account | [RSM](https://www.rsm.global/ireland/node/768) |
| DIRT on deposit interest | 33% (verify for 2027) | [etf.ie](https://etf.ie/tax/) |
| CAT thresholds A / B / C | EUR 420,000 / 44,000 / 22,000 from 7 Oct 2026; rate 33% | KPMG |

**New Investment Account (from 1 July 2027)**: EUR 12,000 annual contribution limit, EUR 50,000 tax-free value, then 1% a year on the average value above EUR 50,000. No CGT, dividend withholding tax, investment undertaking (exit) tax or deemed disposal inside it; one account per Irish-resident adult with a PPSN; shares, bonds, funds and insurance-based products allowed ([Crowe](https://www.crowe.com/ie/insights/budget-2027-highlights), [RSM](https://www.rsm.global/ireland/node/768)). Model it as a wrapper with a value-based tax rule, feature-flagged until the legislation passes.

**Pensions**

- Tax relief at the marginal rate on personal contributions, capped by age band and a EUR 115,000 earnings limit across all schemes ([Revenue](https://revenue.ie/en/jobs-and-pensions/pension/relief/tax-relief-limits.aspx)). USC and PRSI still apply to the gross.

| Age in tax year | Under 30 | 30-39 | 40-49 | 50-54 | 55-59 | 60+ |
| --- | --- | --- | --- | --- | --- | --- |
| Relief limit, % of earnings | 15% | 20% | 25% | 30% | 35% | 40% |

- MyFutureFund auto-enrolment, live since 1 Jan 2026: employees aged 23-60 earning EUR 20,000+ not in a qualifying scheme. Contributions 1.5% employee, 1.5% employer, 0.5% State for 2026-2028, rising every three years; capped on EUR 80,000 of pay; no employee tax relief (the State top-up replaces it); opt-out allowed after the initial period, with re-enrolment after two years ([BrightPay](https://brightsg.com/en-ie/blog/auto-enrolment-in-ireland-what-it-means-for-employees/), [MTU](https://finance.mtu.ie/auto-enrolment)).
- Also model: PRSAs, AVCs, ARFs, State Pension (Contributory) from 66, which is taxable but not subject to USC.

**Housing and household**

- Help to Buy: up to EUR 35,000 (from EUR 30,000) for first-time buyers of new homes, capped at 10% of price and income tax plus DIRT paid over the previous four years ([Irish Tax Hub](https://www.irishtaxhub.ie/blog/budget-2027-what-it-means-for-you)).
- Minimum wage EUR 14.94 an hour from 1 Jan 2027; State Pension and weekly welfare up EUR 10 a week ([Raisin](https://www.raisin.com/en-ie/press/ireland-budget-2027/)).

## UK rules and cross-border treatment

The UK pack covers the 2026/27 tax year (6 April to 5 April) and the already-legislated April 2027 changes; the Autumn Budget on 28 October 2026 will likely add more, so the pack must be updatable without a code release ([UK Tax Drag tracker](https://uktaxdrag.co.uk/autumn-budget-2026-tracker)).

**UK pack, 2026/27 (England, Wales, Northern Ireland)**

| Item | Rule | Source |
| --- | --- | --- |
| Personal allowance | GBP 12,570, frozen to April 2031; tapers above GBP 100,000 | [Deloitte](https://taxscape.deloitte.com/taxtables/deloitte-uk-tax-rates-2026-27.pdf) |
| Income tax | 20% to GBP 50,270; 40% to GBP 125,140; 45% above | [QuickBooks](https://quickbooks.intuit.com/uk/blog/new-tax-year-changes-2026-2027/) |
| Employee NI | 8% from GBP 12,570 to 50,270; 2% above | [UK Tax Drag](https://uktaxdrag.co.uk/rates-and-allowances-2026-27) |
| ISA allowance | GBP 20,000; Lifetime ISA GBP 4,000 within it; Junior ISA GBP 9,000 | [NS&I](https://www.nsandi.com/get-to-know-us/isa-allowances) |
| Cash ISA cap (from 6 Apr 2027) | GBP 12,000 for under-65s; 22% charge on interest on cash held in stocks and shares ISAs; no stocks-to-cash ISA transfers for under-65s | [Richify](https://www.richify.ai/uk/autumn-budget-2026) |
| Savings income | Rates rise 2 points from 6 Apr 2027 (22% / 42% / 47%); Personal Savings Allowance GBP 1,000 basic, GBP 500 higher | [TaxAssist](https://www.taxassist.co.uk/resources/questions-and-answers/tax-on-bank-interest) |
| Dividends | Rates up 2 points from April 2026; GBP 500 allowance | [ATT](https://www.att.org.uk/technical/news/202627-tax-year-updates-housekeeping-individuals) |
| Pensions and IHT | Unused pensions enter the estate for inheritance tax from 6 Apr 2027 | [Richify](https://www.richify.ai/uk/autumn-budget-2026) |
| State Pension | Full new State Pension GBP 241.30 a week | [Aviva](https://www.aviva.co.uk/investments/investing-for-beginners/autumn-budget-update/) |

Scotland has its own six-band income tax; ship it as a sub-pack after launch.

**Cross-border rules the app must encode**

| Situation | Treatment | What the app does |
| --- | --- | --- |
| IE resident working in NI/GB, commuting | UK taxes the pay; Ireland credits UK tax. Trans-border workers relief (s.825A) can remove the Irish top-up, but working days at home in Ireland can lose it | Flags eligibility, counts work-from-home days in IE |
| NI resident working in ROI | No equivalent UK relief; UK may levy a top-up via self assessment | Estimates the UK balance due |
| IE resident with UK private or occupational pension | Taxable only in Ireland (DTA Art. 17); relief at source can be claimed from HMRC | Shows Irish tax on the pension; reminder to claim UK relief |
| UK government-service pension | Generally taxable in the UK only, unless the person is Irish-resident and an Irish national (Art. 18) | Asks nationality before classifying |
| IE resident holding a UK ISA | No Irish tax exemption; income and gains taxable in Ireland; fund holdings may fall under exit tax and deemed disposal | Treats the ISA as a taxable account under IE rules and warns |
| UK State Pension record | Class 2 voluntary NI abroad abolished from 6 Apr 2026; Class 3 (about GBP 923 a year) needs 10 years of UK residence or contributions | Gap checker and cost-versus-benefit estimate |
| Two tax years | IE: calendar year. UK: 6 April to 5 April | Every tax figure carries its jurisdiction's tax-year id |
| Two currencies | EUR and GBP; tax uses the rate on the transaction date | Stores original currency and FX rate per transaction |

Sources: [Irish Tax Hub on foreign pensions](https://www.irishtaxhub.ie/blog/taxation-of-foreign-pensions-in-ireland), [UK-Ireland treaty guide](https://www.countrytaxcalc.com/tax-guides/uk-ireland-tax-treaty-guide-2026/), [Experts for Expats](https://www.expertsforexpats.com/advice/tax/ireland-uk-tax-guide-for-british-expats-in-ireland), [Revenue trans-border relief manual](https://revenue.ie:443/en/tax-professionals/tdm/income-tax-capital-gains-tax-corporation-tax/part-34/34-00-06.pdf), [InterTradeIreland](https://crossbordertradehub.intertradeireland.com/employing-a-cross-border-worker-resident-in-ireland-going-to-work-in-northern-ireland), [Crowe UK on voluntary NI](https://www.crowe.com/uk/insights/changes-voluntary-national-insurance-abroad), [Greenback](https://www.greenbacktaxservices.com/blog/uk-ends-class-2-national-insurance-expats/).

The app never decides tax residence. The user declares it per year; the app explains the tests and flags when entered travel or workdays look inconsistent.

## Users, principles and non-goals

The primary user is an Irish-resident PAYE household; the differentiating user is a household with money in both Ireland and the UK.

| Persona | Situation | Top jobs |
| --- | --- | --- |
| Irish PAYE earner | Salaried, pension at work or in MyFutureFund, renting or mortgaged | See where money goes; know the next step; use pension relief headroom |
| Dual-life household | One or both partners hold UK pensions, ISAs or accounts; may move between IE and UK | One EUR/GBP net-worth view; correct tax treatment per residence; relocation what-ifs |
| Frontier worker | Lives in ROI, works in NI (or the reverse) | Trans-border relief check; WFH day tracking; two tax years |
| Returner or incomer | Irish emigrant coming home from the UK, or a UK national moving to Ireland | What changes for ISAs, pensions and NI record; first-year checklist |
| Self-employed (phase 4) | Form 11, preliminary tax, PRSI Class S | Set-aside for tax; deadline calendar |

**Principles**

1. **Every number explains itself.** Each calculated figure links to the rule, rate, rule-pack version and source it came from.
2. **Rules are data.** Rates, bands and thresholds live in versioned, dated rule packs with sources; code never hard-codes a tax figure.
3. **The user owns the data.** Local-first storage, full export (JSON and CSV), delete-everything in one action, no sale or sharing of transaction data.
4. **Guidance, not advice.** The app explains rules and ranks generic steps; it never recommends a named product or provider.
5. **Works without bank sync.** CSV/OFX import and manual entry are first-class, because consent expires every 90 days and some institutions (credit unions, pension providers) have no API.

**Non-goals for this spec**: moving money or initiating payments; executing trades; filing tax returns with Revenue or HMRC; credit scoring or lending; tax-residence determination; regulated financial advice.

## Feature specification

The MVP (P0) is a trustworthy household ledger plus the next-step engine for Irish users; UK and cross-border depth arrives in P1-P2. Change a priority with its dropdown.

| Module | Feature | Jurisdiction | Priority | Behaviour and acceptance notes |
| --- | --- | --- | --- | --- |
| Accounts | Bank sync via licensed aggregator | IE, UK | P0 MVP | Read-only AIS consent; 90-day re-consent reminder 7 days ahead; nightly sync; never stores bank credentials |
| Accounts | File import (CSV, OFX, CAMT.053) with bank presets | IE, UK | P0 MVP | Presets for AIB, BOI, PTSB, Revolut, An Post Money, credit unions, Monzo, Starling, Barclays, Danske NI; column mapper for anything else; idempotent re-import |
| Accounts | Manual accounts and assets | IE, UK | P0 MVP | Credit union shares and loans, cash, property, vehicles, State Savings, prize bonds |
| Accounts | Multi-currency and transfer matching | IE, UK | P0 MVP | EUR and GBP native; daily ECB reference rates; matches internal transfers across currencies so they are not counted as spending |
| Spending | Categorisation | IE, UK | P0 MVP | User rules first, then an Irish/UK merchant dictionary, then optional on-device ML; every auto-category is reversible and learns from corrections |
| Spending | Budgets | IE, UK | P0 MVP | Two modes: envelope (zero-based, assign money you have) and simple monthly caps; rollover per category; payday-based months |
| Spending | Recurring bills and Irish bill calendar | IE, UK | P1 | Detects subscriptions and price rises; templates for LPT, TV licence, motor tax, NCT, health insurance renewal, bin charges, UK council tax |
| Spending | Household sharing | IE, UK | P1 | Two or more members, joint and individual accounts, per-member visibility, shared budgets, fair-split by income ratio |
| Income | Take-home pay calculator | IE first, UK P1 | P0 MVP | Income tax, credits, USC, PRSI by pay date, pension and MyFutureFund deductions; UK PAYE, NI, student loan; matches Revenue/HMRC examples to the cent |
| Income | Payslip check | IE, UK | P1 | User enters or photographs a payslip; flags emergency tax, missing credits, wrong USC band |
| Income | Variable income and bonuses | IE, UK | P1 | Smooths irregular pay for budgeting; marginal tax on a bonus |
| Debt | Debt register and payoff planner | IE, UK | P0 MVP | Avalanche or snowball; payoff date, total interest, interest saved per extra EUR 50 |
| Debt | Mortgage overpay vs invest vs pension | IE, UK | P1 | Compares after-tax outcomes using the user's marginal rate and the rule pack |
| Goals | Goals and emergency fund | IE, UK | P0 MVP | Chart targets by default (greater of EUR 1,500 or one month's net pay, then EUR 4,500-9,000 or 3-6 months), with an option to base them on essential spending; goal pots with dates and monthly amount needed |
| Goals | Help to Buy estimator | IE | P1 | Lowest of EUR 35,000, 10% of price, and tax plus DIRT paid over 4 years |
| Pensions | Pension register | IE, UK | P0 MVP | Occupational DC/DB, PRSA, AVC, MyFutureFund, ARF, UK workplace DC/DB, SIPP, both State Pensions |
| Pensions | Tax-relief headroom | IE (UK annual allowance P1) | P0 MVP | Unused age-band relief this year, euro value at marginal rate, deadline (31 Oct via Form 11/ROS for prior year) |
| Pensions | Retirement projection | IE, UK | P1 | Combined income at 66 (IE) and UK State Pension age; real terms; scenarios |
| Pensions | UK NI record gap check | UK | P2 | User enters HMRC record; cost of Class 3 versus extra pension; eligibility test for the 10-year rule |
| Investing | Holdings and broker import | IE, UK | P1 | Manual plus CSV from common brokers; lots with dates and cost in original currency |
| Investing | Tax-wrapper classifier | IE, UK | P1 | Each holding tagged: exit-tax fund, CGT asset, Investment Account, UK ISA, SIPP, GIA; treatment follows the user's residence, not the account's country |
| Investing | Deemed-disposal calendar | IE | P1 | 8-year anniversary per lot, estimated liability, cash needed and payment deadline |
| Investing | Wrapper comparison | IE, UK | P1 | After-tax projection: Investment Account vs ETF vs investment trust vs pension vs ISA, same contribution and return |
| Tax | Tax-year summary and deadlines | IE, UK | P1 | Per-jurisdiction summary; reminders for Form 11 (31 Oct), CGT (15 Dec, 31 Jan), UK self assessment (31 Jan) |
| Tax | Credits and reliefs checklist | IE | P1 | Rent credit, medical expenses, remote working, flat-rate expenses, tuition fees, home carer; links to Revenue myAccount |
| Tax | Cross-border tools | IE, UK | P2 | DTA credit estimate, trans-border relief check, workday log by country, relocation what-if |
| Overview | Net worth over time | IE, UK | P0 MVP | Assets and liabilities in a chosen base currency, with FX effect shown separately |
| Overview | Next-step card | IE first | P0 MVP | See next section |
| Overview | Residence-change what-if | IE, UK | P2 | Shows which wrappers, reliefs and pensions change treatment if the household moves |
| Platform | Export, backup, delete | All | P0 MVP | Full JSON and CSV export; encrypted backup; delete-all |

**Added after reconciling with the flowchart**

| Module | Feature | Jurisdiction | Priority | Behaviour and acceptance notes |
| --- | --- | --- | --- | --- |
| Spending | Payday waterfall | IE, UK | P0 MVP | Allocates each pay in the chart's order: housing, food, essential bills, income-earning costs, minimum debt payments, emergency fund, then non-essential bills; shows the first bucket left short |
| Spending | Provider-switching reminders | IE, UK | P1 | Renewal dates for mortgage, energy, broadband, insurance and loans; prompt 30 days ahead to compare (no named providers) |
| Income | Stock match scheme | IE, UK | P1 | Records 1:1 share match plans; flags contributions below the full match |
| Goals | Sinking funds for required purchases | IE, UK | P0 MVP | College fees, car for work, certifications; amount, due date, monthly saving needed |
| Pensions | Half-your-age gauge | IE, UK | P0 MVP | Current contribution rate (employee plus employer) against age divided by 2 as a percentage of pre-tax pay |
| Goals | Mortgage-readiness test | IE | P1 | Passes when monthly deposit saving plus current rent exceeds the expected mortgage payment; pairs with Help to Buy estimator |
| Goals | Children's college fund | IE, UK | P1 | Target per child and year; savings for under 5 years, investments for longer |

## Next-step engine: the flowchart as code

The engine is a deterministic, ordered list of step definitions evaluated against the household's state; the first unmet step becomes the next-step card, and its explanation cites the rule pack it used.

&#91;embedded content: next-step engine · 7 chart steps, 2 outputs\]

In this example step 4 (required purchases) is the first unmet step, so it becomes the next-step card; step 2 (unclaimed employer match) is also unmet and, being always-on, shows as a second card.

**Step definition (stored as data, one file per step per jurisdiction)**

```ts
type StepDefinition = {
  id: string;                 // "ie.employer-match"
  order: number;              // position in the ladder
  jurisdictions: ("IE" | "UK")[];
  appliesWhen: Predicate;     // e.g. member.employment === "employee"
  isMet: Predicate;           // e.g. pension.matchCaptured >= pension.matchAvailable
  progress: Metric;           // current, target, unit (EUR, GBP, months, %)
  alwaysOn?: boolean;         // e.g. never skip free employer money even while repaying debt
  explain: TemplateRef;       // plain-English text with {placeholders}
  sources: RuleRef[];         // rule-pack keys used, shown as "why"
  actions: ActionRef[];       // in-app actions only, never named products
};
```

**Evaluation rules**

1. Build a household snapshot: balances, 12-month essential spend, debts with APR, pension contributions and match, ages, residence per member, goals.
2. Evaluate steps in order per member and for the household; skip steps whose `appliesWhen` is false.
3. The first step with `isMet` false is the current step. `alwaysOn` steps that are unmet show as a second card.
4. Thresholds are user-adjustable; defaults come from the chart: high-interest debt above 8%, moderate 5-8%, starter fund the greater of EUR 1,500 or one month's net pay, full fund the greater of EUR 4,500-9,000 or 3-6 months' net pay (upper end for single-income or self-employed households), retirement saving at half your age as a percentage of pre-tax income.
5. Output is a pure function of snapshot plus rule-pack version, so it is unit-testable and reproducible.

**Example output**

```json
{
  "step": "ie.pension-relief-headroom",
  "member": "member-1",
  "headline": "You have EUR 6,400 of unused pension relief for 2026",
  "why": "Age 40-49 limit is 25% of earnings up to EUR 115,000; you contributed 9%. At 40% marginal rate that is EUR 2,560 of tax back.",
  "deadline": "2027-10-31",
  "rulePack": "IE-2026.3",
  "progress": { "current": 9, "target": 25, "unit": "%" }
}
```

Guardrails: no product or provider recommendations, a "this is information, not advice" note on every planning screen, and a one-tap "not relevant to me" that records why and moves on.

## Jurisdiction rules engine

All tax logic sits in one package: versioned rule packs (data) plus pure calculator functions (code), with a cross-border layer that decides which pack applies to which income or asset.

**Rule packs**

```yaml
# rules/ie/2027.yaml
jurisdiction: IE
taxYear: "2027"            # IE calendar year; UK packs use "2026-27"
version: "IE-2027.1"
status: provisional         # provisional until Finance Act; then verified
sources:
  - https://kpmg.com/ie/en/insights/tax/budget-2027/tax-rates-and-credits.html
incomeTax:
  standardRateBand: { single: 46500, marriedOneIncome: 55500, marriedTwoIncomesMax: 93000, oneParent: 50500 }
  rates: { standard: 0.20, higher: 0.40 }
  credits: { personalSingle: 2125, employee: 2125, earnedIncome: 2125, rentSingleMax: 1150 }
usc:
  exemptionThreshold: 13000
  bands: [ { upTo: 12012, rate: 0.005 }, { upTo: 30300, rate: 0.02 }, { upTo: 70044, rate: 0.03 }, { upTo: null, rate: 0.08 } ]
prsi:
  classA1:
    - { from: "2027-01-01", rate: 0.0435 }
    - { from: "2027-10-01", rate: 0.045 }
```

- Every value carries an effective date range, so mid-year changes (PRSI on 1 October, CGT on 7 October 2026) work by date, not by year.
- Packs have a status: `provisional` (Budget announced) or `verified` (Finance Act or HMRC/Revenue published). The UI shows which one was used.
- New packs ship as data updates with a signed manifest; no app release needed.

**Calculators (pure, typed, money as integer cents)**

- `ie.payroll`, `ie.pensionRelief`, `ie.exitTax`, `ie.deemedDisposal`, `ie.cgt`, `ie.investmentAccount`, `ie.helpToBuy`
- `uk.payroll`, `uk.isaAllowance`, `uk.pensionAnnualAllowance`, `uk.savingsTax`, `uk.niVoluntary`
- `xb.classify(item, member, year)` returns which jurisdiction taxes the item, the method (exemption, credit, relief) and the treaty article or relief referenced.

**Golden tests (must pass to the cent before any release)**

| Case | Expected | Source |
| --- | --- | --- |
| IE single PAYE, EUR 50,000, 2027 | Income tax EUR 6,450; USC EUR 1,017; PRSI EUR 2,194 | [Grant Thornton](https://www.grantthornton.ie/insights/budget/how-budget-2027-affects-you-and-your-family/) |
| IE single PAYE, EUR 50,000, 2026 | Income tax EUR 7,200; USC EUR 1,033; PRSI EUR 2,119 | Grant Thornton |
| IE pension relief, age 30-39, EUR 60,000 | Max relievable EUR 12,000 | [Revenue age limits](https://revenue.ie/en/jobs-and-pensions/pension/relief/tax-relief-limits.aspx) |
| IE pension relief, age 60+, EUR 150,000 | Max relievable EUR 46,000 (cap EUR 115,000) | Revenue |
| UK Cash ISA, under 65, 2027/28 | Cash subscription blocked above GBP 12,000 | NS&I |

Add Revenue and HMRC worked examples for each calculator as they are built; a failing golden test blocks the build.

## Data model

Twenty-one entities cover the MVP through phase 4; the key design choices are integer minor units, original currency on every money field, and residence held per member per period.

| Entity | Key fields | Notes |
| --- | --- | --- |
| Household | id, name, baseCurrency (EUR or GBP) | Tenant boundary; all other rows carry householdId |
| Member | id, name, dateOfBirth, nationality\[\], employmentType | Age drives pension relief bands; nationality matters for DTA Art. 18 |
| ResidencePeriod | memberId, jurisdiction, from, to, declaredBy | Declared by user; never inferred |
| Institution | id, name, country, bic, aggregatorRef | Seeded list of IE and UK banks, credit unions, brokers, pension providers |
| Connection | id, institutionId, provider, consentExpiresAt, status | Aggregator session; no credentials stored |
| Account | id, memberIds\[\], type, currency, institutionId, wrapper, jurisdiction | Types: current, savings, credit card, loan, mortgage, pension, brokerage, property, other; wrapper: none, ISA, LISA, SIPP, PRSA, AVC, InvestmentAccount, etc. |
| Transaction | id, accountId, bookedAt, amountMinor, currency, fxRateToBase, payee, rawDescription, externalId, categoryId, transferPairId | Unique on (accountId, externalId) or a content hash for file imports |
| Split | transactionId, categoryId, amountMinor | Optional per-line categories |
| Category | id, name, group, isEssential | isEssential feeds the emergency-fund target |
| CategoryRule | match (payee, regex, amount range), categoryId, priority | User rules beat dictionary rules |
| Budget | id, period, mode (envelope or cap), lines\[\] | Payday-based periods allowed |
| Goal | id, type, targetMinor, currency, targetDate, linkedAccountIds\[\] | Types include emergency fund and house deposit |
| Debt | accountId, aprBps, minPayment, termEnd | Feeds payoff planner and step thresholds |
| PensionPlan | id, memberId, kind, jurisdiction, employerMatchRule, valueMinor | Kinds: occupational DC/DB, PRSA, AVC, MyFutureFund, ARF, UK DC/DB, SIPP, State |
| Contribution | pensionPlanId, date, employeeMinor, employerMinor, stateMinor, reliefClaimed | Drives relief headroom |
| Holding and Lot | accountId, instrument (ISIN), taxClass, lots\[{date, units, costMinor, currency}\] | taxClass: exitTaxFund, cgtAsset, wrapperExempt; per-lot dates drive deemed disposal |
| FxRate | date, base, quote, rate, source | ECB reference rates |
| TaxYearSummary | memberId, jurisdiction, taxYear, rulePackVersion, figures | Cached output; recomputed when data or pack changes |
| StepState | memberId, stepId, status, dismissedReason, evaluatedAt | History of next-step progress |
| AuditEvent | actor, action, entity, at | Security and "why did this change" trail |

## Architecture, stack and bank data

A TypeScript monorepo deployed as a small Docker Compose stack (web, API, worker, Postgres), with all tax logic in a pure package that runs identically on server and in the browser.

&#91;embedded content: system architecture · 4 services, 3 external sources\]

The browser and API share the same rules and engine code, so a figure shown offline matches the server's figure exactly.

**Repository layout**

| Path | Purpose | Key tech |
| --- | --- | --- |
| `apps/web` | Installable PWA: dashboard, ledger, budgets, plans | React, Vite, TanStack Router and Query, Tailwind, Recharts |
| `apps/api` | REST/JSON API, auth, household tenancy | Hono on Node 22, Zod validation, OpenAPI generated from schemas |
| `apps/worker` | Scheduled sync, FX fetch, rule-pack updates, reminders | BullMQ on Redis, or pg-boss to avoid Redis |
| `packages/rules` | Rule packs (YAML) and calculators | Pure TS, no I/O, integer minor units, Vitest golden tests |
| `packages/engine` | Next-step engine and step definitions | Pure TS, depends only on `rules` |
| `packages/importers` | CSV, OFX, CAMT.053 parsers and bank presets | Fixture files per bank in `fixtures/` |
| `packages/providers` | Bank-data adapters behind one interface | `BankDataProvider`: listInstitutions, startConsent, fetchAccounts, fetchTransactions, revoke |
| `packages/db` | Schema, migrations, row-level tenancy | Postgres 16, Drizzle ORM |

**Bank data**

- Default provider: [Enable Banking](https://actualbudget.org/docs/advanced/bank-sync/enable-banking), which offers PSD2 account access across EU and UK banks and is free for personal use; Actual Budget already integrates it ([enable-actual](https://github.com/2manyvcos/enable-actual)).
- GoCardless Bank Account Data (formerly Nordigen) has [closed to new sign-ups](https://dev.to/johnfrandsen/gocardless-bank-account-data-alternatives-what-to-use-when-signups-are-disabled-326d); support it only as an adapter for existing keys.
- Commercial launch needs a paid licensed aggregator (Tink, TrueLayer, Yapily, Salt Edge) under their AISP licence; Tink already powers An Post Money Manager in Ireland. Keep the adapter interface so this is a configuration change.
- Consent lasts 90 days under PSD2; schedule re-consent prompts and fall back to file import when a bank or credit union has no API.
- Read-only scopes only (AIS). No payment initiation.

**Other services**

- FX: ECB daily reference rates, stored per date.
- Auth: passkeys (WebAuthn) with TOTP fallback; household invites by link.
- Notifications: web push and email for re-consent, bills, deadlines, deemed-disposal dates.
- Mobile: the PWA first; wrap with Capacitor in phase 4 if app-store presence is needed.

## Security, privacy and regulatory position

As a personal or self-hosted tool the app carries little regulatory weight; offered to the public it needs a licensed aggregator partner, a careful guidance-not-advice line, and GDPR controls from day one. Treat this section as design input, not legal advice; confirm with counsel before any public launch.

**Regulatory**

| Area | Ireland | UK | Design response |
| --- | --- | --- | --- |
| Account data access | Account information services are authorised under PSD2 by the Central Bank | Authorised by the FCA | Never become an AISP; run under a licensed aggregator's permission (agent model) |
| Financial advice | Personal recommendations on investment products are regulated | Advice versus guidance boundary set by the FCA | Rules-based, generic steps; no named products; show assumptions; disclaimers |
| Data protection | GDPR, supervised by the Data Protection Commission | UK GDPR, supervised by the ICO | DPIA before launch; EU hosting; processor list; export and erase built in |
| Coming change | PSD3 and the Financial Data Access regulation may allow paid premium APIs and wider data | Smart Data schemes | Keep the provider adapter abstract; budget for per-connection fees |

**Security controls (target OWASP ASVS level 2)**

- Passkeys by default; TOTP fallback; session binding; re-auth for export and delete.
- Postgres row-level security keyed on householdId; every query scoped.
- Envelope encryption for aggregator tokens and sensitive fields (payslips, PPSN/NI numbers are not stored by default).
- TLS everywhere; encrypted backups; secrets in the platform vault, never in the repo.
- No personal data in logs or analytics; product analytics opt-in and aggregate only.
- Dependency and container scanning in CI; signed rule-pack manifests.
- Audit trail for sign-ins, consent changes, exports and deletions.

## Build plan for Claude Code

Five phases, each ending in a usable app and a green test suite; the acceptance criteria below become the tests Claude Code writes first.

**Working agreement (put in `CLAUDE.md`)**

- Read `docs/SPEC.md` before each phase; keep it updated when a decision changes.
- Test-first for `packages/rules` and `packages/engine`; golden tests are never edited to pass.
- No tax figure in code outside `rules/**/*.yaml`; a lint rule rejects numeric literals in calculators except 0, 1 and 100.
- Money is integer minor units plus ISO currency; never floats.
- Each pull request: tests, migration if needed, and a one-paragraph changelog entry.

**Phase 0: Foundations**

- [ ] Monorepo with pnpm workspaces, TypeScript strict, ESLint, Vitest, Playwright, GitHub Actions CI
- [ ] Docker Compose: web, api, worker, Postgres; seed script with a demo household
- [ ] Passkey sign-up, household creation, member invite, row-level security tests proving cross-household isolation

**Phase 1: Ledger MVP**

- [ ] Manual accounts, CSV/OFX/CAMT import with presets for AIB, BOI, PTSB, Revolut and An Post Money; re-importing the same file creates no duplicates
- [ ] Enable Banking adapter: consent, account list, transactions, 90-day expiry reminder
- [ ] EUR and GBP accounts with ECB rates; a EUR to GBP transfer pair nets to zero spending
- [ ] Categories, user rules, Irish merchant dictionary; correcting one transaction offers a rule
- [ ] Envelope and cap budgets; net-worth chart in base currency

**Phase 2: Irish planning core**

- [ ] IE rule packs 2026 and 2027 (provisional) with all golden tests passing
- [ ] Take-home pay calculator matching the Grant Thornton EUR 50,000 cases to the euro
- [ ] Pension register, MyFutureFund contributions, relief headroom by age band and EUR 115,000 cap
- [ ] Debt register and avalanche/snowball planner
- [ ] Goals and emergency-fund target from essential spending
- [ ] Next-step engine with the seven IE steps (0-6) and their sub-checks; every card shows its rule-pack version and sources

**Phase 3: Investing and tax centre (IE)**

- [ ] Holdings and lots, broker CSV import, tax-class tagging
- [ ] Exit tax (38% for 2026 disposals, 35% from 2027), deemed-disposal calendar per lot, CGT at 33% then 31% by disposal date
- [ ] Investment Account wrapper behind a feature flag (EUR 12,000 limit, EUR 50,000 threshold, 1% on average value above)
- [ ] Wrapper comparison calculator; tax deadline reminders; credits checklist

**Phase 4: UK pack and cross-border**

- [ ] UK 2026/27 pack (rUK), payroll, ISA allowance tracker with the April 2027 cash cap and transfer block
- [ ] Residence periods per member; `xb.classify` for employment, pensions, ISAs and deposits with treaty references
- [ ] Trans-border relief check with workday log; UK NI gap checker
- [ ] Residence-change what-if; Scotland sub-pack; optional Capacitor wrapper

**Definition of done for every phase**: all tests green, Playwright happy path recorded, export still round-trips (export, wipe, import gives identical data), and no rule value without a source URL.

## Open decisions

The spec assumes the defaults below; the first one changes the most.

| Decision | Default assumed | Why it matters |
| --- | --- | --- |
| Personal/household tool or public product | Personal, self-hosted, one household | Public use means a paid aggregator, regulatory review, support and a business model |
| Platform | PWA first, native wrapper in phase 4 | Native apps add store review and push certificates early |
| Business model if public | Paid subscription, no data monetisation | Free aggregators keep closing (Money Dashboard, Moneyhub); data resale conflicts with principle 3 |
| Married couples in IE | Model joint assessment and band transfer from phase 2 | Changes take-home pay and relief for most couples |
| Self-employed | Phase 4 | Form 11, preliminary tax and Class S PRSI add a sizeable calculator set |
| Flowchart fidelity | Reconciled with the v2.1 image; chart thresholds as defaults | The chart predates MyFutureFund and the Investment Account; revisit if a v3 chart appears |
| UK nations | rUK first, Scotland after phase 4 | Scottish bands differ; Wales currently mirrors rUK |
| Hosting | EU region (Dublin) | GDPR posture and latency for IE users |

## Sources

Ireland

- [KPMG: Budget 2027 tax rates and credits](https://kpmg.com/ie/en/insights/tax/budget-2027/tax-rates-and-credits.html)
- [Crowe: Budget 2027 highlights](https://www.crowe.com/ie/insights/budget-2027-highlights)
- [William Fry: Budget 2027 takeaways (CGT, fund rate)](https://www.williamfry.com/?p=163326)
- [RSM: Budget 2027 capital gains tax and Investment Account](https://www.rsm.global/ireland/node/768)
- [Grant Thornton: How Budget 2027 affects you](https://www.grantthornton.ie/insights/budget/how-budget-2027-affects-you-and-your-family/)
- [Irish Tax Hub: Budget 2027 what it means for you](https://www.irishtaxhub.ie/blog/budget-2027-what-it-means-for-you)
- [Raisin: Ireland Budget 2027](https://www.raisin.com/en-ie/press/ireland-budget-2027/)
- [Revenue: pension tax relief limits](https://revenue.ie/en/jobs-and-pensions/pension/relief/tax-relief-limits.aspx)
- [BrightPay: Auto-enrolment for employees](https://brightsg.com/en-ie/blog/auto-enrolment-in-ireland-what-it-means-for-employees/)
- [MTU: My Future Fund presentation](https://finance.mtu.ie/auto-enrolment)
- [etf.ie: ETF tax in Ireland](https://etf.ie/tax/)
- [An Post Money Manager](https://www.anpost.com/Money/Discover-your-App/Money-Manager)

UK

- [Deloitte: UK tax rates 2026/27](https://taxscape.deloitte.com/taxtables/deloitte-uk-tax-rates-2026-27.pdf)
- [NS&I: ISA allowances](https://www.nsandi.com/get-to-know-us/isa-allowances)
- [UK Tax Drag: Autumn Budget 2026 tracker](https://uktaxdrag.co.uk/autumn-budget-2026-tracker)
- [Richify: April 2027 ISA and pension changes](https://www.richify.ai/uk/autumn-budget-2026)
- [Crowe UK: voluntary NI abroad](https://www.crowe.com/uk/insights/changes-voluntary-national-insurance-abroad)
- [Moneyhub: app end of service](https://moneyhub.com/app-end-of-service-announcement)

Cross-border

- [Revenue: trans-border workers relief manual](https://revenue.ie:443/en/tax-professionals/tdm/income-tax-capital-gains-tax-corporation-tax/part-34/34-00-06.pdf)
- [Irish Tax Hub: foreign pensions in Ireland](https://www.irishtaxhub.ie/blog/taxation-of-foreign-pensions-in-ireland)
- [UK-Ireland tax treaty guide 2026](https://www.countrytaxcalc.com/tax-guides/uk-ireland-tax-treaty-guide-2026/)
- [Experts for Expats: Ireland-UK tax guide](https://www.expertsforexpats.com/advice/tax/ireland-uk-tax-guide-for-british-expats-in-ireland)

Bank data

- [Actual Budget: Enable Banking setup](https://actualbudget.org/docs/advanced/bank-sync/enable-banking)
- [GoCardless Bank Account Data sign-ups disabled](https://dev.to/johnfrandsen/gocardless-bank-account-data-alternatives-what-to-use-when-signups-are-disabled-326d)
- [Open Banking Tracker: aggregators in Ireland](https://openbankingtracker.com/api-aggregators?country=IE)
