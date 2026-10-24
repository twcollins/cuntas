import { describe, expect, it } from "vitest";
import {
  compareWrappers,
  getPack,
  ieClassS,
  iePayroll,
  iePayslipCheck,
  ieSelfAssessment,
  ieStatePensionEstimate,
  projectRetirement,
  realRate,
  regionPackFor,
  toMinor,
  ukAnnualAllowance,
  ukPayroll,
  ukPayslipCheck,
  ukStandardTaxCode,
  ukStatePensionEstimate,
  ukStudentLoanRepayment,
  type WrapperComparisonInput,
} from "../src";

const ie26 = getPack("IE", "2026");
const ie27 = getPack("IE", "2027");
const uk26 = getPack("UK", "2026-27");
const uk27 = getPack("UK", "2027-28");

describe("IE Class S PRSI", () => {
  it("applies the October rate change month by month", () => {
    // 9 months at 4.2% and 3 at 4.35% of EUR 4,166.67: 9 x 175.00 + 3 x 181.25
    expect(ieClassS(ie26, toMinor(50000)).amountMinor).toBe(211875);
    // EUR 5,000 a month: 9 x 217.50 + 3 x 225.00
    expect(ieClassS(ie27, toMinor(60000)).amountMinor).toBe(263250);
  });
  it("charges the minimum contribution above the threshold, nothing at or below it", () => {
    expect(ieClassS(ie26, toMinor(6000)).amountMinor).toBe(toMinor(650));
    expect(ieClassS(ie26, toMinor(5000)).amountMinor).toBe(0);
  });
  it("is used by take-home pay for the self-employed", () => {
    const r = iePayroll(ie26, { grossAnnualMinor: toMinor(50000), frequency: "monthly", assessment: "single", employment: "selfEmployed", age: 40 });
    expect(r.prsiMinor).toBe(211875);
    expect(r.notes.join(" ")).not.toMatch(/not modelled/);
  });
});

describe("IE self-assessment (Form 11)", () => {
  const r = ieSelfAssessment(ie27, { tradingProfitMinor: toMinor(60000), assessment: "single", age: 40, priorYearLiabilityMinor: toMinor(12000), preliminaryPaidMinor: toMinor(11000) });
  it("computes income tax, USC and Class S on trading profit", () => {
    expect(r.incomeTaxMinor).toBe(toMinor(10450)); // 9,300 + 5,400 - 2,125 personal - 2,125 earned income
    expect(r.uscMinor).toBe(131682); // 60.06 + 365.76 + 891.00
    expect(r.prsiMinor).toBe(263250);
    expect(r.liabilityMinor).toBe(1439932);
  });
  it("finds the lowest safe preliminary tax and any shortfall", () => {
    expect(r.preliminaryThisYear.requiredMinor).toBe(toMinor(12000)); // 100% of last year beats 90% of this year
    expect(r.preliminaryThisYear.shortfallMinor).toBe(toMinor(1000));
    expect(r.balanceDueMinor).toBe(339932);
    expect(r.preliminaryNextYear.minimumMinor).toBe(toMinor(12600)); // 105% of last year, by direct debit
    expect(r.setAsideMonthlyMinor).toBe(119994);
  });
  it("lists the 31 October deadlines", () => {
    expect(r.deadlines.map((d) => d.date)).toEqual(["2027-10-31", "2028-10-31"]); // preliminary for 2027; return and balance for 2027 a year later
  });
  it("adds the USC surcharge on self-employed income over EUR 100,000", () => {
    const high = ieSelfAssessment(ie27, { tradingProfitMinor: toMinor(120000), assessment: "single", age: 40 });
    expect(high.uscMinor).toBe(621462); // 5,614.62 + 3% of 20,000
  });
});

describe("UK student loans", () => {
  it("repays 9% above the plan threshold", () => {
    expect(ukStudentLoanRepayment(uk26, { incomeMinor: toMinor(40000), plans: ["plan2"] }).totalMinor).toBe(95535);
  });
  it("uses the lowest threshold for several undergraduate plans and adds postgraduate on top", () => {
    expect(ukStudentLoanRepayment(uk26, { incomeMinor: toMinor(40000), plans: ["plan1", "plan2"] }).totalMinor).toBe(toMinor(1179));
    expect(ukStudentLoanRepayment(uk26, { incomeMinor: toMinor(40000), plans: ["plan2", "postgraduate"] }).totalMinor).toBe(95535 + toMinor(1140));
  });
  it("comes off take-home pay", () => {
    const without = ukPayroll(uk26, { grossAnnualMinor: toMinor(40000) });
    const withLoan = ukPayroll(uk26, { grossAnnualMinor: toMinor(40000), studentLoans: ["plan2"] });
    expect(without.netAnnualMinor - withLoan.netAnnualMinor).toBe(95535);
  });
});

