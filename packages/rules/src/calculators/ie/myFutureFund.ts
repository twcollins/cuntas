import { applyRate, toMinor } from "../../money";
import type { IePack } from "../../packs";

export interface MffContributions {
  employeeMinor: number;
  employerMinor: number;
  stateMinor: number;
}

export function myFutureFundContributions(pack: IePack, grossAnnualMinor: number): MffContributions {
  const base = Math.min(grossAnnualMinor, toMinor(pack.myFutureFund.earningsCap));
  const r = pack.myFutureFund.rates;
  return {
    employeeMinor: applyRate(base, r.employee),
    employerMinor: applyRate(base, r.employer),
    stateMinor: applyRate(base, r.state),
  };
}

export type MffStatus = "not-eligible-age" | "not-eligible-earnings" | "in-qualifying-scheme" | "auto-enrolled" | "opted-out";

/** Auto-enrolment status for an employee, from the pack's eligibility rules. */
export function myFutureFundStatus(
  pack: IePack,
  input: { age: number; grossAnnualMinor: number; inQualifyingScheme: boolean; optedOut?: boolean },
): MffStatus {
  const e = pack.myFutureFund.eligibility;
  if (input.inQualifyingScheme) return "in-qualifying-scheme";
  if (input.age < e.minAge || input.age > e.maxAge) return "not-eligible-age";
  if (input.grossAnnualMinor < toMinor(e.minEarnings)) return "not-eligible-earnings";
  return input.optedOut ? "opted-out" : "auto-enrolled";
}
