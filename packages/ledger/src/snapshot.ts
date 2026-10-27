import {
  addDays,
  ageOn,
  applyRate,
  chartDefaults,
  deadlineFor,
  iePayroll,
  ieSelfAssessment,
  MONTHS_PER_YEAR,
  myFutureFundStatus,
  COUNTRY_INFO,
  packOn,
  statePackFor,
  ukPayroll,
  usPayroll,
  type UsEarner,
  type ChartDefaults,
  type IePack,
  type Currency,
  type IsoDate,
  type Jurisdiction,
} from "@cuntas/rules";
import { defaultThresholds, type HouseholdSnapshot, type MemberState, type Thresholds, type UsMemberState } from "@cuntas/engine";
import { balancesByAccount } from "./balances";
import { periodOf, periodRange } from "./budgets";
import { FxTable } from "./fx";
import { goalProgress } from "./goals";
import type { Dataset, Member } from "./schema";
import { essentialSpend } from "./estimate";
import { categoryMap, isCashflow, totalsByCategory } from "./spending";
import { paydayWaterfall, ESSENTIAL_BUCKETS } from "./waterfall";

/** How recent a transaction must be for the household to count as tracking. */
const TRACKING_DAYS = 60;

export function residenceOn(ds: Dataset, memberId: string, date: IsoDate): Jurisdiction {
  const p = ds.residencePeriods.find((r) => r.memberId === memberId && r.from <= date && (r.to === null || r.to >= date));
  return p?.jurisdiction ?? "IE";
}

export interface MemberPay {
  netAnnualMinor: number;
  marginalRate: number;
  currency: Currency;
  pack: string;
}

/** Take-home pay for a member under their residence's rules, in that jurisdiction's currency. */
export function memberPay(ds: Dataset, m: Member, asOf: IsoDate): MemberPay {
  const residence = residenceOn(ds, m.id, asOf);
  const age = ageOn(m.dateOfBirth, asOf);
  if (m.grossAnnualMinor <= 0 || m.employmentType === "notWorking") {
    return { netAnnualMinor: 0, marginalRate: 0, currency: COUNTRY_INFO[residence].currency, pack: "" };
  }
  if (residence === "US") return usMemberPay(ds, m, asOf);
  if (residence === "UK") {
    const pack = packOn("UK", asOf);
    const r = ukPayroll(pack, { grossAnnualMinor: m.grossAnnualMinor, region: m.ukRegion, studentLoans: m.studentLoans });
    return { netAnnualMinor: r.netAnnualMinor, marginalRate: r.marginalRate, currency: "GBP", pack: pack.version };
  }
  const pack = packOn("IE", asOf);
  const plans = ds.pensionPlans.filter((p) => p.memberId === m.id && p.isEmployerScheme);
  const employeeRate = plans.reduce((a, p) => a + p.employeeRate, 0);
  const spouse = ds.members.find((x) => x.id !== m.id);
  const mff = myFutureFundStatus(pack, { age, grossAnnualMinor: m.grossAnnualMinor, inQualifyingScheme: plans.length > 0, optedOut: m.myFutureFundOptedOut });
  const r = iePayroll(pack, {
    grossAnnualMinor: m.grossAnnualMinor,
    frequency: m.payFrequency,
    assessment: m.assessment,
    ...(m.assessment === "marriedTwoIncomes" && spouse ? { spouseGrossAnnualMinor: spouse.grossAnnualMinor } : {}),
    employment: m.employmentType === "selfEmployed" ? "selfEmployed" : "employee",
    age,
    pensionEmployeeMinor: applyRate(m.grossAnnualMinor, employeeRate),
    myFutureFund: mff === "auto-enrolled",
  });
  return { netAnnualMinor: r.netAnnualMinor, marginalRate: r.marginalRate, currency: "EUR", pack: pack.version };
}

