import { describe, expect, it } from "vitest";
import { toMinor } from "@cuntas/rules";
import { accountSchema, buildSnapshot, createEmptyDataset, maxBalanceBetween, newMember, retirementPlan, usPersonReports, type Account, type Dataset, type Transaction } from "../src";

const asOf = "2026-10-22";

function tx(id: string, accountId: string, bookedAt: string, amount: number, currency: Transaction["currency"] = "EUR"): Transaction {
  return { id, accountId, bookedAt, amountMinor: toMinor(amount), currency, fxRateToBase: null, payee: "x", rawDescription: "x", externalId: id, categoryId: null, categorySource: "none", transferPairId: null, splits: [], notes: "" };
}

function account(over: Partial<Account> & Pick<Account, "id" | "name" | "memberIds">): Account {
  return accountSchema.parse({ type: "current", currency: "EUR", jurisdiction: "IE", openingDate: "2025-01-01", ...over });
}

/** Sam, a US citizen living in Ireland, with Irish accounts. 1 EUR = 1.10 USD at the time. */
function samInIreland(): Dataset {
  const ds = createEmptyDataset("Home", "EUR", `${asOf}T00:00:00Z`);
  ds.members = [newMember({ id: "m_sam", name: "Sam", dateOfBirth: "1985-05-20", nationality: ["US", "IE"] }), newMember({ id: "m_aoife", name: "Aoife", dateOfBirth: "1986-02-11", nationality: ["IE"] })];
  ds.residencePeriods = ds.members.map((m) => ({ id: `rp_${m.id}`, memberId: m.id, jurisdiction: "IE" as const, from: "2015-01-01", to: null, declaredBy: "user" as const }));
  ds.fxRates = [{ date: "2026-01-02", base: "EUR", quote: "USD", rate: 1.1, source: "ECB" }];
  ds.accounts = [
    account({ id: "a_cur", name: "Joint current", memberIds: ["m_sam", "m_aoife"], openingBalanceMinor: toMinor(5000) }),
    account({ id: "a_brk", name: "Fund account", memberIds: ["m_sam"], type: "brokerage", valuations: [{ date: "2026-03-01", valueMinor: toMinor(20000) }, { date: "2026-09-01", valueMinor: toMinor(18000) }] }),
    account({ id: "a_us", name: "US checking", memberIds: ["m_sam"], currency: "USD", jurisdiction: "US" }),
  ];
  ds.transactions = [tx("t1", "a_cur", "2025-12-15", 1000), tx("t2", "a_cur", "2026-03-01", 8000), tx("t3", "a_cur", "2026-03-01", -500), tx("t4", "a_cur", "2026-04-01", -9000)];
  return ds;
}

describe("highest balance in a period", () => {
  it("is the end-of-day peak, counting the balance carried in", () => {
    const ds = samInIreland();
    // 6,000 carried in, 13,500 at the end of 1 March, 4,500 after April.
    expect(maxBalanceBetween(ds.accounts[0]!, ds.transactions, "2026-01-01", "2026-12-31")).toBe(toMinor(13500));
    // From 2 April only the 4,500 left after the April payment counts.
    expect(maxBalanceBetween(ds.accounts[0]!, ds.transactions, "2026-04-02", "2026-12-31")).toBe(toMinor(4500));
  });
  it("for a valued account, the highest valuation in the period", () => {
    const ds = samInIreland();
    expect(maxBalanceBetween(ds.accounts[1]!, [], "2026-01-01", "2026-12-31")).toBe(toMinor(20000));
  });
});

describe("US person report", () => {
  it("only US citizens and US residents get one", () => {
    expect(usPersonReports(samInIreland(), asOf).map((r) => r.name)).toEqual(["Sam"]);
  });

  it("FBAR from the foreign accounts' highest balances in dollars; the US account doesn't count", () => {
    const [sam] = usPersonReports(samInIreland(), asOf);
    expect(sam!.holdings.map((h) => h.id)).toEqual(["a_cur", "a_brk"]);
    expect(sam!.livesAbroad).toBe(true);
    // (13,500 + 20,000) x 1.10 = 36,850.
    expect(sam!.reporting!.fbar).toMatchObject({ required: true, aggregateMaxMinor: toMinor(36850), due: "2027-04-15" });
    // Living abroad, single: 200,000 / 300,000.
    expect(sam!.reporting!.form8938.required).toBe(false);
    expect(sam!.reporting!.returnDueAbroad).toBe("2027-06-15");
  });

  it("notes filing from abroad, the PFIC fund account and the joint account", () => {
    const [sam] = usPersonReports(samInIreland(), asOf);
    const text = sam!.notes.map((n) => n.text).join(" ");
    expect(text).toContain("file a US return every year");
    expect(text).toContain("Fund account: funds and ETFs domiciled outside the US are PFICs");
    expect(text).toContain("joint account counts in full");
    expect(sam!.notes.every((n) => n.source.startsWith("https://"))).toBe(true);
  });

  it("says which currencies have no rate instead of guessing", () => {
    const ds = samInIreland();
    ds.fxRates = [];
    const [sam] = usPersonReports(ds, asOf);
    expect(sam!.missingRates).toEqual(["EUR"]);
  });

  it("a US resident with an account back in Ireland reports it, with the US thresholds", () => {
    const ds = samInIreland();
    ds.residencePeriods = ds.residencePeriods.map((r) => (r.memberId === "m_sam" ? { ...r, jurisdiction: "US" as const } : r));
    const [sam] = usPersonReports(ds, asOf);
    expect(sam!.livesAbroad).toBe(false);
    expect(sam!.reporting!.form8938).toMatchObject({ yearEndThresholdMinor: toMinor(50000), anyTimeThresholdMinor: toMinor(75000) });
    expect(sam!.notes.map((n) => n.text).join(" ")).not.toContain("file a US return every year");
  });

  it("the engine knows Sam is a US citizen", () => {
    const snap = buildSnapshot(samInIreland(), asOf);
    expect(snap.members.find((m) => m.name === "Sam")!.usCitizen).toBe(true);
    expect(snap.members.find((m) => m.name === "Aoife")!.usCitizen).toBe(false);
  });
});

