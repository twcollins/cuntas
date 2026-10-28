import {
  ageOn,
  applyRate,
  chartDefaults,
  COUNTRY_INFO,
  ieStatePensionEstimate,
  latestWith,
  myFutureFundStatus,
  packOn,
  projectRetirement,
  realRate,
  ukStatePensionEstimate,
  usFullRetirementAge,
  usSocialSecurityEstimate,
  type Currency,
  type IsoDate,
  type RetirementMember,
  type RuleRef,
} from "@cuntas/rules";
import { FxTable } from "./fx";
import type { Dataset, Member } from "./schema";
import { residenceOn } from "./snapshot";

const STATE_KINDS = new Set(["statePensionIE", "statePensionUK"]);
/** Pre-tax US plans whose money can be converted to Roth. */
const US_PRETAX = new Set(["us401k", "usIRA"]);
/** Without a count of covered years, a US resident is assumed to have worked since this age. */
const US_WORK_FROM_AGE = 22;
/** Projections run until the youngest member reaches this age. */
const HORIZON_AGE = 95;

export interface RetirementOptions {
  nominalReturn?: number;
  inflation?: number;
  withdrawalRate?: number;
}

/**
 * A member's Social Security estimate: their SSA statement figure if given, else today's pay for each
 * year of US work (past years as entered, or since 22 for a US resident; future years while working
 * here until retiring or claiming). `claimAge` overrides the member's chosen age.
 */
export function usSocialSecurityFor(ds: Dataset, m: Member, asOf: IsoDate, claimAge?: number) {
  const pack = latestWith("US", "socialSecurity", asOf);
  if (!pack) return null;
  const age = ageOn(m.dateOfBirth, asOf);
  const residence = residenceOn(ds, m.id, asOf);
  const working = m.employmentType === "employee" || m.employmentType === "selfEmployed";
  const fra = usFullRetirementAge(pack, m.dateOfBirth).years;
  const claim = claimAge ?? m.usClaimAge ?? fra;
  const retirementAge = m.retirementAge ?? (residence === "US" ? fra : packOn("IE", asOf).pension.statePensionAge);
  const here = residence === "US";
  const pastYears = m.usCoveredYears ?? (here ? Math.max(0, age - US_WORK_FROM_AGE) : 0);
  const coveredYears = pastYears + (here && working ? Math.max(0, Math.min(retirementAge, claim) - age) : 0);
  const est = usSocialSecurityEstimate(pack, { dateOfBirth: m.dateOfBirth, claimAge: claim, annualEarningsMinor: here && working ? m.grossAnnualMinor : 0, coveredYears, statementPiaMinor: m.usSsStatementMinor });
  return { ...est, coveredYears, assumedYears: m.usCoveredYears === null && here, pack: pack.version };
}