/** US federal take-home and the return's figures. A joint return includes a spouse who also lives in the US; children are claimed on joint and head-of-household returns. */
function usPayDetail(ds: Dataset, m: Member, asOf: IsoDate) {
  const pack = packOn("US", asOf);
  const plansOf = (x: Member) => ds.pensionPlans.filter((p) => p.memberId === x.id && p.isEmployerScheme && p.jurisdiction === "US");
  const earner = (x: Member): UsEarner => ({
    grossAnnualMinor: x.employmentType === "notWorking" || x.employmentType === "retired" ? 0 : x.grossAnnualMinor,
    employment: x.employmentType === "selfEmployed" ? "selfEmployed" : "employee",
    age: ageOn(x.dateOfBirth, asOf),
    pretax401kMinor: applyRate(x.grossAnnualMinor, plansOf(x).reduce((a, p) => a + p.employeeRate, 0)),
  });
  const status = m.usFilingStatus;
  const spouse = status === "marriedJoint" ? ds.members.find((x) => x.id !== m.id && residenceOn(ds, x.id, asOf) === "US") : undefined;
  const self = earner(m);
  const state = m.usState ? statePackFor(m.usState, pack.taxYear)?.pack : undefined;
  const r = usPayroll(pack, {
    ...self,
    ...(state ? { state, locality: m.usLocality, rentPaidMinor: rentOnReturn(ds, m, asOf) } : {}),
    filingStatus: status,
    ...(spouse ? { spouse: earner(spouse) } : {}),
    children: status === "marriedJoint" || status === "headOfHousehold" ? ds.household.settings.children : 0,
  });
  return {
    pack,
    pay: { netAnnualMinor: r.netAnnualMinor, marginalRate: r.marginalRate, currency: "USD", pack: pack.version } satisfies MemberPay,
    agiMinor: r.agiMinor,
    deferralMinor: self.pretax401kMinor ?? 0,
    covered: plansOf(m).length > 0,
    spouseCovered: !!spouse && plansOf(spouse).length > 0,
    /** Federal income tax and self-employment tax for the year, less refundable credits. */
    expectedTaxMinor: r.incomeTaxMinor + r.selfEmploymentTaxMinor - r.refundableCreditMinor,
  };
}

/**
 * Rent counts once: on a joint return, or on the first US member's return otherwise. Rent is the
 * household's monthly rent setting, when it's held in dollars.
 */
function rentOnReturn(ds: Dataset, m: Member, asOf: IsoDate): number {
  const s = ds.household.settings;
  if (s.ownsHome || ds.household.baseCurrency !== "USD") return 0;
  const firstUs = ds.members.find((x) => residenceOn(ds, x.id, asOf) === "US");
  return m.usFilingStatus === "marriedJoint" || firstUs?.id === m.id ? s.monthlyRentMinor * MONTHS_PER_YEAR : 0;
}

function usMemberPay(ds: Dataset, m: Member, asOf: IsoDate): MemberPay {
  return usPayDetail(ds, m, asOf).pay;
}

/** The figures the US ladder needs, in dollars. */
function usMemberState(ds: Dataset, m: Member, asOf: IsoDate): UsMemberState {
  const d = usPayDetail(ds, m, asOf);
  const yearStart = `${asOf.slice(0, 4)}-01-01`;
  const ytd = (kinds: readonly string[]) =>
    ds.contributions
      .filter((c) => c.date >= yearStart && c.date <= asOf && ds.pensionPlans.some((p) => p.id === c.pensionPlanId && p.memberId === m.id && kinds.includes(p.kind)))
      .reduce((a, c) => a + c.employeeMinor, 0);
  return {
    filingStatus: m.usFilingStatus,
    grossAnnualMinor: m.employmentType === "notWorking" || m.employmentType === "retired" ? 0 : m.grossAnnualMinor,
    magiMinor: d.agiMinor,
    coveredByWorkplacePlan: d.covered,
    spouseCoveredByWorkplacePlan: d.spouseCovered,
    employeeDeferralMinor: d.deferralMinor,
    iraContribYtdMinor: ytd(["usIRA", "usRothIRA"]),
    hsaCoverage: m.usHsaCoverage === "none" ? null : m.usHsaCoverage,
    hsaContribYtdMinor: ytd(["usHSA"]),
  };
}

/** The US ladder applies when everyone in the household lives in the US. */
export function planFor(ds: Dataset, asOf: IsoDate): "IE" | "US" {
  return ds.members.length > 0 && ds.members.every((m) => residenceOn(ds, m.id, asOf) === "US") ? "US" : "IE";
}

