import { describe, expect, it } from "vitest";
import { getPack, toMinor } from "@cuntas/rules";
import { evaluate, fundBasisUsed } from "../src";
import { member, snapshot } from "./fixtures";

const pack = getPack("IE", "2026");

describe("next-step engine", () => {
  it("a household meeting every step gets the options card", () => {
    const r = evaluate(snapshot(), pack);
    expect(r.current).toBeNull();
    expect(r.alwaysOn).toEqual([]);
    expect(r.options.map((o) => o.id)).toContain("save-or-invest");
    expect(r.options.map((o) => o.id)).toContain("overpay-mortgage");
    expect(r.ladder.map((l) => l.order)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("step 0: no tracking comes first", () => {
    const r = evaluate(snapshot({ tracking: { hasBudgetThisPeriod: false, transactionsLast30Days: 0, uncategorisedLast30Days: 0 } }), pack);
    expect(r.current?.check).toBe("ie.track-budget.tracking");
    expect(r.current?.rulePack).toBe("IE-2026.3");
    expect(r.current?.sources.length).toBeGreaterThan(0);
  });

  it("step 0: a self-employed household is asked to set aside tax until the goal covers it", () => {
    const tax = { monthlySetAsideMinor: toMinor(1200), plannedMonthlyMinor: toMinor(400), nextDeadline: "2026-10-31" };
    const r = evaluate(snapshot({ selfEmployedTax: tax }), pack);
    expect(r.current?.check).toBe("ie.track-budget.tax-set-aside");
    expect(r.current?.headline).toBe("Set aside €1,200 a month for tax on self-employed income");
    expect(r.current?.deadline).toBe("2026-10-31");
    expect(evaluate(snapshot({ selfEmployedTax: { ...tax, plannedMonthlyMinor: toMinor(1200) } }), pack).current).toBeNull();
  });

  it("step 1: starter fund is the greater of EUR 1,500 or one month's net pay", () => {
    const r = evaluate(snapshot({ liquidSavingsMinor: toMinor(2000) }), pack);
    expect(r.current?.step).toBe("ie.starter-fund");
    expect(r.current?.progress).toEqual({ current: toMinor(2000), target: toMinor(3200), unit: "EUR" });
    expect(r.current?.headline).toBe("Save €1,200 more for your starter emergency fund");
    const low = evaluate(snapshot({ liquidSavingsMinor: toMinor(1000), netMonthlyPayMinor: toMinor(1000) }), pack);
    expect(low.current?.progress.target).toBe(toMinor(1500));
  });

  it("with no pay recorded, the funds are based on essential spending instead", () => {
    const noPay = { liquidSavingsMinor: toMinor(500), netMonthlyPayMinor: 0, essentialMonthlySpendMinor: toMinor(2400) };
    const r = evaluate(snapshot(noPay), pack);
    expect(fundBasisUsed(snapshot(noPay))).toBe("essentialSpend");
    expect(r.current?.progress.target).toBe(toMinor(2400));
    expect(r.current?.why).toContain("1 month's essential spending (€2,400)");
    // Neither known: the floor.
    expect(evaluate(snapshot({ ...noPay, essentialMonthlySpendMinor: 0 }), pack).current?.progress.target).toBe(toMinor(1500));
    expect(fundBasisUsed(snapshot())).toBe("netPay");
  });

  it("step 2 is always-on: an unclaimed match shows as a second card beside the current step", () => {
    const m = member({ pension: { ...member().pension, employeeRate: 0.02, employerRate: 0.02, fullMatchEmployeeRate: 0.06 } });
    const r = evaluate(
      snapshot({
        members: [m],
        sinkingFunds: [{ id: "car", name: "Car for work", targetMinor: toMinor(8000), savedMinor: toMinor(1000), dueDate: "2027-10-01", monthlyContributionMinor: toMinor(100) }],
      }),
      pack,
    );
    expect(r.current?.step).toBe("ie.required-purchases");
    expect(r.current?.headline).toBe("Save €636 a month for Car for work by 2027-10-01");
    expect(r.alwaysOn).toHaveLength(1);
    expect(r.alwaysOn[0]!.check).toBe("ie.employer-match.pension");
    expect(r.alwaysOn[0]!.headline).toBe("Aoife: you're leaving €2,000 a year of employer pension match unclaimed");
  });

  it("step 2: flags MyFutureFund opt-out", () => {
    const m = member({ pension: { ...member().pension, hasEmployerScheme: false, employeeRate: 0, employerRate: 0, fullMatchEmployeeRate: 0, myFutureFund: "opted-out" } });
    const r = evaluate(snapshot({ members: [m] }), pack);
    expect(r.alwaysOn[0]?.check).toBe("ie.employer-match.myfuturefund");
    expect(r.alwaysOn[0]?.headline).toBe("Aoife: opting out of MyFutureFund gives up €1,000 a year");
  });

  it("step 3: high-interest debt, then full fund, then moderate debt", () => {
    const debts = [
      { id: "cc", name: "Credit card", balanceMinor: toMinor(2500), apr: 0.226, minPaymentMinor: toMinor(75), kind: "creditCard" },
      { id: "cu", name: "Credit union loan", balanceMinor: toMinor(4000), apr: 0.07, minPaymentMinor: toMinor(150), kind: "loan" },
    ];
    let r = evaluate(snapshot({ debts, liquidSavingsMinor: toMinor(5000) }), pack);
    expect(r.current?.check).toBe("ie.debt.high-interest");
    expect(r.current?.why).toContain("Credit card at 22.6%");

    r = evaluate(snapshot({ debts: debts.slice(1), liquidSavingsMinor: toMinor(5000) }), pack);
    expect(r.current?.check).toBe("ie.debt.full-fund");
    // Single income: upper end, 6 months x 3,200 = 19,200.
    expect(r.current?.progress.target).toBe(toMinor(19200));

    r = evaluate(snapshot({ debts: debts.slice(1) }), pack);
    expect(r.current?.check).toBe("ie.debt.moderate");
  });

  it("step 3: two-income households use the lower end", () => {
    const r = evaluate(snapshot({ members: [member(), member({ id: "member-2", name: "Seán" })], liquidSavingsMinor: toMinor(5000) }), pack);
    expect(r.current?.check).toBe("ie.debt.full-fund");
    expect(r.current?.progress.target).toBe(toMinor(9600));
  });

  it("step 5: half-your-age gauge with relief headroom in the explanation", () => {
    const m = member({ age: 40, pension: { ...member().pension, employeeRate: 0.05, employerRate: 0.05, fullMatchEmployeeRate: 0.05 } });
    const r = evaluate(snapshot({ members: [m] }), pack);
    expect(r.current?.check).toBe("ie.retirement.half-age");
    expect(r.current?.progress).toEqual({ current: 10, target: 20, unit: "%" });
    expect(r.current?.why).toContain("Your age-band relief limit is 25%");
    expect(r.current?.deadline).toBe("2027-10-31");
  });

  it("a UK-resident household gets no Irish-only explanations", () => {
    const uk = member({ residence: "UK", age: 40, pension: { ...member().pension, employeeRate: 0.05, employerRate: 0.05, fullMatchEmployeeRate: 0.05 } });
    const fund = evaluate(snapshot({ members: [uk], liquidSavingsMinor: toMinor(2000) }), pack);
    expect(fund.current?.step).toBe("ie.starter-fund");
    expect(fund.current?.why).not.toMatch(/DIRT/);
    expect(fund.current?.sources.map((s) => s.key)).not.toContain("dirt.rate");
    const ret = evaluate(snapshot({ members: [uk] }), pack);
    expect(ret.current?.check).toBe("ie.retirement.half-age");
    expect(ret.current?.why).not.toMatch(/age-band|PRSA|AVC/);
    expect(ret.current?.deadline).toBeUndefined();
    // An Irish resident still gets them.
    expect(evaluate(snapshot({ liquidSavingsMinor: toMinor(2000) }), pack).current?.why).toMatch(/DIRT/);
  });

  it("step 6: mortgage readiness for renters", () => {
    const r = evaluate(
      snapshot({ housing: { ownsHome: false, monthlyRentMinor: toMinor(1200), monthlyDepositSavingMinor: toMinor(300), expectedMortgagePaymentMinor: toMinor(1800), mortgageMonthlyPaymentMinor: null } }),
      pack,
    );
    expect(r.current?.check).toBe("ie.advanced.mortgage-ready");
    expect(r.current?.headline).toContain("€300");
  });

  it("'not relevant to me' skips a check", () => {
    const s = snapshot({ liquidSavingsMinor: toMinor(100), dismissed: [{ stepId: "ie.starter-fund", reason: "Saving elsewhere" }] });
    const r = evaluate(s, pack);
    expect(r.current?.step).not.toBe("ie.starter-fund");
    expect(r.ladder[1]!.checks[0]!.status).toBe("dismissed");
  });

  it("is deterministic", () => {
    const s = snapshot({ liquidSavingsMinor: toMinor(100) });
    expect(evaluate(s, pack)).toEqual(evaluate(structuredClone(s), pack));
  });

  it("every card cites its rule pack and sources", () => {
    const r = evaluate(snapshot({ tracking: { hasBudgetThisPeriod: false, transactionsLast30Days: 0, uncategorisedLast30Days: 0 } }), pack);
    for (const card of [r.current!, ...r.alwaysOn]) {
      expect(card.rulePack).toMatch(/^IE-/);
      expect(card.chart).toBe("CHART-2.1");
      for (const s of card.sources) expect(s.source).toMatch(/^https:\/\//);
    }
  });
});