/** Builds each member's pots, contributions and State Pension estimates, then projects them in today's money. */
export function retirementPlan(ds: Dataset, asOf: IsoDate, opts: RetirementOptions = {}) {
  const pj = chartDefaults().projections;
  const nominal = opts.nominalReturn ?? pj.nominalReturn;
  const inflation = opts.inflation ?? pj.inflation;
  const withdrawalRate = opts.withdrawalRate ?? pj.withdrawalRate;
  const fx = new FxTable(ds.fxRates);
  const base = ds.household.baseCurrency;
  const toBase = (minor: number, from: Currency) => fx.tryConvert(minor, from, base, asOf) ?? minor;
  const iePack = latestWith("IE", "statePension", asOf);
  const ukPack = latestWith("UK", "statePension", asOf);
  const iePayPack = packOn("IE", asOf);
  const usPack = latestWith("US", "socialSecurity", asOf);
  const notes: string[] = [];
  const rules: RuleRef[] = [];

  const members: RetirementMember[] = ds.members.map((m) => {
    const age = ageOn(m.dateOfBirth, asOf);
    const residence = residenceOn(ds, m.id, asOf);
    const ieSpa = iePayPack.pension.statePensionAge;
    const usFra = usPack ? usFullRetirementAge(usPack, m.dateOfBirth).years : ieSpa;
    const retirementAge = m.retirementAge ?? (residence === "US" ? usFra : ieSpa);
    const working = m.employmentType === "employee" || m.employmentType === "selfEmployed";
    const plans = ds.pensionPlans.filter((p) => p.memberId === m.id && !STATE_KINDS.has(p.kind));
    const potMinor = plans.reduce((a, p) => a + toBase(p.valueMinor, p.currency), 0);
    const grossBase = toBase(m.grossAnnualMinor, COUNTRY_INFO[residence].currency);
    let rate = plans.reduce((a, p) => a + p.employeeRate + p.employerRate, 0);
    const employer = plans.some((p) => p.isEmployerScheme);
    if (residence === "IE" && myFutureFundStatus(iePayPack, { age, grossAnnualMinor: m.grossAnnualMinor, inQualifyingScheme: employer, optedOut: m.myFutureFundOptedOut }) === "auto-enrolled") {
      const r = iePayPack.myFutureFund.rates;
      rate += r.employee + r.employer + r.state;
    }
    const statePensions: RetirementMember["statePensions"] = [];
    const yearsUntil = (spa: number) => (working ? Math.max(0, Math.min(retirementAge, spa) - age) : 0);
    if (iePack) {
      const years = (m.ieContributionYears ?? 0) + (residence === "IE" ? yearsUntil(ieSpa) : 0);
      const est = ieStatePensionEstimate(iePack, { contributionYears: years });
      if (est.annualMinor > 0) statePensions.push({ jurisdiction: "IE", annualMinor: toBase(est.annualMinor, "EUR"), startAge: est.startAge });
      if (m.ieContributionYears === null) notes.push(`${m.name}: enter Irish PRSI contribution years in Household for a better State Pension estimate.`);
    }
    if (ukPack) {
      const spa = ukPack.statePension?.pensionAge ?? ieSpa;
      const years = (m.ukQualifyingYears ?? 0) + (residence === "UK" ? yearsUntil(spa) : 0);
      const est = ukStatePensionEstimate(ukPack, { qualifyingYears: years });
      if (est.annualMinor > 0) statePensions.push({ jurisdiction: "UK", annualMinor: toBase(est.annualMinor, "GBP"), startAge: est.startAge ?? spa });
    }
    // US Social Security for anyone who lives or has worked in the US, or has an SSA statement.
    if (usPack && (residence === "US" || (m.usCoveredYears ?? 0) > 0 || m.usSsStatementMinor)) {
      const est = usSocialSecurityFor(ds, m, asOf)!;
      const claimAge = est.claimAge;
      if (est.annualMinor > 0) statePensions.push({ jurisdiction: "US", annualMinor: toBase(est.annualMinor, "USD"), startAge: est.startAge });
      if (!m.usSsStatementMinor && residence !== "US")
        notes.push(`${m.name}: Social Security needs your US earnings record; enter the benefit at full retirement age from your SSA statement (ssa.gov).`);
      else if (!m.usSsStatementMinor && m.usCoveredYears === null)
        notes.push(`${m.name}: for a better Social Security estimate, enter years of US work or the benefit at full retirement age from your SSA statement (ssa.gov).`);
      if (retirementAge < claimAge && plans.some((p) => US_PRETAX.has(p.kind) && p.valueMinor > 0))
        notes.push(`${m.name}: the years between retiring at ${retirementAge} and Social Security at ${claimAge} often have low taxable income. Converting some traditional IRA or 401(k) money to Roth in those years is taxed at those rates, and Roth money isn't counted in required minimum distributions.`);
    }
    return {
      id: m.id,
      name: m.name,
      age,
      retirementAge,
      potMinor,
      annualContributionMinor: working && age < retirementAge ? applyRate(grossBase, rate) : 0,
      statePensions,
    };
  });
  if (iePack?.statePension) rules.push({ pack: iePack.version, key: "statePension", source: iePack.statePension.source, value: iePack.statePension.maxWeeklyContributory });
  if (ukPack?.statePension) rules.push({ pack: ukPack.version, key: "statePension", source: ukPack.statePension.source, value: ukPack.statePension.fullWeekly });
  if (usPack?.socialSecurity && members.some((m) => m.statePensions.some((s) => s.jurisdiction === "US")))
    rules.push({ pack: usPack.version, key: "socialSecurity", source: usPack.socialSecurity.source, value: usPack.socialSecurity.bendPoints.join(" / ") });

  const real = realRate(nominal, inflation);
  const scenarios = [
    { id: "low", label: "Lower returns", realReturn: real - pj.scenarioSpread },
    { id: "central", label: "Central", realReturn: real },
    { id: "high", label: "Higher returns", realReturn: real + pj.scenarioSpread },
  ];
  const youngest = Math.min(...members.map((m) => m.age), HORIZON_AGE);
  const projections = members.length ? projectRetirement({ members, scenarios, withdrawalRate, horizonYears: HORIZON_AGE - youngest }) : [];
  return { members, projections, assumptions: { nominal, inflation, real, withdrawalRate }, currency: base, notes, rules };
}
