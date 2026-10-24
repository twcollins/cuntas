import { describe, expect, it } from "vitest";
import { addDays, addMonths, toMinor } from "@cuntas/rules";
import {
  createDemoDataset,
  createEmptyDataset,
  datasetSchema,
  detectRecurring,
  exportJson,
  importJson,
  nextDueOf,
  residenceWhatIf,
  retirementPlan,
  upcomingBills,
  withResidence,
  type Dataset,
  type Transaction,
} from "../src";

const asOf = "2026-10-22";

function tx(i: number, bookedAt: string, amountMinor: number, payee: string): Transaction {
  return { id: `t${i}`, accountId: "a", bookedAt, amountMinor, currency: "EUR", fxRateToBase: null, payee, rawDescription: payee, externalId: `e${i}`, categoryId: null, categorySource: "none", transferPairId: null, splits: [], notes: "" };
}

function ledger(txs: Transaction[]): Dataset {
  const ds = createEmptyDataset("Test", "EUR", `${asOf}T00:00:00Z`);
  ds.accounts = [{ id: "a", name: "Current", memberIds: [], type: "current", currency: "EUR", institutionId: null, wrapper: "none", jurisdiction: "IE", openingBalanceMinor: 0, openingDate: "2025-01-01", valuations: [], isEmergencyFund: false, archived: false }];
  ds.transactions = txs;
  return ds;
}

describe("recurring-bill detection", () => {
  it("finds a monthly subscription and its next date", () => {
    const txs = [0, 1, 2, 3, 4].map((m) => tx(m, addMonths("2026-05-12", m), -1499, "NETFLIX.COM 4471"));
    const [s] = detectRecurring(ledger(txs), asOf);
    expect(s).toMatchObject({ cadence: "monthly", occurrences: 5, nextDate: "2026-11-12", lastAmountMinor: 1499, annualCostMinor: 1499 * 12, fixedPrice: true, priceChange: null, status: "active" });
  });
  it("flags a price rise", () => {
    const amounts = [1799, 1799, 1799, 1999];
    const txs = amounts.map((a, m) => tx(m, addMonths("2026-07-12", m - 1), -a, "Spotify"));
    const [s] = detectRecurring(ledger(txs), asOf);
    expect(s!.priceChange).toMatchObject({ fromMinor: 1799, toMinor: 1999 });
  });
  it("ignores weekly groceries that vary, and one-off payments", () => {
    const txs = [0, 7, 14, 21, 28].map((d, i) => tx(i, addDays("2026-09-01", d), -(4000 + i * 900), "Tesco"));
    txs.push(tx(99, "2026-09-03", -25000, "Harvey Norman"));
    expect(detectRecurring(ledger(txs), asOf)).toEqual([]);
  });
  it("skips monthly shopping whose amount swings, but keeps a varying essential bill", () => {
    const shop = [3000, 9000, 4500, 7000].map((a, m) => tx(m, addMonths("2026-06-07", m), -a, "Penneys"));
    const energy = [12000, 17000, 14000, 16500].map((a, m) => ({ ...tx(10 + m, addMonths("2026-06-10", m), -a, "Electric Ireland"), categoryId: "cat_energy" }));
    expect(detectRecurring(ledger([...shop, ...energy]), asOf).map((s) => s.payee)).toEqual(["Electric Ireland"]);
  });
  it("marks a payment that stopped as lapsed", () => {
    const txs = [0, 1, 2].map((m) => tx(m, addMonths("2026-02-04", m), -1000, "Gym Plus"));
    expect(detectRecurring(ledger(txs), asOf)[0]!.status).toBe("lapsed");
  });
  it("respects dismissals and lists upcoming bills from both sources", () => {
    const txs = [0, 1, 2].map((m) => tx(m, addMonths("2026-08-05", m), -5500, "Virgin Media"));
    const ds = ledger(txs);
    ds.bills = [{ id: "b", name: "Motor tax", template: "ie-motor-tax", cadence: "annual", amountMinor: toMinor(280), currency: "EUR", nextDue: "2025-11-01", categoryId: null, payeeKey: null }];
    expect(nextDueOf(ds.bills[0]!, asOf)).toBe("2026-11-01");
    expect(upcomingBills(ds, asOf, 30).map((b) => [b.date, b.name])).toEqual([["2026-11-01", "Motor tax"], ["2026-11-05", "Virgin Media"]]);
    expect(detectRecurring({ ...ds, recurringDismissed: [detectRecurring(ds, asOf)[0]!.key] }, asOf)).toEqual([]);
  });
  it("detects the demo household's bills, including the Spotify price rise", () => {
    const found = detectRecurring(createDemoDataset(asOf), asOf);
    expect(found.map((s) => s.payee)).toEqual(expect.arrayContaining(["Rent M Kelly", "Netflix", "VHI Healthcare", "Spotify"]));
    expect(found.find((s) => s.payee === "Spotify")).toMatchObject({ fixedPrice: true, priceChange: { fromMinor: 1799, toMinor: 1999 } });
    expect(found.map((s) => s.payee)).not.toContain("Penneys");
  });
});

