import { toMinor } from "@cuntas/rules";
import type { StepDefinition } from "../../types";
import { chartRef, money } from "../../helpers";

export const advanced: StepDefinition = {
  id: "ie.advanced",
  order: 6,
  title: "Advanced methods and goals",
  chartRule:
    "No home: save a deposit so savings plus rent exceed the expected mortgage payment. Plan children's college fees. Then choose your options.",
  jurisdictions: ["IE", "UK"],
  scope: "household",
  checks: [
    {
      id: "ie.advanced.mortgage-ready",
      title: "Mortgage readiness",
      appliesWhen: ({ snapshot }) => !snapshot.housing.ownsHome,
      isMet: ({ snapshot: { housing } }) =>
        housing.expectedMortgagePaymentMinor !== null &&
        housing.monthlyDepositSavingMinor + housing.monthlyRentMinor > housing.expectedMortgagePaymentMinor,
      progress: ({ snapshot: { housing, currency } }) => ({
        current: housing.monthlyDepositSavingMinor + housing.monthlyRentMinor,
        target: housing.expectedMortgagePaymentMinor ?? 0,
        unit: currency,
      }),
      headline: "Show you can afford a mortgage: save {gap} more a month toward a deposit",
      explain:
        "The chart's test: monthly deposit saving ({saving}) plus rent ({rent}) should exceed the expected mortgage payment ({mortgage}). " +
        "First-time buyers of new homes may qualify for Help to Buy, up to {htb}.",
      vars: (ctx) => {
        const h = ctx.snapshot.housing;
        const expected = h.expectedMortgagePaymentMinor;
        return {
          gap: expected === null ? "an amount" : money(ctx, Math.max(0, expected - h.monthlyDepositSavingMinor - h.monthlyRentMinor + 1)),
          saving: money(ctx, h.monthlyDepositSavingMinor),
          rent: money(ctx, h.monthlyRentMinor),
          mortgage: expected === null ? "not set: add a house deposit goal with an expected payment" : money(ctx, expected),
          htb: money(ctx, toMinor(ctx.pack.helpToBuy.maxRelief)),
        };
      },
      sources: (ctx) => [chartRef(ctx, "step6"), { pack: ctx.pack.version, key: "helpToBuy", source: ctx.pack.helpToBuy.source }],
      actions: [{ id: "goals", label: "Set up house deposit goal", to: "/goals" }],
    },
    {
      id: "ie.advanced.college",
      title: "Children's college fund",
      appliesWhen: ({ snapshot }) => snapshot.children.count > 0,
      isMet: ({ snapshot }) => snapshot.children.collegeGoals > 0 && snapshot.children.collegeFundsOnTrack,
      progress: ({ snapshot }) => ({ current: snapshot.children.collegeGoals, target: snapshot.children.count, unit: "count" }),
      headline: "Plan for your children's college costs",
      explain:
        "Set a target per child and year. For costs under {years} years away, save; for longer horizons, investing is usually considered.",
      vars: (ctx) => ({ years: ctx.chart.goals.savingsHorizonYears }),
      sources: (ctx) => [chartRef(ctx, "goals.savingsHorizonYears")],
      actions: [{ id: "goals", label: "Add college goal", to: "/goals" }],
    },
  ],
};
