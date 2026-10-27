import { describe, expect, it } from "vitest";
import { chartDefaults, getPack, toMinor } from "@cuntas/rules";
import { defaultThresholds, evaluateUs, type MemberState, type UsMemberState } from "../src";
import { member, snapshot } from "./fixtures";

const pack = getPack("US", "2026");

function usMember(over: Partial<MemberState> = {}, us: Partial<UsMemberState> = {}): MemberState {
  return member({
    name: "Alex",
    residence: "US",
    grossAnnualMinor: toMinor(90000),
    netMonthlyMinor: toMinor(5000),
    marginalRate: 0.2965,
    pension: { ...member().pension, employeeRate: 0.3, employerRate: 0.05, fullMatchEmployeeRate: 0.05, matchRatio: 1, myFutureFund: "not-eligible-age" },
    us: {
      filingStatus: "single",
      grossAnnualMinor: toMinor(90000),
      magiMinor: toMinor(65500),
      coveredByWorkplacePlan: true,
      spouseCoveredByWorkplacePlan: false,
      employeeDeferralMinor: toMinor(27000),
      // October: 10/12 of the year's limit is the pace.
      iraContribYtdMinor: toMinor(7000),
      hsaCoverage: null,
      hsaContribYtdMinor: 0,
      ...us,
    },
    ...over,
  });
}

/** A US household that meets every step. Tests break one thing at a time. */
function usSnapshot(over: Parameters<typeof snapshot>[0] = {}) {
  return snapshot({
    plan: "US",
    currency: "USD",
    members: [usMember()],
    netMonthlyPayMinor: toMinor(5000),
    liquidSavingsMinor: toMinor(40000),
    essentialMonthlySpendMinor: toMinor(3000),
    thresholds: defaultThresholds(chartDefaults("US")),
    ...over,
  });
}

const text = (r: ReturnType<typeof evaluateUs>) => [r.current, ...r.alwaysOn].flatMap((c) => (c ? [c.headline, c.why] : [])).join(" ");

describe("US next steps (r/personalfinance order)", () => {
  it("a household meeting every step gets the options card", () => {
    const r = evaluateUs(usSnapshot(), pack);
    expect(r.current).toBeNull();
    expect(r.alwaysOn).toEqual([]);
    expect(r.ladder.map((l) => l.step)).toEqual(["us.budget", "us.starter-fund", "us.employer-match", "us.debt", "us.hsa", "us.ira", "us.401k", "us.goals"]);
    expect(r.options.map((o) => o.id)).toContain("taxable-investing");
    expect(r.rulePack).toBe("US-2026.1");
    expect(r.chart).toBe("CHART-US-1");
  });

  it("starter fund: the greater of $1,000 or one month's pay", () => {
    const r = evaluateUs(usSnapshot({ liquidSavingsMinor: toMinor(2000) }), pack);
    expect(r.current?.check).toBe("us.starter-fund");
    expect(r.current?.headline).toBe("Save $3,000 more for a starter emergency fund");
  });

  it("starter fund: with no pay yet, one month of essential spending", () => {
    const r = evaluateUs(usSnapshot({ members: [], netMonthlyPayMinor: 0, liquidSavingsMinor: 0 }), pack);
    expect(r.current?.check).toBe("us.starter-fund");
    expect(r.current?.headline).toBe("Save $3,000 more for a starter emergency fund");
    expect(r.current?.why).toContain("1 month of essential spending");
  });

  it("an unclaimed employer match shows beside the current step", () => {
    const m = usMember({ pension: { ...usMember().pension, employeeRate: 0.02 } });
    const r = evaluateUs(usSnapshot({ members: [m], liquidSavingsMinor: toMinor(2000) }), pack);
    expect(r.current?.check).toBe("us.starter-fund");
    expect(r.alwaysOn.map((c) => c.check)).toEqual(["us.employer-match"]);
    expect(r.alwaysOn[0]!.headline).toBe("Alex: contribute 5% to get the full employer match");
  });

  it("high-interest debt (above 10%) comes before the full emergency fund", () => {
    const debts = [
      { id: "cc", name: "Credit card", balanceMinor: toMinor(4000), apr: 0.24, minPaymentMinor: toMinor(100), kind: "creditCard" },
      { id: "car", name: "Car loan", balanceMinor: toMinor(9000), apr: 0.07, minPaymentMinor: toMinor(250), kind: "loan" },
    ];
    const r = evaluateUs(usSnapshot({ debts, liquidSavingsMinor: toMinor(6000) }), pack);
    expect(r.current?.check).toBe("us.debt.high-interest");
    expect(r.current?.headline).toBe("Pay off $4,000 of high-interest debt (above 10%)");
    // Once cleared, the 7% loan waits until the last step.
    const r2 = evaluateUs(usSnapshot({ debts: [debts[1]!] }), pack);
    expect(r2.current?.check).toBe("us.goals.moderate-debt");
  });

  it("full emergency fund: 6 months for a single earner", () => {
    const r = evaluateUs(usSnapshot({ liquidSavingsMinor: toMinor(10000) }), pack);
    expect(r.current?.check).toBe("us.debt.full-fund");
    expect(r.current?.headline).toBe("Grow your emergency fund to $30,000");
  });

  it("HSA: with an HSA-eligible plan, keep pace with the year's limit", () => {
    const r = evaluateUs(usSnapshot({ members: [usMember({}, { hsaCoverage: "family", hsaContribYtdMinor: toMinor(2000) })] }), pack);
    expect(r.current?.check).toBe("us.hsa");
    expect(r.current?.why).toContain("$8,750");
  });

  it("IRA: above the Roth IRA income limit, the card says so", () => {
    const r = evaluateUs(usSnapshot({ members: [usMember({}, { iraContribYtdMinor: 0, magiMinor: toMinor(200000) })] }), pack);
    expect(r.current?.check).toBe("us.ira");
    expect(r.current?.why).toContain("above the Roth IRA limit");
  });

  it("401(k): raise deferrals toward the year's limit", () => {
    const r = evaluateUs(usSnapshot({ members: [usMember({}, { employeeDeferralMinor: toMinor(10000) })] }), pack);
    expect(r.current?.check).toBe("us.401k");
    expect(r.current?.headline).toBe("Alex: raise 401(k) contributions toward $24,500 a year");
  });

  it("speaks dollars and US terms only", () => {
    const cases = [
      usSnapshot({ liquidSavingsMinor: toMinor(2000) }),
      usSnapshot({ members: [usMember({}, { iraContribYtdMinor: 0 })] }),
      usSnapshot({ tracking: { hasBudgetThisPeriod: false, transactionsLast60Days: 5, uncategorisedLast60Days: 0 } }),
    ];
    for (const s of cases) {
      const t = text(evaluateUs(s, pack));
      expect(t).not.toMatch(/€|euro|PRSI|USC|Revenue|PRSA|DIRT|pension relief/i);
    }
  });

  it("every card cites the US pack or chart", () => {
    const r = evaluateUs(usSnapshot({ members: [usMember({}, { iraContribYtdMinor: 0 })] }), pack);
    expect(r.current!.sources.length).toBeGreaterThan(0);
    expect(r.current!.rulePack).toBe("US-2026.1");
  });
});