function memberState(ds: Dataset, m: Member, asOf: IsoDate, pack: IePack, fx: FxTable): MemberState {
  const age = ageOn(m.dateOfBirth, asOf);
  const residence = residenceOn(ds, m.id, asOf);
  const pay = memberPay(ds, m, asOf);
  const base = ds.household.baseCurrency;
  const employer = ds.pensionPlans.filter((p) => p.memberId === m.id && p.isEmployerScheme);
  const match = employer.find((p) => p.employerMatchRule)?.employerMatchRule ?? null;
  const mff = myFutureFundStatus(pack, { age, grossAnnualMinor: m.grossAnnualMinor, inQualifyingScheme: employer.length > 0, optedOut: m.myFutureFundOptedOut });
  const mffOn = residence === "IE" && mff === "auto-enrolled";
  const employeeRate = employer.reduce((a, p) => a + p.employeeRate, 0) + (mffOn ? pack.myFutureFund.rates.employee : 0);
  const employerRate = employer.reduce((a, p) => a + p.employerRate, 0) + (mffOn ? pack.myFutureFund.rates.employer : 0);
  const yearStart = `${asOf.slice(0, 4)}-01-01`;
  const personalYtd = ds.contributions
    .filter((c) => c.date >= yearStart && c.date <= asOf && ds.pensionPlans.some((p) => p.id === c.pensionPlanId && p.memberId === m.id && p.kind !== "MyFutureFund"))
    .reduce((a, c) => a + c.employeeMinor, 0);
  const netMonthly = Math.round(pay.netAnnualMinor / MONTHS_PER_YEAR);
  return {
    id: m.id,
    name: m.name,
    age,
    employment: m.employmentType,
    residence,
    grossAnnualMinor: fx.tryConvert(m.grossAnnualMinor, pay.currency, base, asOf) ?? m.grossAnnualMinor,
    netMonthlyMinor: fx.tryConvert(netMonthly, pay.currency, base, asOf) ?? netMonthly,
    marginalRate: pay.marginalRate,
    pension: {
      hasEmployerScheme: employer.length > 0,
      employeeRate,
      employerRate,
      fullMatchEmployeeRate: match?.upToRate ?? 0,
      matchRatio: match?.ratio ?? 0,
      personalContribYtdMinor: personalYtd,
      myFutureFund: mff,
    },
    ...(m.stockMatch ? { stockMatch: m.stockMatch } : {}),
    ...(residence === "US" ? { us: usMemberState(ds, m, asOf) } : {}),
  };
}

export function thresholdsFor(ds: Dataset, chart: ChartDefaults): Thresholds {
  const t = { ...defaultThresholds(chart), fundBasis: ds.household.settings.fundBasis } as Thresholds;
  for (const [k, v] of Object.entries(ds.household.settings.thresholdOverrides)) {
    if (k in t && typeof (t as unknown as Record<string, unknown>)[k] === "number") (t as unknown as Record<string, number>)[k] = v;
  }
  return t;
}

