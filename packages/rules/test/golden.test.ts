// Golden tests from docs/SPEC.md. Never edit expected values to make a test pass.
import { describe, expect, it } from "vitest";
import { getPack, iePayroll, pensionReliefLimit, toMinor, ukIsaCheck } from "../src";

const euros = (minor: number) => Math.round(minor / 100);
const base = { frequency: "monthly", assessment: "single", employment: "employee", age: 35 } as const;

describe("golden: IE single PAYE EUR 50,000", () => {
  it("2027: income tax 6,450; USC 1,017; PRSI 2,194", () => {
    const r = iePayroll(getPack("IE", "2027"), { ...base, grossAnnualMinor: toMinor(50000) });
    expect(r.incomeTaxMinor).toBe(645000);
    expect(euros(r.uscMinor)).toBe(1017);
    expect(euros(r.prsiMinor)).toBe(2194);
    expect(r.pack).toBe("IE-2027.1");
  });

  it("2026: income tax 7,200; USC 1,033; PRSI 2,119", () => {
    const r = iePayroll(getPack("IE", "2026"), { ...base, grossAnnualMinor: toMinor(50000) });
    expect(r.incomeTaxMinor).toBe(720000);
    expect(euros(r.uscMinor)).toBe(1033);
    expect(euros(r.prsiMinor)).toBe(2119);
  });

  it("matches hand calculation to the cent", () => {
    const r27 = iePayroll(getPack("IE", "2027"), { ...base, grossAnnualMinor: toMinor(50000) });
    expect(r27.uscMinor).toBe(101682);
    expect(r27.prsiMinor).toBe(219375);
    const r26 = iePayroll(getPack("IE", "2026"), { ...base, grossAnnualMinor: toMinor(50000) });
    expect(r26.uscMinor).toBe(103282);
    expect(r26.prsiMinor).toBe(211875);
  });
});

describe("golden: IE pension relief limits", () => {
  it("age 30-39, EUR 60,000: max relievable EUR 12,000", () => {
    expect(pensionReliefLimit(getPack("IE", "2026"), 35, toMinor(60000)).limitMinor).toBe(toMinor(12000));
  });
  it("age 60+, EUR 150,000: max relievable EUR 46,000 (EUR 115,000 cap)", () => {
    expect(pensionReliefLimit(getPack("IE", "2026"), 62, toMinor(150000)).limitMinor).toBe(toMinor(46000));
  });
});

describe("golden: UK cash ISA cap", () => {
  it("under 65, 2027/28: cash subscription blocked above GBP 12,000", () => {
    const pack = getPack("UK", "2027-28");
    const subscribed = { cash: 0, stocksAndShares: 0, lifetime: 0, innovativeFinance: 0 };
    expect(ukIsaCheck(pack, { age: 40, subscribed, proposed: { type: "cash", amountMinor: toMinor(12000) } }).allowed).toBe(true);
    const over = ukIsaCheck(pack, { age: 40, subscribed, proposed: { type: "cash", amountMinor: toMinor(12000) + 1 } });
    expect(over.allowed).toBe(false);
    expect(ukIsaCheck(pack, { age: 66, subscribed, proposed: { type: "cash", amountMinor: toMinor(20000) } }).allowed).toBe(true);
  });
});
