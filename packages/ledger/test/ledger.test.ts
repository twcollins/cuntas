import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { importFile } from "@cuntas/importers";
import { evaluate } from "@cuntas/engine";
import { packOn, toMinor, type Currency } from "@cuntas/rules";
import {
  budgetReport,
  buildSnapshot,
  categorise,
  comparePayoff,
  createDemoDataset,
  createEmptyDataset,
  exportCsv,
  exportJson,
  FxTable,
  importJson,
  importStatement,
  netWorthSeries,
  parseEcbXml,
  paydayWaterfall,
  periodOf,
  periodRange,
  planPayoff,
  suggestRule,
  totalsByCategory,
  type Account,
  type Dataset,
  type Transaction,
} from "../src";

const AS_OF = "2026-10-22";
const fixture = (name: string) => readFileSync(join(__dirname, "../../importers/fixtures", name), "utf8");

function account(id: string, currency: Currency, type: Account["type"] = "current"): Account {
  return { id, name: id, memberIds: [], type, currency, institutionId: null, wrapper: "none", jurisdiction: currency === "EUR" ? "IE" : "UK", openingBalanceMinor: 0, openingDate: "2026-01-01", valuations: [], isEmergencyFund: false, archived: false };
}

function base(): Dataset {
  const ds = createEmptyDataset("Test");
  ds.accounts = [account("eur", "EUR"), account("gbp", "GBP"), account("eur2", "EUR")];
  ds.fxRates = [{ date: "2026-09-01", base: "EUR", quote: "GBP", rate: 0.85, source: "test" }];
  return ds;
}

describe("import", () => {
  it("re-importing the same file creates no duplicates", () => {
    const ds = base();
    const statement = importFile("aib.csv", fixture("aib.csv"));
    const first = importStatement(ds, "eur", statement);
    expect(first.added).toBe(3);
    const second = importStatement(first.dataset, "eur", importFile("aib.csv", fixture("aib.csv")));
    expect(second.added).toBe(0);
    expect(second.skipped).toBe(3);
    expect(second.dataset.transactions).toHaveLength(3);
  });

  it("categorises on import from the merchant dictionary", () => {
    const { dataset } = importStatement(base(), "eur", importFile("aib.csv", fixture("aib.csv")));
    const byPayee = Object.fromEntries(dataset.transactions.map((t) => [t.payee, t.categoryId]));
    expect(byPayee["DUNNES STORES"]).toBe("cat_groceries");
    expect(byPayee["SALARY ACME LTD"]).toBe("cat_salary");
    expect(byPayee["ELECTRIC IRELAND"]).toBe("cat_energy");
  });
});