describe("dataset compatibility", () => {
  it("loads a version-1 dataset saved before payslips and bills existed", () => {
    const old = JSON.parse(exportJson(createDemoDataset(asOf)));
    delete old.payslips;
    delete old.bills;
    delete old.recurringDismissed;
    for (const m of old.members) {
      delete m.ukRegion;
      delete m.studentLoans;
      delete m.selfAssessment;
    }
    const parsed = datasetSchema.parse(old);
    expect(parsed.bills).toEqual([]);
    expect(parsed.members[0]!.ukRegion).toBe("rUK");
    expect(importJson(exportJson(parsed))).toEqual(parsed);
  });
});

describe("retirement plan", () => {
  it("projects both members with Irish and UK State Pensions in base currency", () => {
    const plan = retirementPlan(createDemoDataset(asOf), asOf);
    expect(plan.projections.map((p) => p.scenario.id)).toEqual(["low", "central", "high"]);
    const sean = plan.members.find((m) => m.id === "m_sean")!;
    expect(sean.statePensions.map((s) => s.jurisdiction).sort()).toEqual(["IE", "UK"]);
    const [low, central, high] = plan.projections;
    expect(low!.householdAnnualMinor).toBeLessThan(central!.householdAnnualMinor);
    expect(central!.householdAnnualMinor).toBeLessThan(high!.householdAnnualMinor);
  });
});

describe("residence what-if", () => {
  const ds = createDemoDataset(asOf);
  it("moving to the UK makes Seán's ISA tax-free and his pay sterling", () => {
    const r = residenceWhatIf(ds, asOf, { memberIds: ["m_sean"], to: "UK", keepJob: false });
    const isa = r.items.find((i) => i.label.includes("ISA"))!;
    expect(isa.before.taxedBy).toEqual(["IE"]);
    expect(isa.after.taxedBy).toEqual([]);
    expect(isa.changed).toBe(true);
    expect(r.members[0]!.payAfter.currency).toBe("GBP");
    expect(r.notes.length).toBeGreaterThan(0);
  });
  it("keeping an Irish job after moving makes the pay cross-border", () => {
    const r = residenceWhatIf(ds, asOf, { memberIds: ["m_sean"], to: "UK", keepJob: true });
    expect(r.items.find((i) => i.label === "Employment income")!.after.taxedBy).toEqual(["IE", "UK"]);
  });
  it("staying put changes nothing", () => {
    const r = residenceWhatIf(ds, asOf, { memberIds: ["m_aoife"], to: "IE", keepJob: false });
    expect(r.items).toEqual([]);
    expect(r.notes).toEqual([]);
  });
  it("closes the open residence period the day before the move", () => {
    const after = withResidence(ds, "m_sean", "UK", asOf);
    const periods = after.residencePeriods.filter((p) => p.memberId === "m_sean").sort((a, b) => a.from.localeCompare(b.from));
    expect(periods.at(-2)!.to).toBe("2026-10-21");
    expect(periods.at(-1)).toMatchObject({ jurisdiction: "UK", from: asOf, to: null });
  });
});