describe("Scottish income tax", () => {
  it("applies the six Scottish bands to taxable income", () => {
    const r = ukPayroll(uk26, { grossAnnualMinor: toMinor(50000), region: "scotland" });
    expect(r.incomeTaxMinor).toBe(898205); // 753.73 + 2,597.80 + 2,968.56 + 2,661.96
    expect(r.marginalRate).toBe(0.42);
    expect(ukPayroll(uk26, { grossAnnualMinor: toMinor(50000) }).incomeTaxMinor).toBe(toMinor(7486));
  });
  it("leaves National Insurance UK-wide", () => {
    expect(ukPayroll(uk26, { grossAnnualMinor: toMinor(50000), region: "scotland" }).niMinor).toBe(ukPayroll(uk26, { grossAnnualMinor: toMinor(50000) }).niMinor);
  });
  it("falls back to the latest Scottish pack and says so", () => {
    expect(regionPackFor("scotland", "2027-28")).toMatchObject({ exact: false, pack: { taxYear: "2026-27" } });
    expect(ukPayroll(uk27, { grossAnnualMinor: toMinor(50000), region: "scotland" }).notes[0]).toMatch(/not published yet/);
  });
});

describe("UK pension annual allowance", () => {
  const base = { relevantEarningsMinor: toMinor(250000), personalContributionsMinor: 0, marginalRate: 0.45 };
  it("tapers by 1 for every 2 of adjusted income over the limit", () => {
    const r = ukAnnualAllowance(uk26, { ...base, thresholdIncomeMinor: toMinor(250000), adjustedIncomeMinor: toMinor(300000), totalContributionsMinor: toMinor(70000), carryForward: [{ taxYear: "2023-24", unusedMinor: toMinor(10000) }, { taxYear: "2024-25", unusedMinor: toMinor(15000) }, { taxYear: "2025-26", unusedMinor: toMinor(5000) }] });
    expect(r.annualAllowanceMinor).toBe(toMinor(40000));
    expect(r.excessMinor).toBe(0);
    expect(r.carryForwardUsed.map((y) => y.taxYear)).toEqual(["2023-24", "2024-25", "2025-26"]);
  });
  it("charges the excess after carry forward at the marginal rate", () => {
    const r = ukAnnualAllowance(uk26, { ...base, thresholdIncomeMinor: toMinor(250000), adjustedIncomeMinor: toMinor(300000), totalContributionsMinor: toMinor(80000), carryForward: [{ taxYear: "2024-25", unusedMinor: toMinor(30000) }] });
    expect(r.excessMinor).toBe(toMinor(10000));
    expect(r.estimatedChargeMinor).toBe(toMinor(4500));
  });
  it("never tapers below the minimum", () => {
    expect(ukAnnualAllowance(uk26, { ...base, thresholdIncomeMinor: toMinor(390000), adjustedIncomeMinor: toMinor(400000), totalContributionsMinor: 0 }).annualAllowanceMinor).toBe(toMinor(10000));
  });
  it("applies the MPAA without carry forward", () => {
    const r = ukAnnualAllowance(uk26, { ...base, thresholdIncomeMinor: toMinor(50000), adjustedIncomeMinor: toMinor(50000), totalContributionsMinor: toMinor(15000), mpaaTriggered: true, carryForward: [{ taxYear: "2025-26", unusedMinor: toMinor(40000) }] });
    expect(r.excessMinor).toBe(toMinor(5000));
  });
  it("caps relief on personal contributions at earnings or GBP 3,600", () => {
    const r = ukAnnualAllowance(uk26, { ...base, relevantEarningsMinor: toMinor(2000), personalContributionsMinor: toMinor(5000), thresholdIncomeMinor: toMinor(2000), adjustedIncomeMinor: toMinor(2000), totalContributionsMinor: toMinor(5000) });
    expect(r.personalOverReliefLimitMinor).toBe(toMinor(1400));
  });
});

describe("payslip check", () => {
  const ok = { frequency: "monthly" as const, payDate: "2027-01-31", grossPeriodMinor: 416667, assessment: "single" as const, age: 35, toleranceMinor: 100 };
  it("passes an Irish payslip that matches the rules", () => {
    const r = iePayslipCheck(ie27, { ...ok, incomeTaxMinor: 53750, uscMinor: 8474, prsiMinor: 18125 });
    expect(r.expected).toMatchObject({ incomeTaxMinor: 53750, uscMinor: 8474, prsiMinor: 18125 });
    expect(r.findings.map((f) => f.code)).toEqual(["ok"]);
  });
  it("spots emergency tax and emergency USC", () => {
    const r = iePayslipCheck(ie27, { ...ok, incomeTaxMinor: 166667, uscMinor: 33333, prsiMinor: 18125 });
    expect(r.findings.map((f) => f.code)).toEqual(["emergency-tax", "emergency-usc"]);
  });
  it("spots missing credits", () => {
    expect(iePayslipCheck(ie27, { ...ok, incomeTaxMinor: 70000, uscMinor: 8474, prsiMinor: 18125 }).findings[0]!.code).toBe("tax-high");
  });
  it("checks a UK tax code and deductions", () => {
    const uk = { frequency: "monthly" as const, grossPeriodMinor: toMinor(3000), incomeTaxMinor: 39050, niMinor: 15620, region: "rUK" as const, studentLoans: [], toleranceMinor: 100 };
    expect(ukPayslipCheck(uk26, { ...uk, taxCode: "1257L" }).findings.map((f) => f.code)).toEqual(["ok"]);
    expect(ukPayslipCheck(uk26, { ...uk, taxCode: "1257L M1" }).findings.map((f) => f.code)).toContain("emergency-code");
    expect(ukPayslipCheck(uk26, { ...uk, taxCode: "S1257L" }).findings.map((f) => f.code)).toContain("region-mismatch");
    expect(ukPayslipCheck(uk26, { ...uk, taxCode: "BR" }).findings.map((f) => f.code)).toContain("code-BR");
    expect(ukStandardTaxCode(uk26, "scotland")).toBe("S1257L");
  });
});

