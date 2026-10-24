import { divideMinor, MINOR_PER_MAJOR } from "../../money";
import { MONTHS_PER_YEAR, WEEKS_PER_FORTNIGHT, WEEKS_PER_YEAR } from "../../dates";
import type { StudentLoanPlan, UkPack, UkRegion } from "../../packs";
import type { PayslipFinding } from "../ie/payslip";
import { ukPayroll, ukPersonalAllowance } from "./payroll";

export interface UkPayslipInput {
  taxCode: string;
  frequency: "weekly" | "fortnightly" | "monthly";
  grossPeriodMinor: number;
  incomeTaxMinor: number;
  niMinor: number;
  studentLoanMinor?: number;
  region: UkRegion;
  studentLoans: readonly StudentLoanPlan[];
  toleranceMinor: number;
}

const EMERGENCY_SUFFIX = /(W1|M1|X)$/;
const FLAT_CODES: Record<string, string> = {
  BR: "BR taxes all pay at the basic rate with no allowance: normal for a second job, wrong for your main one.",
  D0: "D0 taxes all pay at the higher rate: normal only for a second job when your main job uses your basic rate band.",
  D1: "D1 taxes all pay at the additional rate.",
  "0T": "0T gives no personal allowance: usually HMRC has no details of your previous job or your allowance is used up.",
  NT: "NT means no tax is taken. Check that this is intended.",
};

function periodsIn(frequency: UkPayslipInput["frequency"]): number {
  if (frequency === "monthly") return MONTHS_PER_YEAR;
  return frequency === "weekly" ? WEEKS_PER_YEAR : WEEKS_PER_YEAR / WEEKS_PER_FORTNIGHT;
}

/** The standard tax code for a tax year: the personal allowance without its last digit, plus L. */
export function ukStandardTaxCode(pack: UkPack, region: UkRegion): string {
  const digits = String(Math.floor(pack.incomeTax.personalAllowance)).slice(0, -1);
  return `${region === "scotland" ? "S" : ""}${digits}L`;
}

/** Checks a UK payslip's tax code, income tax, NI and student loan against the rules for the same pay all year. */
export function ukPayslipCheck(pack: UkPack, input: UkPayslipInput) {
  const periods = periodsIn(input.frequency);
  const annual = input.grossPeriodMinor * periods;
  const r = ukPayroll(pack, { grossAnnualMinor: annual, region: input.region, studentLoans: input.studentLoans });
  const expected = {
    taxCode: ukStandardTaxCode(pack, input.region),
    incomeTaxMinor: divideMinor(r.incomeTaxMinor, periods),
    niMinor: divideMinor(r.niMinor, periods),
    studentLoanMinor: divideMinor(r.studentLoanMinor, periods),
  };
  const findings: PayslipFinding[] = [];
  const tol = input.toleranceMinor;
  const code = input.taxCode.toUpperCase().replace(/\s+/g, "");
  const core = code.replace(EMERGENCY_SUFFIX, "");
  const prefix = core.match(/^[SC]/)?.[0] ?? "";
  const body = core.slice(prefix.length);

  if (EMERGENCY_SUFFIX.test(code)) {
    findings.push({ code: "emergency-code", severity: "warn", message: `${input.taxCode} is an emergency (non-cumulative) code: each payslip is taxed on its own until HMRC sends your employer a full code.` });
  }
  if (prefix === "S" && input.region !== "scotland") findings.push({ code: "region-mismatch", severity: "warn", message: "An S code means HMRC treats you as a Scottish taxpayer; your household settings say otherwise." });
  if (prefix !== "S" && input.region === "scotland") findings.push({ code: "region-mismatch", severity: "warn", message: "As a Scottish taxpayer your code should start with S; without it you pay rUK rates." });
  if (FLAT_CODES[body]) {
    findings.push({ code: `code-${body}`, severity: body === "NT" ? "info" : "warn", message: FLAT_CODES[body]! });
  } else if (body.startsWith("K")) {
    findings.push({ code: "k-code", severity: "info", message: "A K code adds to taxable pay, usually for benefits in kind or tax owed from earlier years." });
  } else {
    const n = Number(body.replace(/[A-Z]+$/, ""));
    const allowanceMinor = ukPersonalAllowance(pack, annual);
    const expectedDigits = Number(String(Math.floor(allowanceMinor / MINOR_PER_MAJOR)).slice(0, -1));
    if (Number.isFinite(n) && n < expectedDigits) {
      findings.push({ code: "code-low", severity: "info", message: `Your code allows less than the standard ${expected.taxCode}. HMRC may be collecting underpaid tax or taxing a benefit; your coding notice explains why.` });
    } else if (Number.isFinite(n) && n > expectedDigits) {
      findings.push({ code: "code-high", severity: "info", message: `Your code allows more than the standard ${expected.taxCode}, for example for marriage allowance or job expenses.` });
    }
  }

  if (Math.abs(input.incomeTaxMinor - expected.incomeTaxMinor) > tol) {
    findings.push({
      code: input.incomeTaxMinor > expected.incomeTaxMinor ? "tax-high" : "tax-low",
      severity: "warn",
      message: `Income tax differs from the ${expected.taxCode} expectation for this pay.`,
      rule: { pack: pack.version, key: "incomeTax.bands", source: pack.incomeTax.source },
    });
  }
  if (Math.abs(input.niMinor - expected.niMinor) > tol) {
    findings.push({ code: "ni-mismatch", severity: "warn", message: "National Insurance differs from the Class 1 employee rates for this pay.", rule: { pack: pack.version, key: "nationalInsurance", source: pack.nationalInsurance.source } });
  }
  const sl = input.studentLoanMinor ?? 0;
  if (Math.abs(sl - expected.studentLoanMinor) > tol) {
    findings.push({
      code: sl > expected.studentLoanMinor ? "student-loan-high" : "student-loan-low",
      severity: "warn",
      message: sl === 0 ? "No student loan deduction, though your plans and pay say there should be one." : "The student loan deduction doesn't match your plan type and pay: check the plan on your payslip.",
    });
  }
  if (findings.length === 0) findings.push({ code: "ok", severity: "ok", message: "This payslip matches the rules for your pay and tax code." });
  return {
    pack: pack.version,
    expected,
    actual: { taxCode: input.taxCode, incomeTaxMinor: input.incomeTaxMinor, niMinor: input.niMinor, studentLoanMinor: sl },
    findings,
    notes: ["Assumes the same pay every period and one job.", ...r.notes],
  };
}