describe("transfers and FX", () => {
  it("a EUR to GBP transfer pair nets to zero spending", () => {
    let ds = base();
    ds = importStatement(ds, "eur", { format: "csv", warnings: [], transactions: [{ bookedAt: "2026-09-03", amountMinor: -20000, currency: "EUR", payee: "To GBP", rawDescription: "To GBP", externalId: "a" }] }).dataset;
    ds = importStatement(ds, "gbp", { format: "csv", warnings: [], transactions: [{ bookedAt: "2026-09-03", amountMinor: 16920, currency: "GBP", payee: "From EUR", rawDescription: "From EUR", externalId: "b" }] }).dataset;
    const [a, b] = ds.transactions;
    expect(a!.transferPairId).toBe(b!.id);
    expect(b!.transferPairId).toBe(a!.id);
    const totals = totalsByCategory(ds, "2026-09-01", "2026-09-30");
    const spent = [...totals.values()].reduce((s, t) => s + t.spentMinor - t.incomeMinor, 0);
    expect(spent).toBe(0);
  });

  it("does not pair amounts outside the tolerance or window", () => {
    let ds = base();
    ds = importStatement(ds, "eur", { format: "csv", warnings: [], transactions: [{ bookedAt: "2026-09-03", amountMinor: -20000, currency: "EUR", payee: "x", rawDescription: "x", externalId: "a" }] }).dataset;
    ds = importStatement(ds, "gbp", { format: "csv", warnings: [], transactions: [{ bookedAt: "2026-09-03", amountMinor: 15000, currency: "GBP", payee: "y", rawDescription: "y", externalId: "b" }] }).dataset;
    ds = importStatement(ds, "eur2", { format: "csv", warnings: [], transactions: [{ bookedAt: "2026-09-20", amountMinor: 20000, currency: "EUR", payee: "z", rawDescription: "z", externalId: "c" }] }).dataset;
    expect(ds.transactions.every((t) => t.transferPairId === null)).toBe(true);
  });

  it("uses the latest ECB rate on or before a date", () => {
    const fx = new FxTable([
      { date: "2026-09-01", base: "EUR", quote: "GBP", rate: 0.85, source: "t" },
      { date: "2026-09-04", base: "EUR", quote: "GBP", rate: 0.86, source: "t" },
    ]);
    expect(fx.eurGbp("2026-09-03")).toBe(0.85);
    expect(fx.convert(10000, "EUR", "GBP", "2026-09-05")).toBe(8600);
    expect(fx.convert(8600, "GBP", "EUR", "2026-09-05")).toBe(10000);
  });

  it("converts any pair through EUR, using each currency's latest rate", () => {
    const fx = new FxTable([
      { date: "2026-09-01", base: "EUR", quote: "GBP", rate: 0.85, source: "t" },
      { date: "2026-09-01", base: "EUR", quote: "USD", rate: 1.1, source: "t" },
      { date: "2026-09-04", base: "EUR", quote: "USD", rate: 1.2, source: "t" },
    ]);
    expect(fx.convert(10000, "EUR", "USD", "2026-09-02")).toBe(11000);
    expect(fx.convert(12000, "USD", "EUR", "2026-09-05")).toBe(10000);
    // USD -> GBP: 0.85 / 1.2 per dollar.
    expect(fx.convert(12000, "USD", "GBP", "2026-09-05")).toBe(8500);
    expect(fx.has("USD")).toBe(true);
    expect(new FxTable([]).tryConvert(100, "USD", "EUR", "2026-09-05")).toBeNull();
    expect(new FxTable(fx.rates("GBP")).tryConvert(100, "USD", "GBP", "2026-09-05")).toBeNull();
  });

  it("parses ECB reference-rate XML for every supported currency", () => {
    const xml = `<Cube><Cube time='2026-10-21'><Cube currency='USD' rate='1.08'/><Cube currency='JPY' rate='160.1'/><Cube currency='GBP' rate='0.8612'/></Cube></Cube>`;
    expect(parseEcbXml(xml)).toEqual([
      { date: "2026-10-21", base: "EUR", quote: "GBP", rate: 0.8612, source: "ECB" },
      { date: "2026-10-21", base: "EUR", quote: "USD", rate: 1.08, source: "ECB" },
    ]);
  });

  it("accepts US dollar accounts and loads datasets from before USD", () => {
    const ds = createEmptyDataset("Test", "USD");
    expect(ds.household.baseCurrency).toBe("USD");
    const old = createEmptyDataset("Old", "EUR");
    const json = exportJson({ ...old, fxRates: [{ date: "2026-09-01", base: "EUR", quote: "GBP", rate: 0.85, source: "ECB" }] });
    expect(importJson(json).fxRates[0]!.quote).toBe("GBP");
  });
});

describe("categorisation", () => {
  const t = { payee: "Insomnia Coffee", rawDescription: "INSOMNIA COFFEE", amountMinor: -420, accountId: "a" };
  it("user rules beat the dictionary", () => {
    expect(categorise(t, []).categoryId).toBe("cat_eating_out");
    const rule = { id: "r", match: { payeeContains: "insomnia" }, categoryId: "cat_other", priority: 1 };
    expect(categorise(t, [rule])).toEqual({ categoryId: "cat_other", source: "rule" });
  });
  it("correcting a transaction offers a rule", () => {
    const tx = { ...t, id: "x", bookedAt: "2026-01-01", currency: "EUR", externalId: "x" } as unknown as Transaction;
    expect(suggestRule(tx, "cat_entertainment")?.match.payeeContains).toBe("insomnia coffee");
  });
});

describe("budgets", () => {
  it("payday-based periods", () => {
    expect(periodRange("2026-09", 25)).toEqual({ start: "2026-09-25", end: "2026-10-24" });
    expect(periodOf("2026-10-22", 25)).toBe("2026-09");
    expect(periodOf("2026-10-25", 25)).toBe("2026-10");
  });

  it("envelope rollover carries leftovers forward", () => {
    const ds = base();
    ds.budgets = [
      { id: "b1", period: "2026-08", mode: "envelope", lines: [{ categoryId: "cat_groceries", amountMinor: 40000, rollover: true }] },
      { id: "b2", period: "2026-09", mode: "envelope", lines: [{ categoryId: "cat_groceries", amountMinor: 40000, rollover: true }] },
    ];
    const r = importStatement(ds, "eur", {
      format: "csv", warnings: [], transactions: [
        { bookedAt: "2026-08-10", amountMinor: -30000, currency: "EUR", payee: "Tesco", rawDescription: "Tesco", externalId: "1" },
        { bookedAt: "2026-09-10", amountMinor: -45000, currency: "EUR", payee: "Tesco", rawDescription: "Tesco", externalId: "2" },
      ],
    });
    const rep = budgetReport(r.dataset, "2026-09")!;
    expect(rep.lines[0]).toMatchObject({ rolloverInMinor: 10000, spentMinor: 45000, availableMinor: 5000, overspent: false });
  });

  it("payday waterfall reports the first bucket left short", () => {
    const w = paydayWaterfall(250000, { housing: 185000, food: 50000, essentialBills: 30000, incomeCosts: 10000 });
    expect(w.firstShortBucket).toBe("essentialBills");
    expect(w.allocations.find((a) => a.bucket === "essentialBills")!.shortMinor).toBe(15000);
  });
});

