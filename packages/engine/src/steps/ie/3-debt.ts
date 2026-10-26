import { sumMinor } from "@cuntas/rules";
import type { EvalContext, StepDefinition } from "../../types";
import { chartRef, fundBasisUsed, fullFundTarget, money, nonMortgageDebts, pct } from "../../helpers";

const high = (ctx: EvalContext) => nonMortgageDebts(ctx.snapshot).filter((d) => d.apr > ctx.snapshot.thresholds.highAprAbove);
const moderate = (ctx: EvalContext) =>
  nonMortgageDebts(ctx.snapshot).filter(
    (d) => d.apr >= ctx.snapshot.thresholds.moderateAprFrom && d.apr <= ctx.snapshot.thresholds.highAprAbove,
  );
const byApr = (ctx: EvalContext, list: ReturnType<typeof high>) => [...list].sort((a, b) => b.apr - a.apr)[0];

export const debt: StepDefinition = {
  id: "ie.debt",
  order: 3,
  title: "Reduce existing debt",
  chartRule:
    "Clear high-interest debt (above 8%); then raise the emergency fund to the greater of EUR 4,500-9,000 or 3-6 months' net pay; then moderate debt (5-8%).",
  jurisdictions: ["IE", "UK"],
  scope: "household",
  checks: [
    {
      id: "ie.debt.high-interest",
      title: "Clear high-interest debt",
      isMet: (ctx) => high(ctx).length === 0,
      progress: (ctx) => ({ current: sumMinor(high(ctx).map((d) => d.balanceMinor)), target: 0, unit: ctx.snapshot.currency }),
      headline: "Pay off {total} of high-interest debt (above {threshold})",
      explain:
        "Debt above {threshold} costs more than almost any saving earns. Avalanche order starts with {first} at {firstApr}. " +
        "Keep paying minimums on everything else; BNPL and PCP car finance count here too.",
      vars: (ctx) => {
        const first = byApr(ctx, high(ctx));
        return {
          total: money(ctx, sumMinor(high(ctx).map((d) => d.balanceMinor))),
          threshold: pct(ctx.snapshot.thresholds.highAprAbove),
          first: first?.name ?? "",
          firstApr: first ? pct(first.apr) : "",
        };
      },
      sources: (ctx) => [chartRef(ctx, "debt.highAprAbove")],
      actions: [{ id: "planner", label: "Open payoff planner", to: "/debts" }],
    },
    {
      id: "ie.debt.full-fund",
      title: "Full emergency fund",
      isMet: ({ snapshot }) => snapshot.liquidSavingsMinor >= fullFundTarget(snapshot).targetMinor,
      progress: ({ snapshot }) => ({ current: snapshot.liquidSavingsMinor, target: fullFundTarget(snapshot).targetMinor, unit: snapshot.currency }),
      headline: "Grow your emergency fund to {target}",
      explain:
        "With high-interest debt cleared, the chart raises the fund to {months} months of {basis} ({target}), or the floor if higher. " +
        "{reason} You have {saved}.",
      vars: (ctx) => {
        const s = ctx.snapshot;
        const f = fullFundTarget(s);
        return {
          target: money(ctx, f.targetMinor),
          months: f.months,
          basis: fundBasisUsed(s) === "netPay" ? "net pay" : "essential spending",
          reason:
            f.months === s.thresholds.fullFundMonthsHigh
              ? "Single-income and self-employed households use the upper end."
              : "Two-income households use the lower end.",
          saved: money(ctx, s.liquidSavingsMinor),
        };
      },
      sources: (ctx) => [chartRef(ctx, "fullFund")],
      actions: [{ id: "goal", label: "Update emergency fund goal", to: "/goals" }],
    },
    {
      id: "ie.debt.moderate",
      title: "Clear moderate-interest debt",
      isMet: (ctx) => moderate(ctx).length === 0,
      progress: (ctx) => ({ current: sumMinor(moderate(ctx).map((d) => d.balanceMinor)), target: 0, unit: ctx.snapshot.currency }),
      headline: "Pay down {total} of moderate-interest debt ({from} to {to})",
      explain: "Next on the chart is debt between {from} and {to}. Avalanche order starts with {first}.",
      vars: (ctx) => ({
        total: money(ctx, sumMinor(moderate(ctx).map((d) => d.balanceMinor))),
        from: pct(ctx.snapshot.thresholds.moderateAprFrom),
        to: pct(ctx.snapshot.thresholds.highAprAbove),
        first: byApr(ctx, moderate(ctx))?.name ?? "",
      }),
      sources: (ctx) => [chartRef(ctx, "debt.moderateAprFrom")],
      actions: [{ id: "planner", label: "Open payoff planner", to: "/debts" }],
    },
  ],
};
