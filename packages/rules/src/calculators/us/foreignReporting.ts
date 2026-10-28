import { deadlineFor } from "../../dates";
import { sumMinor, toMinor } from "../../money";
import type { UsFilingStatus, UsPack } from "../../packs";

// Whether a US person's foreign accounts and assets need reporting for a year: FBAR (FinCEN 114)
// and Form 8938 (FATCA). Values are in dollars; the caller converts at a year-end rate.

export interface UsForeignReportingInput {
  /** Lives outside the US for Form 8938's higher thresholds (bona fide residence or 330 days abroad). */
  livesAbroad: boolean;
  filingStatus: UsFilingStatus;
  /** Each foreign account or asset: its highest value in the year and its value at year end. */
  accounts: { maxMinor: number; yearEndMinor: number }[];
  taxYear?: number;
}

export function usForeignReporting(pack: UsPack, input: UsForeignReportingInput) {
  const fr = pack.foreignReporting;
  if (!fr) throw new Error(`Rule pack ${pack.version} has no foreign reporting data`);
  const year = input.taxYear ?? Number(pack.taxYear);
  const aggregateMaxMinor = sumMinor(input.accounts.map((a) => a.maxMinor));
  const yearEndMinor = sumMinor(input.accounts.map((a) => a.yearEndMinor));
  const fbarThreshold = toMinor(fr.fbar.threshold);
  const t = (input.livesAbroad ? fr.form8938.livingAbroad : fr.form8938.livingInUS)[input.filingStatus];
  const yearEndThresholdMinor = toMinor(t.yearEnd);
  const anyTimeThresholdMinor = toMinor(t.anyTime);
  return {
    fbar: {
      required: aggregateMaxMinor > fbarThreshold,
      aggregateMaxMinor,
      thresholdMinor: fbarThreshold,
      due: deadlineFor(year, fr.fbar.due),
      extendedDue: deadlineFor(year, fr.fbar.extendedDue),
      source: fr.fbar.source,
    },
    form8938: {
      required: yearEndMinor > yearEndThresholdMinor || aggregateMaxMinor > anyTimeThresholdMinor,
      yearEndMinor,
      maxMinor: aggregateMaxMinor,
      yearEndThresholdMinor,
      anyTimeThresholdMinor,
      source: fr.source,
    },
    returnDueAbroad: deadlineFor(year, fr.returnDueAbroad.due),
    returnDueAbroadSource: fr.returnDueAbroad.source,
    foreignEarnedIncomeExclusionMinor: toMinor(fr.foreignEarnedIncomeExclusion.amount),
    feieSource: fr.foreignEarnedIncomeExclusion.source,
  };
}
