import { formatMoney, sumMinor, usRetirementLimits, type UsPack } from "@cuntas/rules";
import type { EvalContext, MemberState, OptionCard, StepDefinition } from "../../types";
import { chartRef, fundBasisUsed, fullFundTarget, money, nonMortgageDebts, packRef, pct, starterFundTarget } from "../../helpers";

// US next steps, in the r/personalfinance order: budget, starter emergency fund, employer match,
// high-interest debt, full emergency fund, HSA, IRA, 401(k) to the limit, then other goals.
// Wording stays general: account types, never products or providers.

type Ctx = EvalContext<UsPack>;

const MONTHS = 12;
const usd = (minor: number) => formatMoney(minor, "USD", { decimals: false });
const us = (m: MemberState | undefined) => m?.us;

/** Share of a yearly limit due by now, so a check can be met before December. */
const pace = (ctx: Ctx, limitMinor: number) => Math.ceil((limitMinor * Number(ctx.snapshot.asOf.slice(5, 7))) / MONTHS);

const limitsFor = (ctx: Ctx) => {
  const u = us(ctx.member)!;
  return usRetirementLimits(ctx.pack, {
    age: ctx.member!.age,
    filingStatus: u.filingStatus,
    magiMinor: u.magiMinor,
    compensationMinor: u.grossAnnualMinor,
    coveredByWorkplacePlan: u.coveredByWorkplacePlan,
    spouseCoveredByWorkplacePlan: u.spouseCoveredByWorkplacePlan,
    hsaCoverage: u.hsaCoverage,
  });
};

const high = (ctx: Ctx) => nonMortgageDebts(ctx.snapshot).filter((d) => d.apr > ctx.snapshot.thresholds.highAprAbove);
const moderate = (ctx: Ctx) => nonMortgageDebts(ctx.snapshot).filter((d) => d.apr >= ctx.snapshot.thresholds.moderateAprFrom && d.apr <= ctx.snapshot.thresholds.highAprAbove);
const topApr = <T extends { apr: number }>(list: T[]) => [...list].sort((a, b) => b.apr - a.apr)[0];

const budget: StepDefinition<UsPack> = {
  id: "us.budget",
  order: 0,
  title: "Budget and track spending",
  chartRule: "Pay rent or mortgage, food, utilities, income-earning costs and minimum debt payments first.",
  jurisdictions: ["US"],
  scope: "household",
  checks: [
    {
      id: "us.budget.tracking",
      title: "Track your spending",
      isMet: ({ snapshot }) => snapshot.tracking.transactionsLast60Days > 0,
      progress: ({ snapshot }) => ({ current: Math.min(1, snapshot.tracking.transactionsLast60Days), target: 1, unit: "count" }),
      headline: "Start tracking where your money goes",
      explain: "Every step is measured from your real spending. Import a CSV or QFX file from your bank or card to begin.",
      vars: () => ({}),
      sources: (ctx) => [chartRef(ctx, "budget")],
      actions: [{ id: "import", label: "Import transactions", to: "/import" }],
    },
    {
      id: "us.budget.budget",
      title: "Set a budget for this month",
      isMet: ({ snapshot }) => snapshot.tracking.hasBudgetThisPeriod,
      progress: ({ snapshot }) => ({ current: snapshot.tracking.hasBudgetThisPeriod ? 1 : 0, target: 1, unit: "count" }),
      headline: "Set a budget for this pay period",
      explain: "A budget gives every dollar of take-home pay a job, essentials first.",
      vars: () => ({}),
      sources: (ctx) => [chartRef(ctx, "budget")],
      actions: [{ id: "budget", label: "Create budget", to: "/budgets" }],
    },
    {
      id: "us.budget.essentials",
      title: "Cover essentials from pay",
      isMet: ({ snapshot }) => snapshot.waterfall.firstShortBucket === null,
      progress: ({ snapshot }) => ({ current: snapshot.waterfall.bucketsCovered, target: snapshot.waterfall.buckets, unit: "count" }),
      headline: "Your pay falls {shortfall} short at: {bucket}",
      explain: "Essentials come first: housing, food, utilities, getting to work and minimum debt payments. The first one left short is {bucket}. Cut or switch non-essential bills before anything else.",
      vars: (ctx) => ({ bucket: ctx.snapshot.waterfall.firstShortBucket ?? "", shortfall: money(ctx, ctx.snapshot.waterfall.shortfallMinor) }),
      sources: (ctx) => [chartRef(ctx, "budget")],
      actions: [{ id: "waterfall", label: "Open payday waterfall", to: "/budgets" }],
    },
    {
      id: "us.budget.estimated-tax",
      title: "Set aside estimated tax on self-employment income",
      appliesWhen: ({ snapshot }) => (snapshot.selfEmployedTax?.monthlySetAsideMinor ?? 0) > 0,
      isMet: ({ snapshot }) => snapshot.selfEmployedTax!.plannedMonthlyMinor >= snapshot.selfEmployedTax!.monthlySetAsideMinor,
      progress: ({ snapshot }) => ({ current: snapshot.selfEmployedTax!.plannedMonthlyMinor, target: snapshot.selfEmployedTax!.monthlySetAsideMinor, unit: snapshot.currency }),
      headline: "Set aside {amount} a month for estimated tax",
      explain:
        "No tax is withheld from self-employment income, so federal income tax and self-employment tax are paid in four estimated payments; the next is due {deadline}. " +
        "Paying at least 90% of this year's tax, or 100% of last year's, avoids the underpayment penalty. State tax isn't included.",
      vars: (ctx) => ({ amount: money(ctx, ctx.snapshot.selfEmployedTax!.monthlySetAsideMinor), deadline: ctx.snapshot.selfEmployedTax!.nextDeadline }),
      sources: (ctx) => [chartRef(ctx, "budget"), packRef(ctx, "estimatedTax", ctx.pack.estimatedTax.source)],
      actions: [
        { id: "tax", label: "Open estimated tax", to: "/tax" },
        { id: "goal", label: "Add a tax set-aside goal", to: "/goals" },
      ],
      deadline: (ctx) => ctx.snapshot.selfEmployedTax?.nextDeadline,
    },
  ],
};

