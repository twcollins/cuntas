import { applyRate, pensionReliefHeadroom, toMinor } from "@cuntas/rules";
import type { EvalContext, StepDefinition } from "../../types";
import { chartRef, money, packRef, pct } from "../../helpers";

const target = (ctx: EvalContext) => (ctx.member!.age * ctx.snapshot.thresholds.retirementShareOfAge) / 100;
const current = (ctx: EvalContext) => ctx.member!.pension.employeeRate + ctx.member!.pension.employerRate;

export const retirement: StepDefinition = {
  id: "ie.retirement",
  order: 5,
  title: "Additional retirement savings",
  chartRule: "Save a percentage of pre-tax income equal to half your age (30 = 15%, 40 = 20%).",
  jurisdictions: ["IE", "UK"],
  scope: "member",
  appliesWhen: ({ member }) => !!member && member.grossAnnualMinor > 0 && (member.employment === "employee" || member.employment === "selfEmployed"),
  checks: [
    {
      id: "ie.retirement.half-age",
      title: "Half-your-age pension saving",
      isMet: (ctx) => current(ctx) + 1e-9 >= target(ctx),
      progress: (ctx) => ({ current: Math.round(current(ctx) * 1000) / 10, target: Math.round(target(ctx) * 1000) / 10, unit: "%" }),
      headline: "{name}: raise pension saving from {current} to {target} of pay",
      explain:
        "Half your age ({age}) is {target} of pre-tax pay; you and your employer put in {current}, about {gap} a year short. " +
        "{vehicle} Your age-band relief limit is {limitRate} of earnings up to {cap}; {headroom} of unused relief this year is worth {taxBack} back at {marginal}.",
      vars: (ctx) => {
        const m = ctx.member!;
        const h = pensionReliefHeadroom(ctx.pack, {
          age: m.age,
          earningsMinor: m.grossAnnualMinor,
          contributedMinor: applyRate(m.grossAnnualMinor, m.pension.employeeRate),
          marginalRate: m.marginalRate,
        });
        return {
          name: m.name,
          age: m.age,
          target: pct(target(ctx)),
          current: pct(current(ctx)),
          gap: money(ctx, applyRate(m.grossAnnualMinor, Math.max(0, target(ctx) - current(ctx)))),
          vehicle: m.pension.hasEmployerScheme
            ? "Raise contributions in your employer scheme (AVCs)."
            : "With no employer scheme, a PRSA (or an Executive Pension if self-employed through a company) is the usual route.",
          limitRate: pct(h.limitRate),
          cap: money(ctx, toMinor(ctx.pack.pension.earningsCap)),
          headroom: money(ctx, h.headroomMinor),
          taxBack: money(ctx, h.taxBackMinor),
          marginal: pct(m.marginalRate),
        };
      },
      deadline: (ctx) => `${Number(ctx.pack.taxYear) + ctx.pack.pension.reliefClaimDeadline.yearOffset}-${ctx.pack.pension.reliefClaimDeadline.monthDay}`,
      sources: (ctx) => [
        chartRef(ctx, "retirement.shareOfAge"),
        packRef(ctx, "pension.ageBands", ctx.pack.pension.source),
        packRef(ctx, "pension.earningsCap", ctx.pack.pension.source),
      ],
      actions: [{ id: "pensions", label: "Open pensions", to: "/pensions" }],
    },
  ],
};
