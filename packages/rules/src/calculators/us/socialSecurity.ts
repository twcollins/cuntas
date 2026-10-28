import { MONTHS_PER_YEAR, yearOf, type IsoDate } from "../../dates";
import { applyRate, toMinor } from "../../money";
import type { Fraction, RuleRef, UsPack } from "../../packs";

// Social Security retirement benefit (SSA's PIA formula). Estimated in today's terms: years of pay
// at today's level stand in for the indexed earnings record, so the result is an estimate, not
// SSA's figure. A figure from the person's SSA statement replaces it when given.

function section(pack: UsPack) {
  const s = pack.socialSecurity;
  if (!s) throw new Error(`Rule pack ${pack.version} has no Social Security data`);
  return s;
}

const floorTo = (minor: number, step: number) => Math.floor(minor / step) * step;

/** Primary insurance amount (monthly, at full retirement age) from average indexed monthly earnings. */
export function usPia(pack: UsPack, aimeMinor: number): number {
  const s = section(pack);
  const [b1, b2] = [toMinor(s.bendPoints[0]), toMinor(s.bendPoints[1])];
  const [f1, f2, f3] = s.factors;
  const raw = applyRate(Math.min(aimeMinor, b1), f1) + applyRate(Math.max(0, Math.min(aimeMinor, b2) - b1), f2) + applyRate(Math.max(0, aimeMinor - b2), f3);
  return floorTo(raw, toMinor(s.rounding.pia));
}

/** Full retirement age for a date of birth. People born on 1 January use the year before (SSA counts the day before a birthday). */
export function usFullRetirementAge(pack: UsPack, dateOfBirth: IsoDate): { years: number; months: number } {
  const s = section(pack);
  const year = yearOf(dateOfBirth) - (dateOfBirth.endsWith("-01-01") ? 1 : 0);
  const table = s.fullRetirementAge.byBirthYear;
  const row = [...table].reverse().find((r) => r.bornFrom <= year) ?? table[0]!;
  return { years: row.years, months: row.months };
}

export interface UsSocialSecurityInput {
  dateOfBirth: IsoDate;
  /** Age benefits start, held to 62-70. */
  claimAge: number;
  /** Pay a year in today's dollars, assumed for every covered year. */
  annualEarningsMinor: number;
  /** Years of covered US work by the time of claiming (past and planned). */
  coveredYears: number;
  /** The monthly benefit at full retirement age from the person's SSA statement, if they have it. */
  statementPiaMinor?: number | null;
}

/** Applies the early-claiming reduction or delayed credits to a PIA, rounded down to the dollar. */
function adjust(piaMinor: number, monthsFromFra: number, early: { firstMonths: number; firstPercentPerMonth: Fraction; laterPercentPerMonth: Fraction }, delayed: Fraction, step: number): number {
  // Integer arithmetic over a common denominator, so 70% is exactly 70%.
  if (monthsFromFra < 0) {
    const months = -monthsFromFra;
    const first = Math.min(months, early.firstMonths);
    const [a, b] = early.firstPercentPerMonth;
    const [c, d] = early.laterPercentPerMonth;
    const den = b * d * 100;
    const num = first * a * d + (months - first) * c * b;
    return floorTo(Math.floor((piaMinor * (den - num)) / den), step);
  }
  const [a, b] = delayed;
  const den = b * 100;
  return floorTo(Math.floor((piaMinor * (den + monthsFromFra * a)) / den), step);
}

export function usSocialSecurityEstimate(pack: UsPack, input: UsSocialSecurityInput) {
  const s = section(pack);
  const [earliest, latest] = s.claimAges;
  const claimAge = Math.min(latest, Math.max(earliest, input.claimAge));
  const fra = usFullRetirementAge(pack, input.dateOfBirth);
  const fromStatement = input.statementPiaMinor != null && input.statementPiaMinor > 0;
  const eligible = fromStatement || input.coveredYears * s.creditsPerYear >= s.minimumCredits;

  const capped = Math.min(Math.max(0, input.annualEarningsMinor), toMinor(pack.fica.socialSecurityWageBase));
  const years = Math.min(Math.max(0, input.coveredYears), s.computationYears);
  const aimeMinor = fromStatement ? null : floorTo(Math.floor((capped * years) / (s.computationYears * MONTHS_PER_YEAR)), toMinor(s.rounding.aime));
  const piaMinor = fromStatement ? input.statementPiaMinor! : eligible ? usPia(pack, aimeMinor!) : 0;
  const monthsFromFra = claimAge * MONTHS_PER_YEAR - (fra.years * MONTHS_PER_YEAR + fra.months);
  const monthlyMinor = eligible ? adjust(piaMinor, monthsFromFra, s.earlyReduction, s.delayedCredit.percentPerMonth, toMinor(s.rounding.benefit)) : 0;
  const rules: RuleRef[] = [
    { pack: pack.version, key: "socialSecurity.bendPoints", source: s.source, value: s.bendPoints.join(" / ") },
    { pack: pack.version, key: "socialSecurity.fullRetirementAge", source: s.fullRetirementAge.source, value: `${fra.years}y ${fra.months}m` },
    { pack: pack.version, key: monthsFromFra < 0 ? "socialSecurity.earlyReduction" : "socialSecurity.delayedCredit", source: monthsFromFra < 0 ? s.earlyReduction.source : s.delayedCredit.source, value: monthsFromFra },
  ];
  return {
    eligible,
    fromStatement,
    aimeMinor,
    piaMinor,
    fullRetirementAge: fra,
    claimAge,
    startAge: claimAge,
    monthlyMinor,
    annualMinor: monthlyMinor * MONTHS_PER_YEAR,
    rules,
  };
}
