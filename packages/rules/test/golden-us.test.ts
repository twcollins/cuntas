// Golden tests for US federal tax, 2026. Expected values are worked by hand from the tax rate
// schedules in Rev. Proc. 2025-32 ("$5,800 plus 22% of the excess over $50,400"), the SSA wage
// base and the FICA rates in law. Never edit expected values to make a test pass.
import { describe, expect, it } from "vitest";
import { getPack, toMinor, usPayroll } from "../src";

const us26 = () => getPack("US", "2026");
const base = { employment: "employee", filingStatus: "single", age: 35 } as const;

describe("golden: US single employee USD 60,000 (2026)", () => {
  const r = usPayroll(us26(), { ...base, grossAnnualMinor: toMinor(60000) });
  it("taxable income 43,900 after the 16,100 standard deduction", () => {
    expect(r.taxableIncomeMinor).toBe(toMinor(43900));
  });
  it("income tax 5,020 = 1,240 + 12% of 31,500", () => {
    expect(r.incomeTaxMinor).toBe(toMinor(5020));
  });
  it("Social Security 3,720 and Medicare 870", () => {
    expect(r.socialSecurityMinor).toBe(toMinor(3720));
    expect(r.medicareMinor).toBe(toMinor(870));
  });
  it("take-home 50,390, federal only", () => {
    expect(r.netAnnualMinor).toBe(toMinor(50390));
    expect(r.pack).toBe("US-2026.1");
    expect(r.notes.join(" ")).toMatch(/State and local income tax/);
  });
  it("marginal rate 12% income tax plus 7.65% FICA", () => {
    expect(r.marginalRate).toBeCloseTo(0.1965, 6);
  });
});

describe("golden: US single employee USD 250,000 (2026)", () => {
  const r = usPayroll(us26(), { ...base, grossAnnualMinor: toMinor(250000) });
  it("income tax 51,304 = 41,024 + 32% of 32,125", () => {
    expect(r.incomeTaxMinor).toBe(toMinor(51304));
  });
  it("Social Security stops at the 184,500 wage base: 11,439", () => {
    expect(r.socialSecurityMinor).toBe(toMinor(11439));
  });
  it("Medicare 3,625 plus additional Medicare 450 on wages over 200,000", () => {
    expect(r.medicareMinor).toBe(toMinor(3625 + 450));
  });
});

describe("golden: US pre-tax deductions (2026)", () => {
  it("a 6,000 401(k) deferral lowers income tax to 4,300 but not FICA", () => {
    const r = usPayroll(us26(), { ...base, grossAnnualMinor: toMinor(60000), pretax401kMinor: toMinor(6000) });
    expect(r.incomeTaxMinor).toBe(toMinor(4300));
    expect(r.socialSecurityMinor).toBe(toMinor(3720));
    expect(r.netAnnualMinor).toBe(toMinor(60000 - 6000 - 4300 - 3720 - 870));
  });
  it("a 2,000 Section 125 (HSA) deduction lowers income tax and FICA", () => {
    const r = usPayroll(us26(), { ...base, grossAnnualMinor: toMinor(60000), pretaxSection125Minor: toMinor(2000) });
    // Taxable 41,900: 1,240 + 12% of 29,500 = 4,780. FICA on 58,000.
    expect(r.incomeTaxMinor).toBe(toMinor(4780));
    expect(r.socialSecurityMinor).toBe(toMinor(3596));
    expect(r.medicareMinor).toBe(toMinor(841));
  });
});

describe("golden: US married filing jointly with children (2026)", () => {
  it("one earner, USD 150,000, two children: 15,340 less 4,400 child tax credit", () => {
    const r = usPayroll(us26(), { ...base, filingStatus: "marriedJoint", grossAnnualMinor: toMinor(150000), children: 2, spouse: { grossAnnualMinor: 0, employment: "employee", age: 35 } });
    // Taxable 117,800: 11,600 + 22% of 17,000 = 15,340.
    expect(r.returnIncomeTaxBeforeCreditsMinor).toBe(toMinor(15340));
    expect(r.childTaxCreditMinor).toBe(toMinor(4400));
    expect(r.incomeTaxMinor).toBe(toMinor(10940));
  });
  it("two earners share the joint return's tax by income", () => {
    const r = usPayroll(us26(), { ...base, filingStatus: "marriedJoint", grossAnnualMinor: toMinor(100000), spouse: { grossAnnualMinor: toMinor(50000), employment: "employee", age: 35 } });
    expect(r.returnIncomeTaxBeforeCreditsMinor).toBe(toMinor(15340));
    // Two thirds of 15,340.
    expect(r.incomeTaxMinor).toBe(1022667);
  });
});

describe("golden: US head of household, refundable child tax credit (2026)", () => {
  it("USD 40,000, one child: tax 1,585 wiped out, 615 refunded", () => {
    const r = usPayroll(us26(), { ...base, filingStatus: "headOfHousehold", grossAnnualMinor: toMinor(40000), children: 1 });
    // Taxable 15,850 after the 24,150 standard deduction, all at 10%.
    expect(r.returnIncomeTaxBeforeCreditsMinor).toBe(toMinor(1585));
    expect(r.incomeTaxMinor).toBe(0);
    // 2,200 - 1,585 = 615, under the 1,700 cap and 15% of 37,500.
    expect(r.refundableCreditMinor).toBe(toMinor(615));
    expect(r.netAnnualMinor).toBe(toMinor(40000 - 2480 - 580 + 615));
  });
});

describe("golden: US seniors (2026)", () => {
  it("single, 66, USD 50,000: 16,100 + 2,050 aged + 6,000 senior deduction", () => {
    const r = usPayroll(us26(), { ...base, age: 66, grossAnnualMinor: toMinor(50000) });
    expect(r.taxableIncomeMinor).toBe(toMinor(25850));
    expect(r.incomeTaxMinor).toBe(toMinor(2854));
  });
  it("the senior deduction falls by 6% of income over 75,000", () => {
    const r = usPayroll(us26(), { ...base, age: 66, grossAnnualMinor: toMinor(100000) });
    // 6,000 - 6% of 25,000 = 4,500; taxable 100,000 - 16,100 - 2,050 - 4,500 = 77,350.
    expect(r.taxableIncomeMinor).toBe(toMinor(77350));
  });
});

describe("golden: US self-employed USD 80,000 net profit (2026)", () => {
  const r = usPayroll(us26(), { ...base, employment: "selfEmployed", grossAnnualMinor: toMinor(80000) });
  it("self-employment tax 15.3% of 92.35% of profit: 11,303.64", () => {
    expect(r.selfEmploymentTaxMinor).toBe(1130364);
  });
  it("half is deducted, then 20% of business income: taxable 46,598.54", () => {
    // AGI 74,348.18; before QBI 58,248.18; QBI deduction 20% of that (lower than 20% of 74,348.18).
    expect(r.taxableIncomeMinor).toBe(4659854);
  });
  it("income tax 5,343.82 = 1,240 + 12% of 34,198.54", () => {
    expect(r.incomeTaxMinor).toBe(534382);
    expect(r.netAnnualMinor).toBe(8000000 - 1130364 - 534382);
  });
});