describe("debt planner", () => {
  const debts = [
    { id: "cc", name: "Card", balanceMinor: toMinor(3000), apr: 0.229, minPaymentMinor: toMinor(90) },
    { id: "loan", name: "Loan", balanceMinor: toMinor(1000), apr: 0.075, minPaymentMinor: toMinor(50) },
  ];
  it("avalanche pays less interest than snowball", () => {
    const c = comparePayoff(debts, toMinor(400), "2026-11-01", toMinor(50));
    expect(c.avalanche.feasible && c.snowball.feasible).toBe(true);
    expect(c.avalanche.order).toEqual(["cc", "loan"]);
    expect(c.snowball.order).toEqual(["loan", "cc"]);
    expect(c.avalanche.totalInterestMinor).toBeLessThan(c.snowball.totalInterestMinor);
    expect(c.interestSavedByExtraMinor).toBeGreaterThan(0);
  });
  it("flags budgets that never clear the debt", () => {
    const p = planPayoff([{ id: "x", name: "x", balanceMinor: toMinor(10000), apr: 0.3, minPaymentMinor: toMinor(100) }], toMinor(100), "avalanche", "2026-11-01");
    expect(p.feasible).toBe(false);
    expect(p.warning).toBeDefined();
  });
});

describe("net worth", () => {
  it("separates the FX effect on GBP balances", () => {
    const ds = base();
    ds.accounts = [{ ...account("gbp", "GBP"), openingBalanceMinor: toMinor(8500), openingDate: "2026-01-01" }];
    ds.fxRates = [
      { date: "2026-08-01", base: "EUR", quote: "GBP", rate: 0.85, source: "t" },
      { date: "2026-09-15", base: "EUR", quote: "GBP", rate: 0.8, source: "t" },
    ];
    const s = netWorthSeries(ds, "2026-09-30", 2);
    expect(s[0]!.netMinor).toBe(toMinor(10000));
    expect(s[1]!.netMinor).toBe(1062500);
    expect(s[1]!.fxEffectMinor).toBe(62500);
  });
});

describe("export", () => {
  it("round-trips: export, wipe, import gives identical data", () => {
    const ds = createDemoDataset(AS_OF);
    const json = exportJson(ds);
    const restored = importJson(json);
    expect(restored).toEqual(ds);
    expect(exportJson(restored)).toBe(json);
  });
  it("exports one CSV per entity", () => {
    const files = exportCsv(createDemoDataset(AS_OF));
    expect(Object.keys(files)).toContain("transactions.csv");
    expect(files["household.csv"]!.split("\n")[0]).toContain("baseCurrency");
  });
  it("rejects invalid imports", () => {
    expect(() => importJson('{"schemaVersion":1}')).toThrow();
  });
});

describe("demo household end to end", () => {
  const ds = createDemoDataset(AS_OF);
  const snap = buildSnapshot(ds, AS_OF);
  const result = evaluate(snap, packOn("IE", AS_OF));

  it("builds a sensible snapshot", () => {
    expect(snap.members).toHaveLength(2);
    expect(snap.tracking.transactionsLast30Days).toBeGreaterThan(20);
    expect(snap.tracking.hasBudgetThisPeriod).toBe(true);
    expect(snap.members.find((m) => m.id === "m_sean")!.pension.myFutureFund).toBe("auto-enrolled");
    expect(snap.debts.find((d) => d.id === "debt_cc")!.balanceMinor).toBeGreaterThan(0);
  });

  it("pairs every demo transfer", () => {
    const unpaired = ds.transactions.filter((t) => /^(To |Top-up|Lodgement|BOI card|Payment received|Exchanged|Revolut transfer)/.test(t.payee) && t.transferPairId === null);
    expect(unpaired).toEqual([]);
  });

  it("puts high-interest debt next and flags Aoife's unclaimed match", () => {
    expect(result.current?.check).toBe("ie.debt.high-interest");
    expect(result.alwaysOn.map((c) => c.check)).toEqual(["ie.employer-match.pension"]);
  });
});