/** Builds the engine's household snapshot from the dataset. */
export function buildSnapshot(ds: Dataset, asOf: IsoDate, chart?: ChartDefaults): HouseholdSnapshot {
  const plan = planFor(ds, asOf);
  chart ??= chartDefaults(plan);
  const fx = new FxTable(ds.fxRates);
  const pack = packOn("IE", asOf);
  const base = ds.household.baseCurrency;
  const s = ds.household.settings;
  const members = ds.members.map((m) => memberState(ds, m, asOf, pack, fx));
  const balances = balancesByAccount(ds, asOf);

  const flagged = ds.accounts.filter((a) => a.isEmergencyFund && !a.archived);
  const liquidAccounts = flagged.length > 0 ? flagged : ds.accounts.filter((a) => !a.archived && (a.type === "savings" || a.type === "cash"));
  const liquid = liquidAccounts.reduce((sum, a) => sum + Math.max(0, fx.tryConvert(balances.get(a.id) ?? 0, a.currency, base, asOf) ?? 0), 0);

  const debts = ds.debts.map((d) => {
    const linked = d.accountId ? ds.accounts.find((a) => a.id === d.accountId) : undefined;
    const balance = linked ? Math.abs(balances.get(linked.id) ?? 0) : d.balanceMinor;
    return {
      id: d.id,
      name: d.name,
      balanceMinor: fx.tryConvert(balance, d.currency, base, asOf) ?? balance,
      apr: d.aprBps / 10_000,
      minPaymentMinor: fx.tryConvert(d.minPaymentMinor, d.currency, base, asOf) ?? d.minPaymentMinor,
      kind: d.kind,
    };
  });

  const cats = categoryMap(ds);
  // A statement counts as tracking while it covers any of the last 60 days, so last month's file imported late still does.
  const recent = ds.transactions.filter((t) => t.bookedAt > addDays(asOf, -TRACKING_DAYS) && t.bookedAt <= asOf);
  const period = periodOf(asOf, s.paydayDayOfMonth);
  const hasBudget = ds.budgets.some((b) => b.period === period);

  // Waterfall: this period's budget lines if any, else last month's essential spending, per bucket.
  const netMonthlyPay = members.reduce((a, m) => a + m.netMonthlyMinor, 0);
  const needs: Record<string, number> = {};
  const budget = ds.budgets.find((b) => b.period === period);
  const essential = essentialSpend(ds, asOf, MONTHS_PER_YEAR, fx);
  if (budget) {
    for (const l of budget.lines) {
      const w = cats.get(l.categoryId)?.waterfall;
      if (w) needs[w] = (needs[w] ?? 0) + l.amountMinor;
    }
  } else if (essential.source === "estimate") {
    for (const l of ds.household.spendingEstimate!.lines) {
      const w = cats.get(l.categoryId)?.waterfall;
      if (w) needs[w] = (needs[w] ?? 0) + l.amountMinor;
    }
  } else {
    const { start, end } = periodRange(periodOf(addDays(periodRange(period, s.paydayDayOfMonth).start, -1), s.paydayDayOfMonth), s.paydayDayOfMonth);
    for (const [id, t] of totalsByCategory(ds, start, end, fx)) {
      const w = id ? cats.get(id)?.waterfall : undefined;
      if (w) needs[w] = (needs[w] ?? 0) + Math.max(0, t.spentMinor);
    }
  }
  needs.minimumDebt = Math.max(needs.minimumDebt ?? 0, debts.reduce((a, d) => a + (d.balanceMinor > 0 ? d.minPaymentMinor : 0), 0));
  const wf = paydayWaterfall(netMonthlyPay, needs);
  const essentialAllocs = wf.allocations.filter((a) => ESSENTIAL_BUCKETS.includes(a.bucket));
  const firstShort = essentialAllocs.find((a) => a.shortMinor > 0);

  const sinkingFunds = ds.goals
    .filter((g) => g.type === "sinkingFund" && g.targetDate)
    .map((g) => {
      const p = goalProgress(ds, g, asOf, fx);
      return { id: g.id, name: g.name, targetMinor: g.targetMinor, savedMinor: p.savedMinor, dueDate: g.targetDate!, monthlyContributionMinor: g.monthlyContributionMinor };
    });
  const deposit = ds.goals.find((g) => g.type === "houseDeposit");
  const college = ds.goals.filter((g) => g.type === "college");
  const mortgage = ds.debts.find((d) => d.kind === "mortgage");

  return {
    asOf,
    plan,
    currency: base,
    members,
    netMonthlyPayMinor: netMonthlyPay,
    liquidSavingsMinor: liquid,
    essentialMonthlySpendMinor: essential.monthlyMinor,
    tracking: {
      hasBudgetThisPeriod: hasBudget,
      transactionsLast60Days: recent.length,
      uncategorisedLast60Days: recent.filter((t) => t.categoryId === null && isCashflow(t, cats)).length,
    },
    waterfall: {
      firstShortBucket: firstShort?.label ?? null,
      shortfallMinor: firstShort?.shortMinor ?? 0,
      buckets: essentialAllocs.length,
      bucketsCovered: essentialAllocs.filter((a) => a.shortMinor === 0).length,
    },
    debts,
    sinkingFunds,
    housing: {
      ownsHome: s.ownsHome,
      monthlyRentMinor: s.ownsHome ? 0 : s.monthlyRentMinor,
      monthlyDepositSavingMinor: deposit?.monthlyContributionMinor ?? 0,
      expectedMortgagePaymentMinor: s.expectedMortgagePaymentMinor,
      mortgageMonthlyPaymentMinor: mortgage ? mortgage.minPaymentMinor : null,
    },
    children: {
      count: s.children,
      collegeGoals: college.length,
      collegeFundsOnTrack: college.every((g) => goalProgress(ds, g, asOf, fx).onTrack),
    },
    dismissed: ds.stepStates
      .filter((x) => x.status === "dismissed")
      .map((x) => ({ stepId: x.stepId, reason: x.dismissedReason ?? "", ...(x.memberId ? { memberId: x.memberId } : {}) })),
    thresholds: thresholdsFor(ds, chart),
    ...(plan === "US" ? usEstimatedTaxSetAside(ds, asOf, fx) : selfEmployedTax(ds, asOf, pack, fx)),
  };
}

