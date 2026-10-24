import type { StepDefinition } from "../../types";
import { chartRef, money, packRef } from "../../helpers";

export const trackBudget: StepDefinition = {
  id: "ie.track-budget",
  order: 0,
  title: "Track expenses, budget, set goals",
  chartRule: "Pay housing, food, essential bills, income-earning costs and minimum debt payments in that order.",
  jurisdictions: ["IE", "UK"],
  scope: "household",
  checks: [
    {
      id: "ie.track-budget.tracking",
      title: "Track your spending",
      isMet: ({ snapshot }) => snapshot.tracking.transactionsLast30Days > 0,
      progress: ({ snapshot }) => ({ current: Math.min(1, snapshot.tracking.transactionsLast30Days), target: 1, unit: "count" }),
      headline: "Start tracking where your money goes",
      explain: "Every step on the ladder is measured from your real spending. Import a bank file or connect an account to begin.",
      vars: () => ({}),
      sources: (ctx) => [chartRef(ctx, "step0")],
      actions: [{ id: "import", label: "Import transactions", to: "/import" }],
    },
    {
      id: "ie.track-budget.budget",
      title: "Set a budget for this month",
      isMet: ({ snapshot }) => snapshot.tracking.hasBudgetThisPeriod,
      progress: ({ snapshot }) => ({ current: snapshot.tracking.hasBudgetThisPeriod ? 1 : 0, target: 1, unit: "count" }),
      headline: "Set a budget for this pay period",
      explain: "A budget assigns each euro of pay a job, starting with essentials in the chart's order.",
      vars: () => ({}),
      sources: (ctx) => [chartRef(ctx, "step0")],
      actions: [{ id: "budget", label: "Create budget", to: "/budgets" }],
    },
    {
      id: "ie.track-budget.waterfall",
      title: "Cover essentials from pay",
      isMet: ({ snapshot }) => snapshot.waterfall.firstShortBucket === null,
      progress: ({ snapshot }) => ({ current: snapshot.waterfall.bucketsCovered, target: snapshot.waterfall.buckets, unit: "count" }),
      headline: "Your pay falls {shortfall} short at: {bucket}",
      explain:
        "The payday waterfall pays housing, food, essential bills, income-earning costs and minimum debt payments in order. " +
        "The first bucket left short is {bucket}. Look at non-essential bills and switching providers before anything else.",
      vars: (ctx) => ({ bucket: ctx.snapshot.waterfall.firstShortBucket ?? "", shortfall: money(ctx, ctx.snapshot.waterfall.shortfallMinor) }),
      sources: (ctx) => [chartRef(ctx, "step0")],
      actions: [{ id: "waterfall", label: "Open payday waterfall", to: "/budgets" }],
    },
    {
      id: "ie.track-budget.tax-set-aside",
      title: "Set aside tax on self-employed income",
      appliesWhen: ({ snapshot }) => (snapshot.selfEmployedTax?.monthlySetAsideMinor ?? 0) > 0,
      isMet: ({ snapshot }) => snapshot.selfEmployedTax!.plannedMonthlyMinor >= snapshot.selfEmployedTax!.monthlySetAsideMinor,
      progress: ({ snapshot }) => ({ current: snapshot.selfEmployedTax!.plannedMonthlyMinor, target: snapshot.selfEmployedTax!.monthlySetAsideMinor, unit: snapshot.currency }),
      headline: "Set aside {amount} a month for tax on self-employed income",
      explain:
        "No PAYE is taken from self-employed income, so income tax, USC and Class S PRSI fall due in one go: preliminary tax and the Form 11 balance by {deadline}. " +
        "A tax set-aside goal you pay into each month spreads the bill.",
      vars: (ctx) => ({ amount: money(ctx, ctx.snapshot.selfEmployedTax!.monthlySetAsideMinor), deadline: ctx.snapshot.selfEmployedTax!.nextDeadline }),
      sources: (ctx) => [chartRef(ctx, "step0"), ...(ctx.pack.selfAssessment ? [packRef(ctx, "selfAssessment.preliminaryTax", ctx.pack.selfAssessment.source)] : [])],
      actions: [
        { id: "form11", label: "Open Form 11 estimate", to: "/tax" },
        { id: "goal", label: "Add a tax set-aside goal", to: "/goals" },
      ],
      deadline: (ctx) => ctx.snapshot.selfEmployedTax?.nextDeadline,
    },
  ],
};