const starterFund: StepDefinition<UsPack> = {
  id: "us.starter-fund",
  order: 1,
  title: "Build a starter emergency fund",
  chartRule: "The greater of $1,000 or one month of expenses, in cash.",
  jurisdictions: ["US"],
  scope: "household",
  checks: [
    {
      id: "us.starter-fund",
      title: "Starter emergency fund",
      isMet: ({ snapshot }) => snapshot.liquidSavingsMinor >= starterFundTarget(snapshot),
      progress: ({ snapshot }) => ({ current: snapshot.liquidSavingsMinor, target: starterFundTarget(snapshot), unit: snapshot.currency }),
      headline: "Save {gap} more for a starter emergency fund",
      explain: "The starter fund is the greater of {floor} or {months} month of {basis} ({target}), kept in a checking or savings account. You have {saved}.",
      vars: (ctx) => {
        const s = ctx.snapshot;
        const target = starterFundTarget(s);
        return {
          gap: money(ctx, Math.max(0, target - s.liquidSavingsMinor)),
          floor: money(ctx, s.thresholds.starterFundFloorMinor),
          months: s.thresholds.starterFundMonths,
          basis: fundBasisUsed(s) === "netPay" ? "take-home pay" : "essential spending",
          target: money(ctx, target),
          saved: money(ctx, s.liquidSavingsMinor),
        };
      },
      sources: (ctx) => [chartRef(ctx, "starterFund")],
      actions: [{ id: "goal", label: "Set up emergency fund goal", to: "/goals" }],
    },
  ],
};

