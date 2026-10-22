import { monthsBetween } from "@cuntas/rules";
import type { EvalContext, SinkingFundState, StepDefinition } from "../../types";
import { chartRef, money } from "../../helpers";

export function monthlyNeeded(fund: SinkingFundState, asOf: string): number {
  const months = Math.max(1, monthsBetween(asOf, fund.dueDate));
  return Math.ceil(Math.max(0, fund.targetMinor - fund.savedMinor) / months);
}

function onTrack(fund: SinkingFundState, asOf: string): boolean {
  return fund.savedMinor >= fund.targetMinor || fund.monthlyContributionMinor >= monthlyNeeded(fund, asOf);
}

const behind = (ctx: EvalContext) =>
  ctx.snapshot.sinkingFunds
    .filter((f) => !onTrack(f, ctx.snapshot.asOf))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

export const requiredPurchases: StepDefinition = {
  id: "ie.required-purchases",
  order: 4,
  title: "Required investments",
  chartRule: "Save for required large purchases due soon: college fees, a car for work, professional certifications.",
  jurisdictions: ["IE", "UK"],
  scope: "household",
  checks: [
    {
      id: "ie.required-purchases",
      title: "Sinking funds on track",
      isMet: (ctx) => behind(ctx).length === 0,
      progress: (ctx) => {
        const funds = ctx.snapshot.sinkingFunds;
        return { current: funds.length - behind(ctx).length, target: funds.length, unit: "count" };
      },
      headline: "Save {monthly} a month for {name} by {due}",
      explain:
        "{name} needs {target} by {due}; {saved} is saved and {contribution} a month is set aside. " +
        "{count} required purchase fund(s) are behind.",
      vars: (ctx) => {
        const f = behind(ctx)[0]!;
        return {
          name: f.name,
          monthly: money(ctx, monthlyNeeded(f, ctx.snapshot.asOf)),
          due: f.dueDate,
          target: money(ctx, f.targetMinor),
          saved: money(ctx, f.savedMinor),
          contribution: money(ctx, f.monthlyContributionMinor),
          count: behind(ctx).length,
        };
      },
      deadline: (ctx) => behind(ctx)[0]?.dueDate,
      sources: (ctx) => [chartRef(ctx, "step4")],
      actions: [{ id: "goals", label: "Adjust sinking funds", to: "/goals" }],
    },
  ],
};
