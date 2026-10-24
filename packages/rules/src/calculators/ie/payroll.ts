import { applyRate, formatMoney, formatRate, splitEvenly, sumMinor, toMinor } from "../../money";
import {
  DAYS_PER_WEEK,
  FRIDAY,
  MONTHS_PER_YEAR,
  WEEKS_PER_FORTNIGHT,
  WEEKS_PER_YEAR,
  addDays,
  lastDayOfMonth,
  parseIso,
  type IsoDate,
} from "../../dates";
import { onDate, type ExplainedLine, type IePack, type RuleRef } from "../../packs";
import { bandedTax } from "../shared";
import { pensionReliefLimit } from "./pensionRelief";
import { myFutureFundContributions } from "./myFutureFund";
import { ieClassS } from "./selfEmployed";

export type PayFrequency = "weekly" | "fortnightly" | "monthly";
export type IeAssessment = "single" | "oneParent" | "marriedOneIncome" | "marriedTwoIncomes";

export interface IePayrollInput {
  grossAnnualMinor: number;
  frequency: PayFrequency;
  assessment: IeAssessment;
  /** Spouse or civil partner's gross income, for joint assessment with two incomes. */
  spouseGrossAnnualMinor?: number;
  employment: "employee" | "selfEmployed";
  age: number;
  /** Personal pension contributions made through payroll this year (relievable up to the age-band limit). */
  pensionEmployeeMinor?: number;
  myFutureFund?: boolean;
  /** Annual rent paid, for the rent tax credit. */
  rentPaidMinor?: number;
}

export interface PrsiPeriod {
  payDate: IsoDate;
  grossMinor: number;
  rate: number;
  creditMinor: number;
  prsiMinor: number;
}

export interface IePayrollResult {
  pack: string;
  packStatus: IePack["status"];
  taxYear: string;
  grossMinor: number;
  taxableMinor: number;
  pensionRelievedMinor: number;
  incomeTaxMinor: number;
  uscMinor: number;
  prsiMinor: number;
  myFutureFund: { employeeMinor: number; employerMinor: number; stateMinor: number };
  pensionEmployeeMinor: number;
  netAnnualMinor: number;
  netPerPeriodMinor: number;
  periods: number;
  marginalRate: number;
  prsiPeriods: PrsiPeriod[];
  lines: ExplainedLine[];
  notes: string[];
}

function ref(pack: IePack, key: string, source: string, value?: number | string): RuleRef {
  return { pack: pack.version, key, source, ...(value !== undefined ? { value } : {}) };
}

/** Pay dates in a calendar year: month-ends, or Fridays for weekly and fortnightly pay. */
export function payDates(year: number, frequency: PayFrequency): IsoDate[] {
  if (frequency === "monthly") {
    return Array.from({ length: MONTHS_PER_YEAR }, (_, m) => lastDayOfMonth(year, m));
  }
  let d = `${year}-01-01`;
  while (parseIso(d).getUTCDay() !== FRIDAY) d = addDays(d, 1);
  const step = frequency === "weekly" ? DAYS_PER_WEEK : DAYS_PER_WEEK * WEEKS_PER_FORTNIGHT;
  const dates: IsoDate[] = [];
  for (; d.startsWith(String(year)); d = addDays(d, step)) dates.push(d);
  return dates;
}

function weeksIn(frequency: PayFrequency): number {
  if (frequency === "weekly") return 1;
  if (frequency === "fortnightly") return WEEKS_PER_FORTNIGHT;
  return WEEKS_PER_YEAR / MONTHS_PER_YEAR;
}

/** Class A1 PRSI, applying the rate in force on each pay date plus the weekly exemption and PRSI credit. */
export function iePrsi(pack: IePack, grossAnnualMinor: number, frequency: PayFrequency): PrsiPeriod[] {
  const year = Number(pack.taxYear);
  const dates = payDates(year, frequency);
  const pay = splitEvenly(grossAnnualMinor, dates.length);
  const weeks = weeksIn(frequency);
  const threshold = toMinor(pack.prsi.weeklyExemptionThreshold);
  const upper = toMinor(pack.prsi.credit.upperWeeklyThreshold);
  const maxCredit = toMinor(pack.prsi.credit.maxWeekly);

  return dates.map((payDate, i) => {
    const grossMinor = pay[i]!;
    const { rate } = onDate(pack.prsi.classA1, payDate);
    const weekly = grossMinor / weeks;
    if (weekly <= threshold) return { payDate, grossMinor, rate, creditMinor: 0, prsiMinor: 0 };
    let creditMinor = 0;
    if (weekly <= upper) {
      const weeklyCredit = Math.max(0, maxCredit - (weekly - threshold) / pack.prsi.credit.taperDivisor);
      creditMinor = Math.round(weeklyCredit * weeks);
    }
    const prsiMinor = Math.max(0, applyRate(grossMinor, rate) - creditMinor);
    return { payDate, grossMinor, rate, creditMinor, prsiMinor };
  });
}

