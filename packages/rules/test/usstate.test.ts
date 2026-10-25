// Mechanics of state income tax with made-up packs (not real states): each shape the packs use.
import { describe, expect, it } from "vitest";
import { getPack, parseRuleFile, toMinor, usPayroll, usStateTax, type UsStatePack } from "../src";

const us26 = () => getPack("US", "2026");
const meta = { kind: "usState" as const, parent: "US" as const, taxYear: "2026", version: "US-XX-2026.1", status: "provisional" as const, effective: { from: "2026-01-01", to: "2026-12-31" }, sources: ["https://example.gov/tax"] };
const src = "https://example.gov/tax";
const all = <T,>(v: T) => ({ single: v, marriedJoint: v, marriedSeparate: v, headOfHousehold: v });

const none: UsStatePack = { ...meta, state: "TX", incomeTax: { source: src, none: true } };
const flat: UsStatePack = { ...meta, state: "IL", incomeTax: { source: src, base: "federalAgi", rate: 0.05, exemption: { perFiler: 2000, perDependent: 1000, incomeLimit: { single: 250000, marriedJoint: 500000, marriedSeparate: 250000, headOfHousehold: 250000 } } } };
const graduated: UsStatePack = {
  ...meta,
  state: "CA",
  incomeTax: { source: src, base: "federalAgi", standardDeduction: "federal", brackets: all([{ upTo: 10000, rate: 0.02 }, { upTo: null, rate: 0.06 }]) },
  localTax: { source: src, note: "Some cities levy their own income tax." },
};
const wages: UsStatePack = { ...meta, state: "PA", incomeTax: { source: src, base: "wages", rate: 0.03 } };

const input = { filingStatus: "single", federalAgiMinor: toMinor(54000), federalTaxableIncomeMinor: toMinor(37900), wagesMinor: toMinor(60000), federalStandardDeductionMinor: toMinor(16100), filers: 1, dependents: 0 } as const;

describe("state income tax mechanics", () => {
  it("a state with no wage tax charges nothing", () => {
    expect(usStateTax(none, input).taxMinor).toBe(0);
  });
  it("flat rate on AGI less exemptions: 5% of (54,000 - 2,000) = 2,600", () => {
    expect(usStateTax(flat, input).taxMinor).toBe(toMinor(2600));
    expect(usStateTax(flat, { ...input, filingStatus: "marriedJoint", filers: 2, dependents: 2 }).taxMinor).toBe(toMinor(2400));
  });
  it("exemptions stop above the income limit", () => {
    expect(usStateTax(flat, { ...input, federalAgiMinor: toMinor(260000) }).taxMinor).toBe(toMinor(13000));
  });
  it("brackets after the federal standard deduction: 2% of 10,000 + 6% of 27,900 = 1,874", () => {
    const r = usStateTax(graduated, input);
    expect(r.taxableMinor).toBe(toMinor(37900));
    expect(r.taxMinor).toBe(toMinor(1874));
    expect(r.marginalRate).toBe(0.06);
    expect(r.notes.join(" ")).toMatch(/Some cities levy their own income tax/);
  });
  it("a wages base ignores 401(k) deferrals: 3% of 60,000 = 1,800", () => {
    expect(usStateTax(wages, input).taxMinor).toBe(toMinor(1800));
  });
});

describe("state tax in take-home pay", () => {
  it("is added to federal tax and shown as a line", () => {
    const fed = usPayroll(us26(), { employment: "employee", filingStatus: "single", age: 35, grossAnnualMinor: toMinor(60000) });
    const r = usPayroll(us26(), { employment: "employee", filingStatus: "single", age: 35, grossAnnualMinor: toMinor(60000), state: flat });
    // 5% of (60,000 - 2,000)
    expect(r.stateTaxMinor).toBe(toMinor(2900));
    expect(r.netAnnualMinor).toBe(fed.netAnnualMinor - toMinor(2900));
    expect(r.lines.some((l) => l.label === "Illinois income tax")).toBe(true);
    expect(r.marginalRate).toBeCloseTo(fed.marginalRate + 0.05, 6);
    expect(r.notes.join(" ")).not.toMatch(/State and local income tax are not included/);
  });
  it("on a joint return the state tax is shared by income", () => {
    const r = usPayroll(us26(), { employment: "employee", filingStatus: "marriedJoint", age: 35, grossAnnualMinor: toMinor(100000), spouse: { grossAnnualMinor: toMinor(50000), employment: "employee", age: 35 }, state: flat });
    // 5% of (150,000 - 4,000) = 7,300; two thirds is 4,866.67.
    expect(r.stateTaxMinor).toBe(486667);
  });
});

describe("state rule files", () => {
  it("a state file loads under its own key", () => {
    const text = `kind: usState\nstate: IL\nparent: US\ntaxYear: "2027"\nversion: US-IL-2027.0\nstatus: provisional\neffective: { from: "2027-01-01", to: "2027-12-31" }\nsources: [${src}]\nincomeTax:\n  source: ${src}\n  base: federalAgi\n  rate: 0.0495\n`;
    const r = parseRuleFile(text);
    expect(r.ok && r.key).toBe("us/il/2027");
  });
  it("rejects a pack that is both flat and bracketed, or a made-up state", () => {
    const bad = `kind: usState\nstate: ZZ\nparent: US\ntaxYear: "2027"\nversion: US-ZZ-2027.0\nstatus: provisional\neffective: { from: "2027-01-01", to: "2027-12-31" }\nsources: [${src}]\nincomeTax:\n  source: ${src}\n  base: federalAgi\n  rate: 0.05\n  none: true\n`;
    const r = parseRuleFile(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.message).join(" ")).toMatch(/two-letter state code[\s\S]*exactly one of/);
  });
});

describe("local income tax from the state pack", () => {
  const withCounties: UsStatePack = {
    ...meta,
    state: "IN",
    incomeTax: { source: src, base: "federalAgi", rate: 0.03, exemption: { perFiler: 1000, perDependent: 0 } },
    localTax: { source: src, note: "Every county levies a county income tax." },
    localities: { source: src, kind: "county", list: [{ id: "adams", name: "Adams", rate: 0.016 }] },
  };
  it("applies the chosen county's rate to the state's taxable income", () => {
    const r = usStateTax(withCounties, { ...input, locality: "adams" });
    // Taxable 54,000 - 1,000 = 53,000: state 1,590, county 848.
    expect(r.taxMinor).toBe(toMinor(1590));
    expect(r.localTaxMinor).toBe(toMinor(848));
    expect(r.lines.at(-1)!.label).toBe("Adams county income tax");
    expect(r.marginalRate).toBeCloseTo(0.046, 6);
  });
  it("without a county, asks for one", () => {
    const r = usStateTax(withCounties, input);
    expect(r.localTaxMinor).toBe(0);
    expect(r.notes.join(" ")).toMatch(/Choose your county to include it/);
  });
  it("take-home subtracts both", () => {
    const base = usPayroll(us26(), { employment: "employee", filingStatus: "single", age: 35, grossAnnualMinor: toMinor(60000), state: withCounties });
    const r = usPayroll(us26(), { employment: "employee", filingStatus: "single", age: 35, grossAnnualMinor: toMinor(60000), state: withCounties, locality: "adams" });
    expect(r.localTaxMinor).toBe(toMinor(944));
    expect(r.netAnnualMinor).toBe(base.netAnnualMinor - toMinor(944));
  });
});