describe("Social Security in the retirement projection", () => {
  function usResident(over: Parameters<typeof newMember>[0]): Dataset {
    const ds = createEmptyDataset("US", "USD", `${asOf}T00:00:00Z`);
    ds.members = [newMember({ nationality: ["US"], grossAnnualMinor: toMinor(60000), ...over })];
    ds.residencePeriods = [{ id: "rp", memberId: ds.members[0]!.id, jurisdiction: "US", from: "2010-01-01", to: null, declaredBy: "user" }];
    return ds;
  }

  it("a US resident gets Social Security from 67 by default, retiring at full retirement age", () => {
    const plan = retirementPlan(usResident({ id: "m1", name: "Alex", dateOfBirth: "1985-05-20", usCoveredYears: 13 }), asOf);
    const alex = plan.members[0]!;
    expect(alex.retirementAge).toBe(67);
    // 13 years so far and 26 more to 67: the best 35 at 60,000 is an AIME of 5,000, PIA 2,345.80, 2,345 a month.
    expect(alex.statePensions).toEqual([{ jurisdiction: "US", annualMinor: toMinor(2345 * 12), startAge: 67 }]);
    expect(plan.rules.map((r) => r.key)).toContain("socialSecurity");
  });

  it("an SSA statement figure and a claiming age are used as given", () => {
    const plan = retirementPlan(usResident({ id: "m1", name: "Alex", dateOfBirth: "1985-05-20", usSsStatementMinor: toMinor(2000), usClaimAge: 70 }), asOf);
    expect(plan.members[0]!.statePensions[0]).toEqual({ jurisdiction: "US", annualMinor: toMinor(2480 * 12), startAge: 70 });
  });

  it("asks for years of work when it has to assume them, and notes Roth conversions before claiming", () => {
    const ds = usResident({ id: "m1", name: "Alex", dateOfBirth: "1985-05-20", retirementAge: 60, usClaimAge: 67 });
    ds.pensionPlans = [{ ...ds.pensionPlans[0]!, id: "p1", memberId: "m1", name: "401(k)", kind: "us401k", jurisdiction: "US", currency: "USD", valueMinor: toMinor(100000) } as Dataset["pensionPlans"][number]];
    const notes = retirementPlan(ds, asOf).notes.join(" ");
    expect(notes).toContain("enter years of US work");
    // Irish pots alone don't bring the Roth note.
    const irish = usResident({ id: "m1", name: "Alex", dateOfBirth: "1985-05-20", retirementAge: 60, usClaimAge: 67 });
    irish.pensionPlans = [{ ...ds.pensionPlans[0]!, kind: "PRSA", jurisdiction: "IE", currency: "EUR" }];
    expect(retirementPlan(irish, asOf).notes.join(" ")).not.toContain("to Roth");
    expect(notes).toContain("Converting some traditional IRA or 401(k) money to Roth");
  });

  it("a pension recorded as an account and as a plan counts once", () => {
    const ds = samInIreland();
    ds.accounts.push(account({ id: "a_pen", name: "Pension (account)", memberIds: ["m_sam"], type: "pension", valuations: [{ date: "2026-01-10", valueMinor: toMinor(30000) }] }));
    const [noPlan] = usPersonReports(ds, asOf);
    expect(noPlan!.holdings.find((h) => h.id === "a_pen")).toMatchObject({ kind: "pension" });
    ds.pensionPlans = [{ id: "p_sam", memberId: "m_sam", name: "Pension (plan)", kind: "PRSA", jurisdiction: "IE", currency: "EUR", valueMinor: toMinor(30000) } as Dataset["pensionPlans"][number]];
    const [withPlan] = usPersonReports(ds, asOf);
    expect(withPlan!.holdings.filter((h) => h.kind === "pension").map((h) => h.id)).toEqual(["p_sam"]);
    // Pensions count for Form 8938 but not the FBAR total here.
    expect(withPlan!.reporting!.fbar.aggregateMaxMinor).toBe(toMinor(36850));
    expect(withPlan!.reporting!.form8938.maxMinor).toBe(toMinor(36850) + toMinor(33000));
  });

  it("someone who once worked in the US but lives in Ireland gets it from their statement", () => {
    const ds = samInIreland();
    ds.members[0] = { ...ds.members[0]!, usCoveredYears: 6, usSsStatementMinor: toMinor(900) };
    const sam = retirementPlan(ds, asOf).members.find((m) => m.name === "Sam")!;
    expect(sam.statePensions.find((s) => s.jurisdiction === "US")).toMatchObject({ startAge: 67 });
    expect(retirementPlan(samInIreland(), asOf).members.find((m) => m.name === "Sam")!.statePensions.some((s) => s.jurisdiction === "US")).toBe(false);
  });
});
