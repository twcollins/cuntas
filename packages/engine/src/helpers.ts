import { formatMoney, formatRate, toMinor, type ChartDefaults, type RulePack, type RuleRef } from "@cuntas/rules";
import type { EvalContext, HouseholdSnapshot, Thresholds } from "./types";

export const money = (ctx: EvalContext<RulePack>, minor: number) => formatMoney(minor, ctx.snapshot.currency, { decimals: false });
export const pct = formatRate;

export function defaultThresholds(chart: ChartDefaults): Thresholds {
  return {
    starterFundFloorMinor: toMinor(chart.starterFund.floor),
    starterFundMonths: chart.starterFund.months,
    fullFundFloorLowMinor: toMinor(chart.fullFund.floorLow),
    fullFundFloorHighMinor: toMinor(chart.fullFund.floorHigh),
    fullFundMonthsLow: chart.fullFund.monthsLow,
    fullFundMonthsHigh: chart.fullFund.monthsHigh,
    highAprAbove: chart.debt.highAprAbove,
    moderateAprFrom: chart.debt.moderateAprFrom,
    retirementShareOfAge: chart.retirement.shareOfAge,
    fundBasis: "netPay",
    mortgageOverpayRate: chart.mortgageOverpay.rate,
  };
}

function fundBasisMinor(s: HouseholdSnapshot): number {
  return s.thresholds.fundBasis === "essentialSpend" ? s.essentialMonthlySpendMinor : s.netMonthlyPayMinor;
}

export function starterFundTarget(s: HouseholdSnapshot): number {
  return Math.max(s.thresholds.starterFundFloorMinor, s.thresholds.starterFundMonths * fundBasisMinor(s));
}

/** Upper end of the chart's range for single-income or self-employed households. */
export function needsUpperFund(s: HouseholdSnapshot): boolean {
  const earners = s.members.filter((m) => m.grossAnnualMinor > 0);
  return earners.length <= 1 || earners.some((m) => m.employment === "selfEmployed");
}

export function fullFundTarget(s: HouseholdSnapshot): { targetMinor: number; months: number } {
  const t = s.thresholds;
  const upper = needsUpperFund(s);
  const months = upper ? t.fullFundMonthsHigh : t.fullFundMonthsLow;
  const floor = upper ? t.fullFundFloorHighMinor : t.fullFundFloorLowMinor;
  return { targetMinor: Math.max(floor, months * fundBasisMinor(s)), months };
}

export function chartRef(ctx: EvalContext<RulePack>, key: string): RuleRef {
  return { pack: ctx.chart.version, key, source: ctx.chart.source };
}

export function packRef(ctx: EvalContext<RulePack>, key: string, source: string): RuleRef {
  return { pack: ctx.pack.version, key, source };
}

export function render(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{${k}}`));
}

export function nonMortgageDebts(s: HouseholdSnapshot) {
  return s.debts.filter((d) => d.kind !== "mortgage" && d.balanceMinor > 0);
}
