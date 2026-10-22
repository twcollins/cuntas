import { applyRate, toMinor } from "@cuntas/rules";
import type { StepDefinition } from "../../types";
import { chartRef, money, packRef, pct } from "../../helpers";

export const employerMatch: StepDefinition = {
  id: "ie.employer-match",
  order: 2,
  title: "Employer-matched contributions",
  chartRule: "Pay the minimum for the full employer pension match and nothing more; then the same for a 1:1 stock match.",
  jurisdictions: ["IE", "UK"],
  scope: "member",
  alwaysOn: true,
  appliesWhen: ({ member }) => member?.employment === "employee",
  checks: [
    {
      id: "ie.employer-match.pension",
      title: "Full employer pension match",
      appliesWhen: ({ member }) => !!member && member.pension.hasEmployerScheme && member.pension.fullMatchEmployeeRate > 0,
      isMet: ({ member }) => member!.pension.employeeRate >= member!.pension.fullMatchEmployeeRate,
      progress: ({ member }) => ({
        current: member!.pension.employeeRate * 100,
        target: member!.pension.fullMatchEmployeeRate * 100,
        unit: "%",
      }),
      headline: "{name}: you're leaving {unclaimed} a year of employer pension match unclaimed",
      explain:
        "Your employer matches contributions up to {matchRate} of pay; you contribute {yourRate}. " +
        "Raising your contribution to {matchRate} captures the full match. Contributions also get income tax relief at your marginal rate ({marginal}).",
      vars: (ctx) => {
        const m = ctx.member!;
        const gap = Math.max(0, m.pension.fullMatchEmployeeRate - m.pension.employeeRate);
        return {
          name: m.name,
          unclaimed: money(ctx, applyRate(applyRate(m.grossAnnualMinor, gap), m.pension.matchRatio)),
          matchRate: pct(m.pension.fullMatchEmployeeRate),
          yourRate: pct(m.pension.employeeRate),
          marginal: pct(m.marginalRate),
        };
      },
      sources: (ctx) => [chartRef(ctx, "step2"), packRef(ctx, "pension.ageBands", ctx.pack.pension.source)],
      actions: [{ id: "pensions", label: "Update pension contribution", to: "/pensions" }],
    },
    {
      id: "ie.employer-match.myfuturefund",
      title: "MyFutureFund auto-enrolment",
      appliesWhen: ({ member }) =>
        !!member && member.residence === "IE" && !member.pension.hasEmployerScheme &&
        (member.pension.myFutureFund === "auto-enrolled" || member.pension.myFutureFund === "opted-out"),
      isMet: ({ member }) => member!.pension.myFutureFund === "auto-enrolled",
      progress: ({ member }) => ({ current: member!.pension.myFutureFund === "auto-enrolled" ? 1 : 0, target: 1, unit: "count" }),
      headline: "{name}: opting out of MyFutureFund gives up {free} a year",
      explain:
        "With no qualifying workplace scheme you're eligible for MyFutureFund. Your {employee} is matched by {employer} from your employer " +
        "and {state} from the State, on pay up to {cap}. There's no income tax relief: the State top-up replaces it. You can re-enrol any time.",
      vars: (ctx) => {
        const m = ctx.member!;
        const f = ctx.pack.myFutureFund;
        const base = Math.min(m.grossAnnualMinor, toMinor(f.earningsCap));
        return {
          name: m.name,
          free: money(ctx, applyRate(base, f.rates.employer) + applyRate(base, f.rates.state)),
          employee: pct(f.rates.employee),
          employer: pct(f.rates.employer),
          state: pct(f.rates.state),
          cap: money(ctx, toMinor(f.earningsCap)),
        };
      },
      sources: (ctx) => [packRef(ctx, "myFutureFund", ctx.pack.myFutureFund.source)],
      actions: [{ id: "pensions", label: "Review MyFutureFund", to: "/pensions" }],
    },
    {
      id: "ie.employer-match.stock",
      title: "Full 1:1 stock match",
      appliesWhen: ({ member }) => !!member?.stockMatch && member.stockMatch.fullMatchRate > 0,
      isMet: ({ member }) => member!.stockMatch!.contributedRate >= member!.stockMatch!.fullMatchRate,
      progress: ({ member }) => ({ current: member!.stockMatch!.contributedRate * 100, target: member!.stockMatch!.fullMatchRate * 100, unit: "%" }),
      headline: "{name}: contribute {target} to get the full share match",
      explain: "Your employer matches share purchases 1:1 up to {target} of pay; you contribute {current}. Pension match comes first.",
      vars: ({ member }) => ({ name: member!.name, target: pct(member!.stockMatch!.fullMatchRate), current: pct(member!.stockMatch!.contributedRate) }),
      sources: (ctx) => [chartRef(ctx, "step2")],
      actions: [{ id: "pensions", label: "Record share scheme", to: "/pensions" }],
    },
  ],
};
