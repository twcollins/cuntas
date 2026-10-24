import { applyRate, sumMinor, toMinor } from "../../money";
import type { ExplainedLine, RuleRef, UkPack } from "../../packs";

export interface AnnualAllowanceInput {
  /** Income before pension contributions, less personal contributions (HMRC "threshold income"). */
  thresholdIncomeMinor: number;
  /** Threshold income plus employer contributions (HMRC "adjusted income"). */
  adjustedIncomeMinor: number;
  relevantEarningsMinor: number;
  /** All pension input this year, gross: personal (with relief added) plus employer. */
  totalContributionsMinor: number;
  /** Personal contributions, gross of basic-rate relief. */
  personalContributionsMinor: number;
  /** Flexibly accessed a defined-contribution pension, which triggers the money purchase annual allowance. */
  mpaaTriggered?: boolean;
  /** Unused allowance from earlier years, oldest first, for carry forward. */
  carryForward?: { taxYear: string; unusedMinor: number }[];
  marginalRate: number;
}

export interface AnnualAllowanceResult {
  pack: string;
  annualAllowanceMinor: number;
  tapered: boolean;
  carryForwardAvailableMinor: number;
  carryForwardUsed: { taxYear: string; usedMinor: number }[];
  totalAvailableMinor: number;
  excessMinor: number;
  estimatedChargeMinor: number;
  reliefLimitMinor: number;
  personalOverReliefLimitMinor: number;
  lines: ExplainedLine[];
  notes: string[];
}

/** UK pension annual allowance with the taper, carry forward and the money purchase annual allowance. */
export function ukAnnualAllowance(pack: UkPack, input: AnnualAllowanceInput): AnnualAllowanceResult {
  const aa = pack.pensionAnnualAllowance;
  if (!aa) throw new Error(`Rule pack ${pack.version} has no annual allowance data`);
  const rule = (key: string, value?: number): RuleRef => ({ pack: pack.version, key: `pensionAnnualAllowance.${key}`, source: aa.source, ...(value !== undefined ? { value } : {}) });
  const notes: string[] = [];
  const lines: ExplainedLine[] = [];

  let allowance = toMinor(aa.annualAllowance);
  let tapered = false;
  if (input.thresholdIncomeMinor > toMinor(aa.taper.thresholdIncome) && input.adjustedIncomeMinor > toMinor(aa.taper.adjustedIncome)) {
    const reduction = Math.floor((input.adjustedIncomeMinor - toMinor(aa.taper.adjustedIncome)) / aa.taper.divisor);
    allowance = Math.max(toMinor(aa.taper.minimum), allowance - reduction);
    tapered = true;
    notes.push("Your allowance is tapered because threshold and adjusted income are both above the limits.");
  }
  lines.push({ label: tapered ? "Tapered annual allowance" : "Annual allowance", amountMinor: allowance, rule: rule(tapered ? "taper" : "annualAllowance", aa.annualAllowance) });

  let carryForward = input.carryForward ?? [];
  if (input.mpaaTriggered) {
    allowance = Math.min(allowance, toMinor(aa.moneyPurchaseAnnualAllowance));
    carryForward = [];
    notes.push("The money purchase annual allowance applies to defined-contribution savings, and carry forward cannot be used against it.");
    lines.push({ label: "Money purchase annual allowance", amountMinor: allowance, rule: rule("moneyPurchaseAnnualAllowance", aa.moneyPurchaseAnnualAllowance) });
  }
  carryForward = carryForward.slice(-aa.carryForwardYears);

  // The current year's allowance is used first, then carry forward from the oldest year.
  let over = Math.max(0, input.totalContributionsMinor - allowance);
  const carryForwardUsed: { taxYear: string; usedMinor: number }[] = [];
  for (const y of carryForward) {
    if (over <= 0) break;
    const used = Math.min(over, Math.max(0, y.unusedMinor));
    if (used > 0) carryForwardUsed.push({ taxYear: y.taxYear, usedMinor: used });
    over -= used;
  }
  const carryForwardAvailableMinor = sumMinor(carryForward.map((y) => Math.max(0, y.unusedMinor)));
  if (carryForwardUsed.length > 0) notes.push("Carry forward needs you to have been in a registered pension scheme in each year used.");
  const estimatedChargeMinor = applyRate(over, input.marginalRate);
  if (over > 0) notes.push("Contributions above your available allowance are taxed at your marginal rate through self assessment, or by scheme pays.");

  const reliefLimitMinor = Math.max(input.relevantEarningsMinor, toMinor(aa.noEarningsReliefLimit));
  const personalOverReliefLimitMinor = Math.max(0, input.personalContributionsMinor - reliefLimitMinor);
  if (personalOverReliefLimitMinor > 0) notes.push("Personal contributions above 100% of your earnings get no tax relief.");

  return {
    pack: pack.version,
    annualAllowanceMinor: allowance,
    tapered,
    carryForwardAvailableMinor,
    carryForwardUsed,
    totalAvailableMinor: allowance + carryForwardAvailableMinor,
    excessMinor: over,
    estimatedChargeMinor,
    reliefLimitMinor,
    personalOverReliefLimitMinor,
    lines,
    notes,
  };
}
