import type { EvalContext, StepDefinition } from "../../types";
import { chartRef, money, starterFundTarget } from "../../helpers";

// DIRT is Irish; a household with nobody resident in Ireland doesn't pay it.
const paysDirt = (ctx: EvalContext) => ctx.snapshot.members.length === 0 || ctx.snapshot.members.some((m) => m.residence === "IE");

export const starterFund: StepDefinition = {
  id: "ie.starter-fund",
  order: 1,
  title: "Build an emergency fund",
  chartRule: "The greater of EUR 1,500 or one month's net salary, in a current or savings account.",
  jurisdictions: ["IE", "UK"],
  scope: "household",
  checks: [
    {
      id: "ie.starter-fund",
      title: "Starter emergency fund",
      isMet: ({ snapshot }) => snapshot.liquidSavingsMinor >= starterFundTarget(snapshot),
      progress: ({ snapshot }) => ({ current: snapshot.liquidSavingsMinor, target: starterFundTarget(snapshot), unit: snapshot.currency }),
      headline: "Save {gap} more for your starter emergency fund",
      explain:
        "The chart's starter fund is the greater of {floor} or {months} month's net pay ({target}). You have {saved} in cash savings.{dirtNote}",
      vars: (ctx) => {
        const s = ctx.snapshot;
        const target = starterFundTarget(s);
        return {
          gap: money(ctx, Math.max(0, target - s.liquidSavingsMinor)),
          floor: money(ctx, s.thresholds.starterFundFloorMinor),
          months: s.thresholds.starterFundMonths,
          target: money(ctx, target),
          saved: money(ctx, s.liquidSavingsMinor),
          dirtNote: paysDirt(ctx) ? ` Interest on deposits is subject to DIRT at ${ctx.pack.dirt.rate * 100}%.` : "",
        };
      },
      sources: (ctx) => [chartRef(ctx, "starterFund"), ...(paysDirt(ctx) ? [{ pack: ctx.pack.version, key: "dirt.rate", source: ctx.pack.dirt.source }] : [])],
      actions: [{ id: "goal", label: "Set up emergency fund goal", to: "/goals" }],
    },
  ],
};