const employerMatch: StepDefinition<UsPack> = {
  id: "us.employer-match",
  order: 2,
  title: "Get the full employer match",
  chartRule: "Contribute enough to a workplace plan such as a 401(k) to get the whole match.",
  jurisdictions: ["US"],
  scope: "member",
  alwaysOn: true,
  appliesWhen: ({ member }) => !!us(member) && member!.pension.hasEmployerScheme && member!.pension.matchRatio > 0,
  checks: [
    {
      id: "us.employer-match",
      title: "Full employer match",
      isMet: ({ member }) => member!.pension.employeeRate >= member!.pension.fullMatchEmployeeRate,
      progress: ({ member }) => ({ current: member!.pension.employeeRate * 100, target: member!.pension.fullMatchEmployeeRate * 100, unit: "%" }),
      headline: "{name}: contribute {rate} to get the full employer match",
      explain: "Your employer matches {ratio} of what you put in, up to {rate} of pay. You put in {current}, leaving {missed} a year of match unclaimed.",
      vars: ({ member }) => {
        const m = member!;
        const u = us(m)!;
        return {
          name: m.name,
          rate: pct(m.pension.fullMatchEmployeeRate),
          ratio: pct(m.pension.matchRatio),
          current: pct(m.pension.employeeRate),
          missed: usd(Math.round(u.grossAnnualMinor * (m.pension.fullMatchEmployeeRate - m.pension.employeeRate) * m.pension.matchRatio)),
        };
      },
      sources: (ctx) => [chartRef(ctx, "employerMatch")],
      actions: [{ id: "pensions", label: "Review workplace plan", to: "/pensions" }],
    },
  ],
};

const debt: StepDefinition<UsPack> = {
  id: "us.debt",
  order: 3,
  title: "Pay off high-interest debt, then fill the emergency fund",
  chartRule: "Clear debt above 10% APR; then build the emergency fund to 3-6 months of expenses.",
  jurisdictions: ["US"],
  scope: "household",
  checks: [
    {
      id: "us.debt.high-interest",
      title: "Clear high-interest debt",
      isMet: (ctx) => high(ctx).length === 0,
      progress: (ctx) => ({ current: sumMinor(high(ctx).map((d) => d.balanceMinor)), target: 0, unit: ctx.snapshot.currency }),
      headline: "Pay off {total} of high-interest debt (above {threshold})",
      explain: "Debt above {threshold} costs more than investing reliably earns. Highest rate first: {first} at {firstApr}. Keep paying the minimum on everything else.",
      vars: (ctx) => {
        const first = topApr(high(ctx));
        return { total: money(ctx, sumMinor(high(ctx).map((d) => d.balanceMinor))), threshold: pct(ctx.snapshot.thresholds.highAprAbove), first: first?.name ?? "", firstApr: first ? pct(first.apr) : "" };
      },
      sources: (ctx) => [chartRef(ctx, "debt.highAprAbove")],
      actions: [{ id: "planner", label: "Open payoff planner", to: "/debts" }],
    },
    {
      id: "us.debt.full-fund",
      title: "Full emergency fund",
      isMet: ({ snapshot }) => snapshot.liquidSavingsMinor >= fullFundTarget(snapshot).targetMinor,
      progress: ({ snapshot }) => ({ current: snapshot.liquidSavingsMinor, target: fullFundTarget(snapshot).targetMinor, unit: snapshot.currency }),
      headline: "Grow your emergency fund to {target}",
      explain: "With high-interest debt gone, the fund grows to {months} months of {basis}. {reason} You have {saved}.",
      vars: (ctx) => {
        const s = ctx.snapshot;
        const f = fullFundTarget(s);
        return {
          target: money(ctx, f.targetMinor),
          months: f.months,
          basis: fundBasisUsed(s) === "netPay" ? "take-home pay" : "essential spending",
          reason: f.months === s.thresholds.fullFundMonthsHigh ? "Single-income and self-employed households use the upper end." : "Two-income households use the lower end.",
          saved: money(ctx, s.liquidSavingsMinor),
        };
      },
      sources: (ctx) => [chartRef(ctx, "fullFund")],
      actions: [{ id: "goal", label: "Update emergency fund goal", to: "/goals" }],
    },
  ],
};

