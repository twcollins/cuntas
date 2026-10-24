import { applyRate, divideMinor, formatRate } from "../../money";
import type { IsoDate } from "../../dates";
import type { IePack, RuleRef } from "../../packs";
import { iePayroll, iePrsi, payDates, type IeAssessment, type PayFrequency } from "./payroll";

export interface PayslipFinding {
  code: string;
  severity: "ok" | "info" | "warn" | "bad";
  message: string;
  rule?: RuleRef;
}

export interface IePayslipInput {
  frequency: PayFrequency;
  payDate: IsoDate;
  grossPeriodMinor: number;
  incomeTaxMinor: number;
  uscMinor: number;
  prsiMinor: number;
  assessment: IeAssessment;
  spouseGrossAnnualMinor?: number;
  age: number;
  /** Pension contribution deducted this period (reduces pay for income tax). */
  pensionPeriodMinor?: number;
  /** How far apart actual and expected may be before a difference is flagged. */
  toleranceMinor: number;
}

export interface PayslipCheckResult {
  pack: string;
  expected: { incomeTaxMinor: number; uscMinor: number; prsiMinor: number; netMinor: number };
  actual: { incomeTaxMinor: number; uscMinor: number; prsiMinor: number; netMinor: number };
  findings: PayslipFinding[];
  notes: string[];
}

/**
 * Compares one Irish payslip with what the rules expect for the same pay all year. Flags emergency tax,
 * missing credits or band, a wrong USC rate band and PRSI differences.
 */
export function iePayslipCheck(pack: IePack, input: IePayslipInput): PayslipCheckResult {
  const year = Number(pack.taxYear);
  const dates = payDates(year, input.frequency);
  const periods = dates.length;
  const annual = input.grossPeriodMinor * periods;
  const pension = (input.pensionPeriodMinor ?? 0) * periods;
  const r = iePayroll(pack, {
    grossAnnualMinor: annual,
    frequency: input.frequency,
    assessment: input.assessment,
    ...(input.spouseGrossAnnualMinor !== undefined ? { spouseGrossAnnualMinor: input.spouseGrossAnnualMinor } : {}),
    employment: "employee",
    age: input.age,
    pensionEmployeeMinor: pension,
  });
  const prsiPeriods = iePrsi(pack, annual, input.frequency);
  const period = [...prsiPeriods].reverse().find((p) => p.payDate <= input.payDate) ?? prsiPeriods[0]!;
  const expected = {
    incomeTaxMinor: divideMinor(r.incomeTaxMinor, periods),
    uscMinor: divideMinor(r.uscMinor, periods),
    prsiMinor: period.prsiMinor,
    netMinor: 0,
  };
  expected.netMinor = input.grossPeriodMinor - expected.incomeTaxMinor - expected.uscMinor - expected.prsiMinor - (input.pensionPeriodMinor ?? 0);
  const actual = {
    incomeTaxMinor: input.incomeTaxMinor,
    uscMinor: input.uscMinor,
    prsiMinor: input.prsiMinor,
    netMinor: input.grossPeriodMinor - input.incomeTaxMinor - input.uscMinor - input.prsiMinor - (input.pensionPeriodMinor ?? 0),
  };

  const tol = input.toleranceMinor;
  const findings: PayslipFinding[] = [];
  const it = pack.incomeTax;
  const taxablePeriod = input.grossPeriodMinor - (input.pensionPeriodMinor ?? 0);
  const emergencyTax = applyRate(taxablePeriod, it.rates.higher);
  const topUsc = pack.usc.bands[pack.usc.bands.length - 1]!.rate;
  const emergencyUsc = applyRate(input.grossPeriodMinor, topUsc);

  if (actual.incomeTaxMinor >= emergencyTax - tol && expected.incomeTaxMinor < emergencyTax - tol) {
    findings.push({
      code: "emergency-tax",
      severity: "bad",
      message: "Income tax is at the higher rate on all pay with no credits: this looks like emergency tax. Register the job in Revenue's myAccount so your employer gets your credits and band.",
      rule: { pack: pack.version, key: "incomeTax.rates.higher", source: it.source, value: it.rates.higher },
    });
  } else if (actual.incomeTaxMinor > expected.incomeTaxMinor + tol) {
    findings.push({
      code: "tax-high",
      severity: "warn",
      message: "Income tax is higher than expected. Your tax credits or standard rate band may not be allocated to this job: check your Tax Credit Certificate in myAccount.",
      rule: { pack: pack.version, key: "incomeTax.credits", source: it.source },
    });
  } else if (actual.incomeTaxMinor < expected.incomeTaxMinor - tol) {
    findings.push({
      code: "tax-low",
      severity: "info",
      message: "Income tax is lower than expected. That is fine if you have credits Cúntas doesn't know about (rent, medical, a dependent relative); otherwise you may owe tax at year end.",
    });
  }

  if (actual.uscMinor >= emergencyUsc - tol && expected.uscMinor < emergencyUsc - tol) {
    findings.push({
      code: "emergency-usc",
      severity: "bad",
      message: "USC is at the top rate on all pay: the employer has no Revenue Payroll Notification for you (emergency basis).",
      rule: { pack: pack.version, key: "usc.bands", source: pack.usc.source, value: topUsc },
    });
  } else if (actual.uscMinor > expected.uscMinor + tol) {
    findings.push({
      code: "usc-band",
      severity: "warn",
      message: "USC is higher than expected: the USC rate bands on your payroll notification may be wrong or not yet allocated to this job.",
      rule: { pack: pack.version, key: "usc.bands", source: pack.usc.source },
    });
  } else if (actual.uscMinor < expected.uscMinor - tol) {
    findings.push({ code: "usc-low", severity: "info", message: "USC is lower than expected. Check whether you hold a medical card or are over 70, which reduce USC." });
  }

  if (Math.abs(actual.prsiMinor - expected.prsiMinor) > tol) {
    findings.push({
      code: "prsi-mismatch",
      severity: "warn",
      message: `PRSI differs from the Class A1 rate in force on ${input.payDate} (${formatRate(period.rate)}, after any PRSI credit).`,
      rule: { pack: pack.version, key: "prsi.classA1", source: pack.prsi.source, value: period.rate },
    });
  }

  if (findings.length === 0) findings.push({ code: "ok", severity: "ok", message: "This payslip matches the rules for your pay, credits and band." });
  const notes = ["Assumes the same pay every period, one job, and credits and bands spread evenly (the cumulative basis)."];
  return { pack: pack.version, expected, actual, findings, notes };
}