/** Universal Social Charge on total income, with the exemption threshold and self-employed surcharge. */
export function ieUsc(
  pack: IePack,
  incomeMinor: number,
  selfEmployedIncomeMinor = 0,
): { amountMinor: number; lines: ExplainedLine[] } {
  const src = pack.usc.source;
  if (incomeMinor <= toMinor(pack.usc.exemptionThreshold)) {
    return {
      amountMinor: 0,
      lines: [
        {
          label: "USC exempt: total income at or below threshold",
          amountMinor: 0,
          rule: ref(pack, "usc.exemptionThreshold", src, pack.usc.exemptionThreshold),
        },
      ],
    };
  }
  const bands = pack.usc.bands.map((b) => ({ upToMinor: b.upTo === null ? null : toMinor(b.upTo), rate: b.rate }));
  const banded = bandedTax(incomeMinor, bands);
  const lines: ExplainedLine[] = banded.map((b, i) => ({
    label: `USC ${formatRate(b.rate)} on band ${i + 1}`,
    amountMinor: b.taxMinor,
    rule: ref(pack, `usc.bands[${i}]`, src, b.rate),
    detail: `on ${formatMoney(b.portionMinor, "EUR")}`,
  }));
  let amountMinor = sumMinor(banded.map((b) => b.taxMinor));

  const surcharge = pack.usc.selfEmployedSurcharge;
  const surchargeBase = Math.max(0, Math.min(selfEmployedIncomeMinor, incomeMinor - toMinor(surcharge.above)));
  if (surchargeBase > 0) {
    const top = pack.usc.bands[pack.usc.bands.length - 1]!.rate;
    const extra = applyRate(surchargeBase, surcharge.rate - top);
    amountMinor += extra;
    lines.push({
      label: "USC self-employed surcharge",
      amountMinor: extra,
      rule: ref(pack, "usc.selfEmployedSurcharge", src, surcharge.rate),
    });
  }
  return { amountMinor, lines };
}

/** The standard-rate band for an assessment; with two incomes it grows by the lower income, up to the maximum. */
export function standardBandMinor(pack: IePack, input: Pick<IePayrollInput, "assessment" | "grossAnnualMinor" | "spouseGrossAnnualMinor">): number {
  const band = pack.incomeTax.standardRateBand;
  switch (input.assessment) {
    case "single":
      return toMinor(band.single);
    case "oneParent":
      return toMinor(band.oneParent);
    case "marriedOneIncome":
      return toMinor(band.marriedOneIncome);
    case "marriedTwoIncomes": {
      const increaseMax = toMinor(band.marriedTwoIncomesMax - band.marriedOneIncome);
      const lower = Math.min(input.grossAnnualMinor, input.spouseGrossAnnualMinor ?? 0);
      return toMinor(band.marriedOneIncome) + Math.min(increaseMax, lower);
    }
  }
}

