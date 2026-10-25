// Golden tests for US retirement limits and estimated tax. Where the IRS publishes a worked example
// it is reproduced exactly, using that year's figures (2025 for Pub. 590-A); the 2026 cases are
// read straight from the 2026 limits. Never edit expected values to make a test pass.
import { describe, expect, it } from "vitest";
import { getPack, toMinor, usEstimatedTax, usRetirementLimits, type UsPack } from "../src";

const us26 = () => getPack("US", "2026");
const dollars = (minor: number) => Math.round(minor / 100);

/** The 2026 pack with the 2025 IRA figures Pub. 590-A (2025) uses in its examples. */
function with2025Ira(): UsPack {
  const p = us26();
  return {
    ...p,
    retirement: {
      ...p.retirement,
      ira: 7000,
      iraCatchUp50: 1000,
      rothIraPhaseOut: { single: [150000, 165000], marriedJoint: [236000, 246000], marriedSeparate: [0, 10000] },
      iraDeductionPhaseOut: { coveredSingle: [79000, 89000], coveredMarriedJoint: [126000, 146000], spouseCoveredMarriedJoint: [236000, 246000], marriedSeparate: [0, 10000] },
    },
  };
}

describe("golden: Pub. 590-A (2025) worksheet 2-2, reduced Roth IRA limit", () => {
  it("single, 45, modified AGI 151,000: 6,540", () => {
    const r = usRetirementLimits(with2025Ira(), { age: 45, filingStatus: "single", magiMinor: toMinor(151000), compensationMinor: toMinor(150000), coveredByWorkplacePlan: false });
    expect(r.rothIraMinor).toBe(toMinor(6540));
  });
});

describe("golden: Pub. 590-A (2025) worksheet 1-2, reduced IRA deduction", () => {
  it("example 1: joint, covered, modified AGI 126,500, salary 66,000: 19,500 x 35% = 6,825, rounded up to 6,830", () => {
    // The published example enters 6,825 on line 4, but line 4's own instruction is to round a
    // result that isn't a multiple of $10 up to the next multiple (IRC 219(g)(2)(C) rounds the
    // reduction of 175 down to 170, which gives the same 6,830). We follow the rule.
    const r = usRetirementLimits(with2025Ira(), { age: 39, filingStatus: "marriedJoint", magiMinor: toMinor(126500), compensationMinor: toMinor(66000), coveredByWorkplacePlan: true });
    expect(r.traditionalIraDeductibleMinor).toBe(toMinor(6830));
  });
  it("example 1: the spouse, not covered, deducts the full 7,000", () => {
    const r = usRetirementLimits(with2025Ira(), { age: 39, filingStatus: "marriedJoint", magiMinor: toMinor(126500), compensationMinor: toMinor(51500), coveredByWorkplacePlan: false, spouseCoveredByWorkplacePlan: true });
    expect(r.traditionalIraDeductibleMinor).toBe(toMinor(7000));
  });
  it("example 2: spouse with no plan, other spouse covered, modified AGI 238,500: deduct 5,250", () => {
    const r = usRetirementLimits(with2025Ira(), { age: 39, filingStatus: "marriedJoint", magiMinor: toMinor(238500), compensationMinor: toMinor(38500), coveredByWorkplacePlan: false, spouseCoveredByWorkplacePlan: true });
    expect(r.traditionalIraDeductibleMinor).toBe(toMinor(5250));
  });
  it("example 2: the covered spouse, modified AGI over 146,000, deducts nothing", () => {
    const r = usRetirementLimits(with2025Ira(), { age: 39, filingStatus: "marriedJoint", magiMinor: toMinor(238500), compensationMinor: toMinor(45500), coveredByWorkplacePlan: true });
    expect(r.traditionalIraDeductibleMinor).toBe(0);
  });
});

describe("golden: 2026 limits by age (Notice 2025-67, Rev. Proc. 2025-19)", () => {
  const at = (age: number) => usRetirementLimits(us26(), { age, filingStatus: "single", magiMinor: toMinor(80000), compensationMinor: toMinor(80000), coveredByWorkplacePlan: true, hsaCoverage: "family" });
  it("401(k): 24,500; 32,500 from 50; 35,750 at 60-63; 32,500 again at 64", () => {
    expect(dollars(at(35).employeeDeferralMinor)).toBe(24500);
    expect(dollars(at(50).employeeDeferralMinor)).toBe(32500);
    expect(dollars(at(61).employeeDeferralMinor)).toBe(35750);
    expect(dollars(at(64).employeeDeferralMinor)).toBe(32500);
  });
  it("IRA: 7,500, or 8,600 from 50, never more than pay", () => {
    expect(dollars(at(35).iraMinor)).toBe(7500);
    expect(dollars(at(50).iraMinor)).toBe(8600);
    const low = usRetirementLimits(us26(), { age: 30, filingStatus: "single", magiMinor: toMinor(5000), compensationMinor: toMinor(5000), coveredByWorkplacePlan: false });
    expect(dollars(low.iraMinor)).toBe(5000);
  });
  it("HSA family: 8,750, or 9,750 from 55; none without an HSA-eligible plan", () => {
    expect(dollars(at(40).hsaMinor!)).toBe(8750);
    expect(dollars(at(55).hsaMinor!)).toBe(9750);
    expect(usRetirementLimits(us26(), { age: 40, filingStatus: "single", magiMinor: 0, compensationMinor: 0, coveredByWorkplacePlan: false }).hsaMinor).toBeNull();
  });
  it("single, covered, modified AGI 80,000 is below the 81,000 phase-out: full deduction", () => {
    expect(dollars(at(35).traditionalIraDeductibleMinor)).toBe(7500);
  });
  it("Roth IRA closes at 168,000 for single filers", () => {
    const r = usRetirementLimits(us26(), { age: 35, filingStatus: "single", magiMinor: toMinor(168000), compensationMinor: toMinor(168000), coveredByWorkplacePlan: false });
    expect(r.rothIraMinor).toBe(0);
  });
});

describe("golden: Pub. 505 (2026), required annual payment", () => {
  it("2025 tax 42,581, AGI 180,000; expected 2026 tax 71,253: pay 46,839 (110% of last year's)", () => {
    const r = usEstimatedTax(us26(), { expectedTaxMinor: toMinor(71253), priorYearTaxMinor: toMinor(42581), priorYearAgiMinor: toMinor(180000), withholdingMinor: 0, filingStatus: "single" });
    expect(dollars(r.requiredAnnualMinor)).toBe(46839);
    expect(r.basis).toBe("priorYear");
    expect(r.required).toBe(true);
    expect(r.dueDates).toEqual(["2026-04-15", "2026-06-15", "2026-09-15", "2027-01-15"]);
    expect(r.perInstallmentMinor).toBe(Math.ceil(r.requiredAnnualMinor / 4));
  });
  it("no estimated tax when less than 1,000 would be owed after withholding", () => {
    const r = usEstimatedTax(us26(), { expectedTaxMinor: toMinor(10900), priorYearTaxMinor: null, priorYearAgiMinor: null, withholdingMinor: toMinor(10000), filingStatus: "single" });
    expect(r.required).toBe(false);
    expect(r.perInstallmentMinor).toBe(0);
  });
  it("without last year's return, the target is 90% of this year's tax", () => {
    const r = usEstimatedTax(us26(), { expectedTaxMinor: toMinor(20000), priorYearTaxMinor: null, priorYearAgiMinor: null, withholdingMinor: 0, filingStatus: "single" });
    expect(dollars(r.requiredAnnualMinor)).toBe(18000);
    expect(r.basis).toBe("currentYear");
  });
});