const hsa: StepDefinition<UsPack> = {
  id: "us.hsa",
  order: 4,
  title: "Fund an HSA",
  chartRule: "With an HSA-eligible health plan, contribute to a health savings account.",
  jurisdictions: ["US"],
  scope: "member",
  appliesWhen: ({ member }) => !!us(member)?.hsaCoverage,
  checks: [
    {
      id: "us.hsa",
      title: "HSA on pace for the year's limit",
      isMet: (ctx) => us(ctx.member)!.hsaContribYtdMinor >= pace(ctx, limitsFor(ctx).hsaMinor!),
      progress: (ctx) => ({ current: us(ctx.member)!.hsaContribYtdMinor, target: limitsFor(ctx).hsaMinor!, unit: "USD" }),
      headline: "{name}: put {due} more into your HSA to keep pace",
      explain:
        "HSA contributions come off income tax (and FICA when made through payroll), growth is untaxed, and withdrawals for medical costs are tax-free. " +
        "This year's limit for your coverage is {limit}; {paid} is in so far.",
      vars: (ctx) => {
        const u = us(ctx.member)!;
        const limit = limitsFor(ctx).hsaMinor!;
        return { name: ctx.member!.name, limit: usd(limit), paid: usd(u.hsaContribYtdMinor), due: usd(Math.max(0, pace(ctx, limit) - u.hsaContribYtdMinor)) };
      },
      sources: (ctx) => [packRef(ctx, "hsa", ctx.pack.hsa.source), chartRef(ctx, "hsa")],
      actions: [{ id: "pensions", label: "Record HSA contributions", to: "/pensions" }],
    },
  ],
};

const ira: StepDefinition<UsPack> = {
  id: "us.ira",
  order: 5,
  title: "Contribute to an IRA",
  chartRule: "Contribute to a Roth or traditional IRA up to the year's limit.",
  jurisdictions: ["US"],
  scope: "member",
  appliesWhen: ({ member }) => !!us(member) && us(member)!.grossAnnualMinor > 0,
  checks: [
    {
      id: "us.ira",
      title: "IRA on pace for the year's limit",
      isMet: (ctx) => us(ctx.member)!.iraContribYtdMinor >= pace(ctx, limitsFor(ctx).iraMinor),
      progress: (ctx) => ({ current: us(ctx.member)!.iraContribYtdMinor, target: limitsFor(ctx).iraMinor, unit: "USD" }),
      headline: "{name}: put {due} more into an IRA to keep pace",
      explain: "This year's IRA limit is {limit} across all your IRAs; {paid} is in so far. {roth} {deduction}",
      vars: (ctx) => {
        const u = us(ctx.member)!;
        const l = limitsFor(ctx);
        const roth =
          l.rothIraMinor === 0
            ? "Your income is above the Roth IRA limit, so direct Roth contributions aren't allowed."
            : l.rothIraMinor < l.iraMinor
              ? `Your income is in the Roth IRA phase-out: up to ${usd(l.rothIraMinor)} can go to a Roth IRA.`
              : "A Roth IRA takes after-tax money and pays out tax-free in retirement.";
        const deduction =
          l.traditionalIraDeductibleMinor === 0
            ? "With a workplace plan at this income, traditional IRA contributions aren't deductible."
            : l.traditionalIraDeductibleMinor < l.iraMinor
              ? `Up to ${usd(l.traditionalIraDeductibleMinor)} of a traditional IRA contribution is deductible.`
              : "A traditional IRA contribution is deductible now and taxed when withdrawn.";
        return { name: ctx.member!.name, limit: usd(l.iraMinor), paid: usd(u.iraContribYtdMinor), due: usd(Math.max(0, pace(ctx, l.iraMinor) - u.iraContribYtdMinor)), roth, deduction };
      },
      sources: (ctx) => [packRef(ctx, "retirement", ctx.pack.retirement.source), chartRef(ctx, "ira")],
      actions: [{ id: "pensions", label: "Record IRA contributions", to: "/pensions" }],
    },
  ],
};

const max401k: StepDefinition<UsPack> = {
  id: "us.401k",
  order: 6,
  title: "Raise 401(k) contributions to the limit",
  chartRule: "Contribute to a workplace plan up to the year's employee limit.",
  jurisdictions: ["US"],
  scope: "member",
  appliesWhen: ({ member }) => !!us(member) && member!.pension.hasEmployerScheme,
  checks: [
    {
      id: "us.401k",
      title: "401(k) at the year's limit",
      isMet: (ctx) => us(ctx.member)!.employeeDeferralMinor >= limitsFor(ctx).employeeDeferralMinor,
      progress: (ctx) => ({ current: us(ctx.member)!.employeeDeferralMinor, target: limitsFor(ctx).employeeDeferralMinor, unit: "USD" }),
      headline: "{name}: raise 401(k) contributions toward {limit} a year",
      explain: "At your current rate you'll put in {current} this year, against an employee limit of {limit}{catchUp}. Traditional contributions lower income tax now; Roth contributions are taxed now and tax-free later.",
      vars: (ctx) => {
        const l = limitsFor(ctx);
        return {
          name: ctx.member!.name,
          limit: usd(l.employeeDeferralMinor),
          current: usd(us(ctx.member)!.employeeDeferralMinor),
          catchUp: l.catchUpMinor > 0 ? ` (including a ${usd(l.catchUpMinor)} catch-up for your age)` : "",
        };
      },
      sources: (ctx) => [packRef(ctx, "retirement.employeeDeferral", ctx.pack.retirement.source), chartRef(ctx, "401k")],
      actions: [{ id: "pensions", label: "Review workplace plan", to: "/pensions" }],
    },
  ],
};

