import { applyRate, sumMinor, toMinor } from "../../money";
import { WEEKS_PER_YEAR } from "../../dates";
import type { IePack, RuleRef, UkPack } from "../../packs";

/** Irish State Pension (Contributory) in today's money, pro rata to contribution years (total contributions approach). */
export function ieStatePensionEstimate(pack: IePack, input: { contributionYears: number }) {
  const sp = pack.statePension;
  if (!sp) throw new Error(`Rule pack ${pack.version} has no State Pension data`);
  const years = Math.min(input.contributionYears, sp.contributionYearsForMax);
  const eligible = input.contributionYears >= sp.minimumContributionYears;
  const weeklyMinor = eligible ? Math.round((toMinor(sp.maxWeeklyContributory) * years) / sp.contributionYearsForMax) : 0;
  return {
    eligible,
    weeklyMinor,
    annualMinor: weeklyMinor * WEEKS_PER_YEAR,
    startAge: pack.pension.statePensionAge,
    rule: { pack: pack.version, key: "statePension", source: sp.source, value: sp.maxWeeklyContributory } as RuleRef,
  };
}

/** UK new State Pension in today's money, pro rata to qualifying years. */
export function ukStatePensionEstimate(pack: UkPack, input: { qualifyingYears: number }) {
  const sp = pack.statePension;
  if (!sp) throw new Error(`Rule pack ${pack.version} has no State Pension data`);
  const years = Math.min(input.qualifyingYears, sp.qualifyingYearsForFull);
  const eligible = input.qualifyingYears >= sp.minimumQualifyingYears;
  const weeklyMinor = eligible ? Math.round((toMinor(sp.fullWeekly) * years) / sp.qualifyingYearsForFull) : 0;
  return {
    eligible,
    weeklyMinor,
    annualMinor: weeklyMinor * WEEKS_PER_YEAR,
    startAge: sp.pensionAge ?? null,
    rule: { pack: pack.version, key: "statePension", source: sp.source, value: sp.fullWeekly } as RuleRef,
  };
}

export interface RetirementMember {
  id: string;
  name: string;
  age: number;
  retirementAge: number;
  /** Pension pots and other retirement savings, in the household's base currency. */
  potMinor: number;
  annualContributionMinor: number;
  /** State pensions in today's money, base currency. */
  statePensions: { jurisdiction: "IE" | "UK"; annualMinor: number; startAge: number }[];
}

export interface RetirementScenario {
  id: string;
  label: string;
  /** Return above inflation. */
  realReturn: number;
}

export interface RetirementProjection {
  scenario: RetirementScenario;
  members: {
    id: string;
    potAtRetirementMinor: number;
    drawdownAnnualMinor: number;
    statePensionAnnualMinor: number;
    /** Income in the first year when every income source has started. */
    fullIncomeAnnualMinor: number;
  }[];
  householdAnnualMinor: number;
  /** Household income by year from now, in today's money. */
  series: { year: number; potMinor: number; incomeMinor: number }[];
}

/**
 * Projects pots to each member's retirement age in real terms and turns them into income at a fixed
 * withdrawal rate, alongside State Pensions from their start age.
 */
export function projectRetirement(input: { members: RetirementMember[]; scenarios: RetirementScenario[]; withdrawalRate: number; horizonYears: number }): RetirementProjection[] {
  return input.scenarios.map((scenario) => {
    const series: RetirementProjection["series"] = [];
    const pots = input.members.map((m) => m.potMinor);
    const atRetirement = input.members.map((): number | null => null);
    for (let year = 0; year <= input.horizonYears; year++) {
      let income = 0;
      input.members.forEach((m, i) => {
        const age = m.age + year;
        const start = atRetirement[i];
        if (year > 0) {
          // A working year adds growth and contributions; a retired year adds growth and pays the drawdown.
          if (start === null || start === undefined) pots[i] = pots[i]! + applyRate(pots[i]!, scenario.realReturn) + m.annualContributionMinor;
          else pots[i] = Math.max(0, pots[i]! + applyRate(pots[i]!, scenario.realReturn) - applyRate(start, input.withdrawalRate));
        }
        if (age >= m.retirementAge) {
          if (atRetirement[i] === null) atRetirement[i] = pots[i]!;
          if (pots[i]! > 0) income += applyRate(atRetirement[i]!, input.withdrawalRate);
        }
        income += sumMinor(m.statePensions.filter((s) => age >= s.startAge).map((s) => s.annualMinor));
      });
      series.push({ year, potMinor: sumMinor(pots), incomeMinor: income });
    }
    const members = input.members.map((m, i) => {
      const potAtRetirementMinor = m.age >= m.retirementAge ? m.potMinor : potAt(m, scenario.realReturn);
      const drawdownAnnualMinor = applyRate(potAtRetirementMinor, input.withdrawalRate);
      const statePensionAnnualMinor = sumMinor(m.statePensions.map((s) => s.annualMinor));
      return { id: m.id, potAtRetirementMinor, drawdownAnnualMinor, statePensionAnnualMinor, fullIncomeAnnualMinor: drawdownAnnualMinor + statePensionAnnualMinor, index: i };
    });
    return {
      scenario,
      members: members.map(({ index: _index, ...rest }) => rest),
      householdAnnualMinor: sumMinor(members.map((m) => m.fullIncomeAnnualMinor)),
      series,
    };
  });
}

function potAt(m: RetirementMember, realReturn: number): number {
  let pot = m.potMinor;
  for (let age = m.age + 1; age <= m.retirementAge; age++) pot = pot + applyRate(pot, realReturn) + m.annualContributionMinor;
  return pot;
}

/** Converts a nominal return to a real one: (1 + nominal) / (1 + inflation) - 1. */
export function realRate(nominal: number, inflation: number): number {
  return (1 + nominal) / (1 + inflation) - 1;
}
