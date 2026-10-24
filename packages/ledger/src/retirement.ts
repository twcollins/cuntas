import {
  ageOn,
  applyRate,
  chartDefaults,
  ieStatePensionEstimate,
  latestWith,
  myFutureFundStatus,
  packOn,
  projectRetirement,
  realRate,
  ukStatePensionEstimate,
  type IsoDate,
  type RetirementMember,
  type RuleRef,
} from "@cuntas/rules";
import { FxTable } from "./fx";
import type { Dataset } from "./schema";
import { residenceOn } from "./snapshot";

const STATE_KINDS = new Set(["statePensionIE", "statePensionUK"]);
/** Projections run until the youngest member reaches this age. */
const HORIZON_AGE = 95;

export interface RetirementOptions {
  nominalReturn?: number;
  inflation?: number;
  withdrawalRate?: number;
}

/** Builds each member's pots, contributions and State Pension estimates, then projects them in today's money. */
export function retirementPlan(ds: Dataset, asOf: IsoDate, opts: RetirementOptions = {}) {
  const pj = chartDefaults().projections;
  const nominal = opts.nominalReturn ?? pj.nominalReturn;
  const inflation = opts.inflation ?? pj.inflation;
  const withdrawalRate = opts.withdrawalRate ?? pj.withdrawalRate;
  const fx = new FxTable(ds.fxRates);
  const base = ds.household.baseCurrency;
  const toBase = (minor: number, from: "EUR" | "GBP") => fx.tryConvert(minor, from, base, asOf) ?? minor;
  const iePack = latestWith("IE", "statePension", asOf);
  const ukPack = latestWith("UK", "statePension", asOf);
  const iePayPack = packOn("IE", asOf);
  const notes: string[] = [];
  const rules: RuleRef[] = [];

  const members: RetirementMember[] = ds.members.map((m) => {
    const age = ageOn(m.dateOfBirth, asOf);
    const residence = residenceOn(ds, m.id, asOf);
    const ieSpa = iePayPack.pension.statePensionAge;
    const retirementAge = m.retirementAge ?? ieSpa;
    const working = m.employmentType === "employee" || m.employmentType === "selfEmployed";
    const plans = ds.pensionPlans.filter((p) => p.memberId === m.id && !STATE_KINDS.has(p.kind));
    const potMinor = plans.reduce((a, p) => a + toBase(p.valueMinor, p.currency), 0);
    const grossBase = toBase(m.grossAnnualMinor, residence === "UK" ? "GBP" : "EUR");
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