const goals: StepDefinition<UsPack> = {
  id: "us.goals",
  order: 7,
  title: "Moderate debt and other goals",
  chartRule: "Pay down moderate-interest debt (4-10%), fund near goals in savings and far ones by investing.",
  jurisdictions: ["US"],
  scope: "household",
  checks: [
    {
      id: "us.goals.moderate-debt",
      title: "Clear moderate-interest debt",
      isMet: (ctx) => moderate(ctx).length === 0,
      progress: (ctx) => ({ current: sumMinor(moderate(ctx).map((d) => d.balanceMinor)), target: 0, unit: ctx.snapshot.currency }),
      headline: "Pay down {total} of moderate-interest debt ({from} to {to})",
      explain: "With retirement accounts funded, debt between {from} and {to} is next. Highest rate first: {first}.",
      vars: (ctx) => ({
        total: money(ctx, sumMinor(moderate(ctx).map((d) => d.balanceMinor))),
        from: pct(ctx.snapshot.thresholds.moderateAprFrom),
        to: pct(ctx.snapshot.thresholds.highAprAbove),
        first: topApr(moderate(ctx))?.name ?? "",
      }),
      sources: (ctx) => [chartRef(ctx, "debt.moderateAprFrom")],
      actions: [{ id: "planner", label: "Open payoff planner", to: "/debts" }],
    },
    {
      id: "us.goals.sinking-funds",
      title: "Sinking funds on track",
      isMet: ({ snapshot }) => snapshot.sinkingFunds.every((f) => f.savedMinor >= f.targetMinor || f.monthlyContributionMinor > 0),
      progress: ({ snapshot }) => ({ current: snapshot.sinkingFunds.filter((f) => f.savedMinor >= f.targetMinor || f.monthlyContributionMinor > 0).length, target: snapshot.sinkingFunds.length, unit: "count" }),
      headline: "Start saving for {name}",
      explain: "{name} needs {target} by {due} and nothing is going into it yet.",
      vars: (ctx) => {
        const f = ctx.snapshot.sinkingFunds.find((x) => x.savedMinor < x.targetMinor && x.monthlyContributionMinor === 0);
        return { name: f?.name ?? "", target: f ? money(ctx, f.targetMinor) : "", due: f?.dueDate ?? "" };
      },
      sources: (ctx) => [chartRef(ctx, "goals")],
      actions: [{ id: "goals", label: "Adjust goals", to: "/goals" }],
    },
  ],
};

export const US_STEPS: StepDefinition<UsPack>[] = [budget, starterFund, employerMatch, debt, hsa, ira, max401k, goals];

/** Options once every step is met. */
export function usOptions(ctx: Ctx): OptionCard[] {
  const s = ctx.snapshot;
  const out: OptionCard[] = [
    { id: "discretionary", title: "More discretionary spending", detail: "Every earlier step is met, so spending more on what you value is a valid choice." },
    {
      id: "taxable-investing",
      title: "Savings for near goals, investing for far ones",
      detail: `For goals within ${ctx.chart.goals.savingsHorizonYears} years, high-yield savings; beyond that, a taxable brokerage account. A 529 plan is the usual account for a child's college costs.`,
    },
  ];
  if (s.housing.ownsHome && s.housing.mortgageMonthlyPaymentMinor) {
    out.push({ id: "overpay-mortgage", title: "Pay extra on the mortgage", detail: "Compare the mortgage rate with what investing is likely to earn after tax." });
  }
  return out;
}
