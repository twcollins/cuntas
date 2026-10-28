// Golden tests for the Social Security retirement estimate and US foreign-asset reporting.
// Figures come from SSA's published formula and examples and the IRS thresholds. Never edit
// expected values to make a test pass.
import { describe, expect, it } from "vitest";
import { getPack, toMinor, usFullRetirementAge, usPia, usForeignReporting, usSocialSecurityEstimate } from "../src";

const us26 = () => getPack("US", "2026");

describe("golden: SSA PIA formula, workers first eligible in 2026", () => {
  it("SSA's maximum-earner example: AIME 14,358 gives a PIA of 4,216.90", () => {
    expect(usPia(us26(), toMinor(14358))).toBe(toMinor(4216.9));
  });
  it("90% to the first bend point, 32% to the second, 15% above; rounded down to the dime", () => {
    // 1,157.40 + 0.32 x 3,714 = 2,345.88, rounded down to 2,345.80.
    expect(usPia(us26(), toMinor(5000))).toBe(toMinor(2345.8));
    expect(usPia(us26(), toMinor(1000))).toBe(toMinor(900));
    expect(usPia(us26(), 0)).toBe(0);
  });
});

describe("golden: SSA full retirement age by year of birth", () => {
  it.each([
    ["1954-06-15", 66, 0],
    ["1955-06-15", 66, 2],
    ["1957-06-15", 66, 6],
    ["1959-06-15", 66, 10],
    ["1960-06-15", 67, 0],
    ["1990-03-02", 67, 0],
  ])("born %s: %i and %i months", (born, years, months) => {
    expect(usFullRetirementAge(us26(), born)).toEqual({ years, months });
  });
  it("born on 1 January counts as born the year before", () => {
    expect(usFullRetirementAge(us26(), "1960-01-01")).toEqual({ years: 66, months: 10 });
  });
});

describe("golden: SSA claiming-age percentages, full retirement age 67", () => {
  // SSA "Benefit reduction for early retirement": 62 = 70%, 63 = 75%, 64 = 80%, 65 = 86.7%, 66 = 93.3%;
  // "Delayed retirement credits": 8% a year, 124% at 70 for people born 1960 or later.
  const pia = toMinor(1000);
  const at = (claimAge: number) =>
    usSocialSecurityEstimate(us26(), { dateOfBirth: "1970-06-15", claimAge, statementPiaMinor: pia, annualEarningsMinor: 0, coveredYears: 0 }).monthlyMinor;
  it.each([
    [62, 700],
    [63, 750],
    [64, 800],
    [65, 866],
    [66, 933],
    [67, 1000],
    [68, 1080],
    [69, 1160],
    [70, 1240],
  ])("claiming at %i pays %i a month on a 1,000 PIA (rounded down to the dollar)", (age, dollars) => {
    expect(at(age)).toBe(toMinor(dollars));
  });
  it("claims are held to 62-70", () => {
    expect(at(60)).toBe(toMinor(700));
    expect(at(75)).toBe(toMinor(1240));
  });
});

describe("Social Security estimate from pay", () => {
  const est = (annual: number, coveredYears: number, claimAge = 67) =>
    usSocialSecurityEstimate(us26(), { dateOfBirth: "1985-05-20", claimAge, annualEarningsMinor: toMinor(annual), coveredYears });
  it("35 years at 60,000: AIME 5,000, PIA 2,345.80, 2,345 a month at 67", () => {
    const r = est(60000, 35);
    expect(r.aimeMinor).toBe(toMinor(5000));
    expect(r.piaMinor).toBe(toMinor(2345.8));
    expect(r.monthlyMinor).toBe(toMinor(2345));
    expect(r.annualMinor).toBe(toMinor(2345 * 12));
    expect(r.startAge).toBe(67);
  });
  it("only the best 35 years count, and earnings above the wage base don't", () => {
    expect(est(60000, 45).aimeMinor).toBe(toMinor(5000));
    // 184,500 x 35 / 420 = 15,375.
    expect(est(250000, 35).aimeMinor).toBe(toMinor(15375));
  });
  it("fewer years average in zeros: 20 years at 60,000 is an AIME of 2,857 (rounded down)", () => {
    expect(est(60000, 20).aimeMinor).toBe(toMinor(2857));
  });
  it("needs 40 credits: 9 years pays nothing, 10 years qualifies", () => {
    expect(est(60000, 9)).toMatchObject({ eligible: false, monthlyMinor: 0 });
    expect(est(60000, 10).eligible).toBe(true);
  });
  it("a figure from the SSA statement is used as it is", () => {
    const r = usSocialSecurityEstimate(us26(), { dateOfBirth: "1985-05-20", claimAge: 67, annualEarningsMinor: toMinor(60000), coveredYears: 3, statementPiaMinor: toMinor(2100) });
    expect(r).toMatchObject({ eligible: true, piaMinor: toMinor(2100), monthlyMinor: toMinor(2100), fromStatement: true });
  });
});

describe("golden: foreign account reporting (FBAR and Form 8938)", () => {
  const report = (accounts: { maxMinor: number; yearEndMinor: number }[], livesAbroad: boolean, filingStatus: "single" | "marriedJoint" = "single") =>
    usForeignReporting(us26(), { livesAbroad, filingStatus, accounts });
  it("FBAR once the combined highest balances exceed 10,000; exactly 10,000 doesn't", () => {
    expect(report([{ maxMinor: toMinor(9000), yearEndMinor: 0 }, { maxMinor: toMinor(2000), yearEndMinor: 0 }], true).fbar).toMatchObject({ required: true, aggregateMaxMinor: toMinor(11000) });
    expect(report([{ maxMinor: toMinor(6000), yearEndMinor: 0 }, { maxMinor: toMinor(4000), yearEndMinor: 0 }], true).fbar.required).toBe(false);
  });
  it("Form 8938 living abroad, single: over 200,000 at year end or 300,000 at any time", () => {
    expect(report([{ maxMinor: toMinor(250000), yearEndMinor: toMinor(199000) }], true).form8938.required).toBe(false);
    expect(report([{ maxMinor: toMinor(301000), yearEndMinor: toMinor(199000) }], true).form8938.required).toBe(true);
    expect(report([{ maxMinor: toMinor(250000), yearEndMinor: toMinor(200001) }], true).form8938.required).toBe(true);
  });
  it("Form 8938 living in the US, joint: over 100,000 at year end or 150,000 at any time", () => {
    expect(report([{ maxMinor: toMinor(100000), yearEndMinor: toMinor(100000) }], false, "marriedJoint").form8938).toMatchObject({ required: false, yearEndThresholdMinor: toMinor(100000), anyTimeThresholdMinor: toMinor(150000) });
    expect(report([{ maxMinor: toMinor(150001), yearEndMinor: toMinor(90000) }], false, "marriedJoint").form8938.required).toBe(true);
  });
  it("carries the foreign earned income exclusion and the dates for 2026", () => {
    const r = report([], true);
    expect(r.foreignEarnedIncomeExclusionMinor).toBe(toMinor(132900));
    expect([r.fbar.due, r.fbar.extendedDue, r.returnDueAbroad]).toEqual(["2027-04-15", "2027-10-15", "2027-06-15"]);
  });
});