describe("retirement projection", () => {
  it("estimates State Pensions pro rata", () => {
    expect(ieStatePensionEstimate(ie26, { contributionYears: 40 }).annualMinor).toBe(1556360);
    expect(ieStatePensionEstimate(ie26, { contributionYears: 20 }).annualMinor).toBe(778180);
    expect(ieStatePensionEstimate(ie26, { contributionYears: 9 }).annualMinor).toBe(0);
    expect(ukStatePensionEstimate(uk26, { qualifyingYears: 35 }).annualMinor).toBe(1254760);
    expect(ukStatePensionEstimate(uk26, { qualifyingYears: 10 }).annualMinor).toBe(6894 * 52);
  });
  it("grows pots to retirement and draws them down with State Pension on top", () => {
    const [r] = projectRetirement({
      members: [{ id: "a", name: "A", age: 60, retirementAge: 66, potMinor: toMinor(100000), annualContributionMinor: toMinor(1000), statePensions: [{ jurisdiction: "IE", annualMinor: toMinor(15000), startAge: 66 }] }],
      scenarios: [{ id: "flat", label: "Flat", realReturn: 0 }],
      withdrawalRate: 0.04,
      horizonYears: 10,
    });
    expect(r!.members[0]!.potAtRetirementMinor).toBe(toMinor(106000));
    expect(r!.series[5]!.incomeMinor).toBe(0);
    expect(r!.series[6]!.incomeMinor).toBe(toMinor(4240 + 15000));
    expect(r!.series[7]!.potMinor).toBe(toMinor(106000 - 4240));
  });
  it("converts nominal to real returns", () => {
    expect(realRate(0.05, 0.02)).toBeCloseTo(0.029412, 6);
  });
});

describe("wrapper comparison", () => {
  const base: WrapperComparisonInput = {
    residence: "IE", iePack: ie27, ukPack: uk26, annualContributionMinor: toMinor(1000), years: 10, growthRate: 0, dividendYield: 0, depositRate: 0,
    marginalRate: 0.4, incomeChargesRate: 0.52, retirementTaxRate: 0.2, ukBand: "basic", date: "2027-06-01", flags: [],
  };
  const byId = (rows: ReturnType<typeof compareWrappers>) => Object.fromEntries(rows.map((r) => [r.id, r]));
  it("with no growth, every non-pension wrapper returns what went in", () => {
    const r = byId(compareWrappers(base));
    for (const id of ["ieEtf", "ieInvestmentTrust", "ieDeposit", "ieInvestmentAccount"]) expect(r[id]!.netValueMinor).toBe(toMinor(10000));
  });
  it("pension adds relief at the marginal rate, then taxes the non-lump-sum part", () => {
    const p = byId(compareWrappers(base)).iePension!;
    expect(p.grossValueMinor).toBe(1666670);
    expect(p.netValueMinor).toBe(1416670);
  });
  it("ETF pays deemed-disposal tax; the Investment Account stays off until flagged", () => {
    const grown = byId(compareWrappers({ ...base, growthRate: 0.07, years: 20 }));
    expect(grown.ieEtf!.taxPaidMinor).toBeGreaterThan(0);
    expect(grown.ieInvestmentAccount!.available).toBe(false);
    expect(byId(compareWrappers({ ...base, flags: ["investmentAccount"] })).ieInvestmentAccount!.available).toBe(true);
    expect(grown.ukIsaHeldInIreland!.netValueMinor).toBe(grown.ieEtf!.netValueMinor);
  });
  it("shows the Investment Account from a later pack before it starts", () => {
    const early = byId(compareWrappers({ ...base, iePack: ie26, date: "2026-10-22" }));
    expect(early.ieInvestmentAccount).toBeUndefined();
    const shown = byId(compareWrappers({ ...base, iePack: ie26, date: "2026-10-22", investmentAccountPack: ie27 }));
    expect(shown.ieInvestmentAccount!.rules[0]!.pack).toBe("IE-2027.1");
  });
  it("UK ISA is tax-free and capped at the allowance", () => {
    const r = byId(compareWrappers({ ...base, residence: "UK", annualContributionMinor: toMinor(25000), growthRate: 0.05 }));
    expect(r.ukIsa!.taxPaidMinor).toBe(0);
    expect(r.ukIsa!.contributedMinor).toBe(toMinor(200000));
  });
});