/** Monthly set-aside for US self-employed members: this year's federal and self-employment tax over twelve months, against tax set-aside goals. */
function usEstimatedTaxSetAside(ds: Dataset, asOf: IsoDate, fx: FxTable): Pick<HouseholdSnapshot, "selfEmployedTax"> {
  const selfEmployed = ds.members.filter((m) => m.employmentType === "selfEmployed" && m.grossAnnualMinor > 0 && residenceOn(ds, m.id, asOf) === "US");
  if (selfEmployed.length === 0) return {};
  const base = ds.household.baseCurrency;
  const details = selfEmployed.map((m) => usPayDetail(ds, m, asOf));
  const yearly = details.reduce((a, d) => a + Math.max(0, d.expectedTaxMinor), 0);
  const monthly = Math.ceil(yearly / MONTHS_PER_YEAR);
  const pack = details[0]!.pack;
  const year = Number(asOf.slice(0, 4));
  const dates = [...pack.estimatedTax.dueDates.map((d) => deadlineFor(year, d)), ...pack.estimatedTax.dueDates.map((d) => deadlineFor(year + 1, d))].sort();
  const nextDeadline = dates.find((d) => d >= asOf)!;
  const planned = ds.goals.filter((g) => g.type === "taxSetAside").reduce((a, g) => a + (fx.tryConvert(g.monthlyContributionMinor, g.currency, base, asOf) ?? 0), 0);
  return { selfEmployedTax: { monthlySetAsideMinor: fx.tryConvert(monthly, "USD", base, asOf) ?? monthly, plannedMonthlyMinor: planned, nextDeadline } };
}

/** Monthly set-aside for Irish self-employed members, against what tax set-aside goals put by. */
function selfEmployedTax(ds: Dataset, asOf: IsoDate, pack: IePack, fx: FxTable): Pick<HouseholdSnapshot, "selfEmployedTax"> {
  const selfEmployed = ds.members.filter((m) => m.employmentType === "selfEmployed" && m.grossAnnualMinor > 0 && residenceOn(ds, m.id, asOf) === "IE");
  if (selfEmployed.length === 0 || !pack.selfAssessment) return {};
  const base = ds.household.baseCurrency;
  const monthly = selfEmployed.reduce((sum, m) => {
    const r = ieSelfAssessment(pack, {
      tradingProfitMinor: m.grossAnnualMinor,
      payeIncomeMinor: m.selfAssessment.payeIncomeMinor,
      payeDeductedMinor: m.selfAssessment.payeDeductedMinor,
      assessment: m.assessment,
      age: ageOn(m.dateOfBirth, asOf),
    });
    return sum + r.setAsideMonthlyMinor;
  }, 0);
  const planned = ds.goals.filter((g) => g.type === "taxSetAside").reduce((a, g) => a + (fx.tryConvert(g.monthlyContributionMinor, g.currency, base, asOf) ?? 0), 0);
  const year = Number(asOf.slice(0, 4));
  const thisYear = deadlineFor(year, pack.selfAssessment.preliminaryDue);
  const nextDeadline = thisYear >= asOf ? thisYear : deadlineFor(year + 1, pack.selfAssessment.preliminaryDue);
  return { selfEmployedTax: { monthlySetAsideMinor: fx.tryConvert(monthly, "EUR", base, asOf) ?? monthly, plannedMonthlyMinor: planned, nextDeadline } };
}
