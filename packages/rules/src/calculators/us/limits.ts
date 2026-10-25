import { toMinor } from "../../money";
import { deadlineFor } from "../../dates";
import type { IsoDate } from "../../dates";
import type { UsFilingStatus, UsPack } from "../../packs";

type Range = [number, number];

export interface UsLimitsInput {
  age: number;
  filingStatus: UsFilingStatus;
  /** Modified AGI for IRA purposes (both spouses on a joint return). */
  magiMinor: number;
  /** Taxable compensation (on a joint return, can include the spouse's). */
  compensationMinor: number;
  /** Covered by a workplace retirement plan this year. */
  coveredByWorkplacePlan: boolean;
  spouseCoveredByWorkplacePlan?: boolean;
  /** HSA-eligible health plan coverage, if any. */
  hsaCoverage?: "selfOnly" | "family" | null;
}

/** Rounds up to the next multiple of `step` (minor units). */
const ceilTo = (minor: number, step: number) => Math.ceil(minor / step) * step;

/**
 * 2026-style limits for one person: 401(k) deferrals with catch-up, IRA and Roth IRA contributions,
 * the deductible part of a traditional IRA contribution, and HSA. Phase-outs follow the Pub. 590-A
 * worksheets: reduced amounts round up to the next 10 with a 200 minimum.
 */
export function usRetirementLimits(pack: UsPack, input: UsLimitsInput) {
  const r = pack.retirement;
  const notes: string[] = [];
  const [superFrom, superTo] = r.superCatchUpAges;
  const catchUp = input.age >= superFrom && input.age <= superTo ? r.catchUp60to63 : input.age >= r.catchUpAge ? r.catchUp50 : 0;
  const employeeDeferralMinor = toMinor(r.employeeDeferral + catchUp);

  const iraLimit = toMinor(r.ira + (input.age >= r.catchUpAge ? r.iraCatchUp50 : 0));
  const iraMinor = Math.min(iraLimit, input.compensationMinor);
  const step = toMinor(r.phaseOutRounding.step);
  const floor = toMinor(r.phaseOutRounding.minimum);

  // Roth IRA, worksheet 2-2: the share of the range used, rounded to 3 places, comes off the limit.
  const rothRange: Range = input.filingStatus === "marriedJoint" ? r.rothIraPhaseOut.marriedJoint : input.filingStatus === "marriedSeparate" ? r.rothIraPhaseOut.marriedSeparate : r.rothIraPhaseOut.single;
  const [rothFrom, rothTo] = rothRange.map(toMinor) as Range;
  let rothIraMinor = iraMinor;
  if (input.magiMinor >= rothTo) {
    rothIraMinor = 0;
    notes.push("Income is above the Roth IRA limit: direct Roth IRA contributions aren't allowed.");
  } else if (input.magiMinor > rothFrom) {
    const share = Math.min(1, Number(((input.magiMinor - rothFrom) / (rothTo - rothFrom)).toFixed(r.phaseOutRounding.rothRatioDecimals)));
    rothIraMinor = Math.min(iraMinor, Math.max(floor, ceilTo(iraMinor - Math.round(share * iraMinor), step)));
    notes.push("Income is in the Roth IRA phase-out, so the Roth IRA limit is reduced.");
  }

  // Traditional IRA deduction, worksheet 1-2: only reduced when someone on the return is covered.
  const d = r.iraDeductionPhaseOut;
  let deductionRange: Range | null = null;
  if (input.filingStatus === "marriedSeparate" && (input.coveredByWorkplacePlan || input.spouseCoveredByWorkplacePlan)) deductionRange = d.marriedSeparate;
  else if (input.coveredByWorkplacePlan) deductionRange = input.filingStatus === "marriedJoint" ? d.coveredMarriedJoint : d.coveredSingle;
  else if (input.filingStatus === "marriedJoint" && input.spouseCoveredByWorkplacePlan) deductionRange = d.spouseCoveredMarriedJoint;
  let traditionalIraDeductibleMinor = iraMinor;
  if (deductionRange) {
    const [from, to] = deductionRange.map(toMinor) as Range;
    if (input.magiMinor >= to) {
      traditionalIraDeductibleMinor = 0;
      notes.push("With a workplace plan at this income, traditional IRA contributions aren't deductible.");
    } else if (to - input.magiMinor < to - from) {
      const reduced = Math.max(floor, ceilTo(Math.round(((to - input.magiMinor) * iraLimit) / (to - from)), step));
      traditionalIraDeductibleMinor = Math.min(reduced, iraMinor);
      notes.push("With a workplace plan, the traditional IRA deduction is reduced at this income.");
    }
  }

  const h = pack.hsa;
  const hsaMinor = input.hsaCoverage ? toMinor((input.hsaCoverage === "family" ? h.family : h.selfOnly) + (input.age >= h.catchUpAge ? h.catchUp55 : 0)) : null;

  return {
    pack: pack.version,
    employeeDeferralMinor,
    catchUpMinor: toMinor(catchUp),
    iraMinor,
    rothIraMinor,
    traditionalIraDeductibleMinor,
    hsaMinor,
    notes,
    sources: [r.source, h.source],
  };
}

export interface UsEstimatedTaxInput {
  /** This year's expected income tax plus self-employment tax, less refundable credits. */
  expectedTaxMinor: number;
  /** Total tax on last year's return, if there was a full-year return. */
  priorYearTaxMinor: number | null;
  priorYearAgiMinor: number | null;
  withholdingMinor: number;
  filingStatus: UsFilingStatus;
}

/**
 * Quarterly estimated tax under the safe harbour in Pub. 505: pay the smaller of a share of this
 * year's tax or of last year's (more if last year's AGI was high), less withholding, in four parts.
 */
export function usEstimatedTax(pack: UsPack, input: UsEstimatedTaxInput) {
  const e = pack.estimatedTax;
  const year = Number(pack.taxYear);
  const current = Math.round(input.expectedTaxMinor * e.currentYearShare);
  const highIncome = input.priorYearAgiMinor !== null && input.priorYearAgiMinor > toMinor(input.filingStatus === "marriedSeparate" ? e.highIncomeAgi.marriedSeparate : e.highIncomeAgi.other);
  const prior = input.priorYearTaxMinor === null ? null : Math.round(input.priorYearTaxMinor * (highIncome ? e.priorYearShareHighIncome : e.priorYearShare));
  const usePrior = prior !== null && prior < current;
  const requiredAnnualMinor = usePrior ? prior : current;
  const toPay = Math.max(0, requiredAnnualMinor - input.withholdingMinor);
  const required = input.expectedTaxMinor - input.withholdingMinor >= toMinor(e.minimumOwed) && toPay > 0;
  const dueDates: IsoDate[] = e.dueDates.map((d) => deadlineFor(year, d));
  return {
    pack: pack.version,
    required,
    basis: usePrior ? ("priorYear" as const) : ("currentYear" as const),
    requiredAnnualMinor,
    perInstallmentMinor: required ? Math.ceil(toPay / dueDates.length) : 0,
    dueDates,
    source: e.source,
    notes: [
      ...(highIncome ? ["Last year's AGI was over the limit, so the prior-year safe harbour uses a higher share of last year's tax."] : []),
      "A due date on a weekend or holiday moves to the next business day.",
    ],
  };
}
