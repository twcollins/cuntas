import { toMinor } from "../../money";
import { WEEKS_PER_YEAR } from "../../dates";
import type { UkPack } from "../../packs";

/** UK State Pension record gap check: is Class 3 worth buying, and is the person eligible from abroad? */
export function ukNiGapCheck(
  pack: UkPack,
  input: { qualifyingYears: number; yearsUntilStatePensionAge: number; livingAbroad: boolean; ukLinkYears: number; gapYearsToBuy: number },
) {
  const sp = pack.statePension;
  const nv = pack.niVoluntary;
  if (!sp || !nv) throw new Error(`Rule pack ${pack.version} has no State Pension or voluntary NI data`);
  const projectedYears = input.qualifyingYears + input.yearsUntilStatePensionAge;
  const shortfallYears = Math.max(0, sp.qualifyingYearsForFull - projectedYears);
  const eligibleAbroad = !input.livingAbroad || input.ukLinkYears >= nv.abroadMinimumYearsUkLink;
  const years = Math.min(input.gapYearsToBuy, shortfallYears);
  const costPerYearMinor = toMinor(nv.class3AnnualCost);
  const weeklyPerYearMinor = Math.round(toMinor(sp.fullWeekly) / sp.qualifyingYearsForFull);
  const annualGainPerYearMinor = weeklyPerYearMinor * WEEKS_PER_YEAR;
  const reachesMinimum = projectedYears + years >= sp.minimumQualifyingYears;
  return {
    eligible: eligibleAbroad,
    eligibilityReason: eligibleAbroad
      ? "Eligible to pay Class 3 voluntary contributions."
      : `From abroad, Class 3 needs ${nv.abroadMinimumYearsUkLink} years of UK residence or contributions.`,
    projectedYears,
    shortfallYears,
    yearsWorthBuying: years,
    costMinor: years * costPerYearMinor,
    extraWeeklyPensionMinor: years * weeklyPerYearMinor,
    paybackYears: annualGainPerYearMinor > 0 ? costPerYearMinor / annualGainPerYearMinor : null,
    reachesMinimum,
    rules: [
      { pack: pack.version, key: "statePension", source: sp.source },
      { pack: pack.version, key: "niVoluntary", source: nv.source },
    ],
  };
}