/** Irish take-home pay for one tax year: income tax, USC, PRSI by pay date, pension and MyFutureFund. */
export function iePayroll(pack: IePack, input: IePayrollInput): IePayrollResult {
  const notes: string[] = [];
  const lines: ExplainedLine[] = [];
  const it = pack.incomeTax;
  const gross = input.grossAnnualMinor;
  const married = input.assessment === "marriedOneIncome" || input.assessment === "marriedTwoIncomes";
  const joint = input.assessment === "marriedTwoIncomes";
  const spouseGross = joint ? (input.spouseGrossAnnualMinor ?? 0) : 0;

  // Pension contributions reduce income for income tax only, up to the age-band limit.
  const pensionEmployeeMinor = input.pensionEmployeeMinor ?? 0;
  const limit = pensionReliefLimit(pack, input.age, gross);
  const pensionRelievedMinor = Math.min(pensionEmployeeMinor, limit.limitMinor);
  if (pensionEmployeeMinor > pensionRelievedMinor) {
    notes.push("Pension contributions above your age-band limit get no income tax relief this year.");
  }
  const taxableMinor = gross - pensionRelievedMinor;
  const householdTaxable = taxableMinor + spouseGross;

  const bandMinor = standardBandMinor(pack, input);
  const banded = bandedTax(householdTaxable, [
    { upToMinor: bandMinor, rate: it.rates.standard },
    { upToMinor: null, rate: it.rates.higher },
  ]);
  const grossTax = sumMinor(banded.map((b) => b.taxMinor));
  lines.push({
    label: `Income tax at ${formatRate(it.rates.standard)} on first band`,
    amountMinor: banded[0]?.taxMinor ?? 0,
    rule: ref(pack, `incomeTax.standardRateBand.${input.assessment === "marriedTwoIncomes" ? "marriedTwoIncomesMax" : input.assessment}`, it.source, formatMoney(bandMinor, "EUR", { decimals: false })),
  });
  lines.push({
    label: `Income tax at ${formatRate(it.rates.higher)} above band`,
    amountMinor: banded[1]?.taxMinor ?? 0,
    rule: ref(pack, "incomeTax.rates.higher", it.source, it.rates.higher),
  });

  const personal = toMinor(married ? it.credits.personalMarried : it.credits.personalSingle);
  const workCredit = toMinor(input.employment === "employee" ? it.credits.employee : it.credits.earnedIncome);
  // Under joint assessment each working spouse has their own employee credit.
  const workCredits = joint && spouseGross > 0 ? workCredit + workCredit : workCredit;
  const rentMax = toMinor(married ? it.credits.rentCoupleMax : it.credits.rentSingleMax);
  const rentCredit = input.rentPaidMinor ? Math.min(rentMax, applyRate(input.rentPaidMinor, it.credits.rentRate)) : 0;
  const credits = personal + workCredits + rentCredit;
  lines.push({
    label: married ? "Personal tax credit (married)" : "Personal tax credit",
    amountMinor: -personal,
    rule: ref(pack, married ? "incomeTax.credits.personalMarried" : "incomeTax.credits.personalSingle", it.source),
  });
  lines.push({
    label: input.employment === "employee" ? "Employee (PAYE) tax credit" : "Earned income tax credit",
    amountMinor: -workCredits,
    rule: ref(pack, input.employment === "employee" ? "incomeTax.credits.employee" : "incomeTax.credits.earnedIncome", it.source),
  });
  if (rentCredit > 0) {
    lines.push({ label: "Rent tax credit", amountMinor: -rentCredit, rule: ref(pack, "incomeTax.credits.rentSingleMax", it.source) });
  }

  const householdTax = Math.max(0, grossTax - credits);
  // Joint assessment: apportion tax by income share so each member sees their own take-home.
  const incomeTaxMinor = joint && householdTaxable > 0
    ? Math.round((householdTax * taxableMinor) / householdTaxable)
    : householdTax;
  if (joint) notes.push("Joint assessment: income tax is shown apportioned by share of income.");

  const usc = ieUsc(pack, gross, input.employment === "selfEmployed" ? gross : 0);
  lines.push(...usc.lines);

  let prsiPeriods: PrsiPeriod[] = [];
  let prsiMinor: number;
  if (input.employment === "employee") {
    prsiPeriods = iePrsi(pack, gross, input.frequency);
    prsiMinor = sumMinor(prsiPeriods.map((p) => p.prsiMinor));
    const rates = [...new Set(prsiPeriods.map((p) => p.rate))];
    lines.push({
      label: `PRSI Class A1 by pay date (${rates.map(formatRate).join(" then ")})`,
      amountMinor: prsiMinor,
      rule: ref(pack, "prsi.classA1", pack.prsi.source),
    });
  } else {
    const classS = ieClassS(pack, gross);
    prsiMinor = classS.amountMinor;
    lines.push(...classS.lines);
    notes.push(...classS.notes);
  }

  const mff = input.myFutureFund
    ? myFutureFundContributions(pack, gross)
    : { employeeMinor: 0, employerMinor: 0, stateMinor: 0 };
  if (input.myFutureFund) {
    lines.push({
      label: "MyFutureFund employee contribution (no tax relief)",
      amountMinor: mff.employeeMinor,
      rule: ref(pack, "myFutureFund.rates.employee", pack.myFutureFund.source),
    });
  }
  if (pensionEmployeeMinor > 0) {
    lines.push({
      label: "Pension contribution",
      amountMinor: pensionEmployeeMinor,
      rule: ref(pack, "pension.ageBands", pack.pension.source),
    });
  }

  const netAnnualMinor = gross - incomeTaxMinor - usc.amountMinor - prsiMinor - mff.employeeMinor - pensionEmployeeMinor;
  const periods = payDates(Number(pack.taxYear), input.frequency).length;
  const marginalRate = householdTax === 0 ? 0 : householdTaxable > bandMinor ? it.rates.higher : it.rates.standard;

  return {
    pack: pack.version,
    packStatus: pack.status,
    taxYear: pack.taxYear,
    grossMinor: gross,
    taxableMinor,
    pensionRelievedMinor,
    incomeTaxMinor,
    uscMinor: usc.amountMinor,
    prsiMinor,
    myFutureFund: mff,
    pensionEmployeeMinor,
    netAnnualMinor,
    netPerPeriodMinor: Math.round(netAnnualMinor / periods),
    periods,
    marginalRate,
    prsiPeriods,
    lines,
    notes,
  };
}
