import { describe, expect, it } from "vitest";
import {
  addManualTransaction,
  balancesByAccount,
  createEmptyDataset,
  datasetSchema,
  importStatement,
  isTransfer,
  netWorthSeries,
  removeManualTransaction,
  suggestCategory,
  topCategories,
  totalsByCategory,
  type Account,
  type Dataset,
} from "../src";

const asOf = "2026-10-22";

function account(id: string, over: Partial<Account> = {}): Account {
  return { id, name: id, memberIds: [], type: "current", currency: "EUR", institutionId: null, wrapper: "none", jurisdiction: "IE", openingBalanceMinor: 100000, openingDate: "2026-01-01", valuations: [], isEmergencyFund: false, archived: false, ...over };
}

function household(): Dataset {
  const ds = createEmptyDataset("Test", "EUR", `${asOf}T00:00:00Z`);
  ds.accounts = [account("current"), account("savings", { type: "savings" })];
  return ds;
}

const statement = (rows: { bookedAt: string; amountMinor: number; payee: string; externalId: string }[]) => ({
  format: "csv" as const,
  transactions: rows.map((r) => ({ ...r, currency: "EUR" as const, rawDescription: `${r.payee} CARD 1234` })),
  warnings: [],
});

describe("quick add", () => {
  it("records a cash spend in a Cash account created on first use, whose balance isn't tracked", () => {
    const r = addManualTransaction(household(), { kind: "spent", amountMinor: 1250, date: asOf, accountId: null, payee: "Coffee", categoryId: "cat_eating_out" });
    const cash = r.dataset.accounts.find((a) => a.id === r.accountId)!;
    expect(cash).toMatchObject({ name: "Cash", type: "cash", currency: "EUR", tracksBalance: false });
    expect(r.dataset.transactions).toHaveLength(1);
    expect(r.dataset.transactions[0]).toMatchObject({ accountId: cash.id, amountMinor: -1250, payee: "Coffee", categoryId: "cat_eating_out", categorySource: "user", source: "manual", bookedAt: asOf });
    expect(datasetSchema.parse(r.dataset)).toBeTruthy();
    // The spend counts; the wallet's balance does not pull net worth down.
    expect(totalsByCategory(r.dataset, "2026-10-01", "2026-10-31").get("cat_eating_out")?.spentMinor).toBe(1250);
    expect(balancesByAccount(r.dataset, asOf).get(cash.id)).toBe(0);
    expect(netWorthSeries(r.dataset, asOf, 1).at(-1)!.netMinor).toBe(200000);
    // A second cash spend reuses the same Cash account.
    const again = addManualTransaction(r.dataset, { kind: "spent", amountMinor: 500, date: asOf, accountId: null });
    expect(again.dataset.accounts.filter((a) => a.type === "cash")).toHaveLength(1);
  });

  it("records money received as a positive amount on the chosen account", () => {
    const r = addManualTransaction(household(), { kind: "received", amountMinor: 5000, date: asOf, accountId: "current", payee: "Sold a bike", categoryId: "cat_other_income" });
    expect(r.dataset.transactions[0]).toMatchObject({ accountId: "current", amountMinor: 5000 });
    expect(balancesByAccount(r.dataset, asOf).get("current")).toBe(105000);
  });

  it("records a move between two accounts as a paired transfer, not spending", () => {
    const r = addManualTransaction(household(), { kind: "moved", amountMinor: 20000, date: asOf, accountId: "current", toAccountId: "savings" });
    expect(r.transactionIds).toHaveLength(2);
    const [out, inn] = r.transactionIds.map((id) => r.dataset.transactions.find((t) => t.id === id)!);
    expect(out).toMatchObject({ accountId: "current", amountMinor: -20000, transferPairId: inn!.id });
    expect(inn).toMatchObject({ accountId: "savings", amountMinor: 20000, transferPairId: out!.id });
    expect(isTransfer(out!)).toBe(true);
    expect([...totalsByCategory(r.dataset, "2026-10-01", "2026-10-31").values()].reduce((a, t) => a + t.spentMinor, 0)).toBe(0);
  });

  it("refuses a move to the same account, and a zero amount", () => {
    expect(() => addManualTransaction(household(), { kind: "moved", amountMinor: 100, date: asOf, accountId: "current", toAccountId: "current" })).toThrow();
    expect(() => addManualTransaction(household(), { kind: "spent", amountMinor: 0, date: asOf, accountId: "current" })).toThrow();
  });

  it("a monthly spend also becomes a bill due a month later", () => {
    const r = addManualTransaction(household(), { kind: "spent", amountMinor: 1599, date: asOf, accountId: "current", payee: "Gym", categoryId: "cat_entertainment", monthly: true });
    expect(r.billId).not.toBeNull();
    expect(r.dataset.bills).toEqual([expect.objectContaining({ name: "Gym", cadence: "monthly", amountMinor: 1599, currency: "EUR", nextDue: "2026-11-22", categoryId: "cat_entertainment", payeeKey: "gym" })]);
  });

  it("without a category, rules and the dictionary still categorise it", () => {
    const r = addManualTransaction(household(), { kind: "spent", amountMinor: 4210, date: asOf, accountId: "current", payee: "Tesco" });
    expect(r.dataset.transactions[0]).toMatchObject({ categoryId: "cat_groceries", categorySource: "dictionary" });
  });
});

describe("deleting a hand-entered row", () => {
  it("removes it, and both sides of a hand-entered move", () => {
    const spend = addManualTransaction(household(), { kind: "spent", amountMinor: 700, date: asOf, accountId: "current" });
    expect(removeManualTransaction(spend.dataset, spend.transactionIds[0]!).transactions).toHaveLength(0);
    const move = addManualTransaction(household(), { kind: "moved", amountMinor: 700, date: asOf, accountId: "current", toAccountId: "savings" });
    expect(removeManualTransaction(move.dataset, move.transactionIds[1]!).transactions).toHaveLength(0);
  });

  it("won't delete an imported row", () => {
    const r = importStatement(household(), "current", statement([{ bookedAt: asOf, amountMinor: -100, payee: "A", externalId: "i1" }]));
    expect(() => removeManualTransaction(r.dataset, r.dataset.transactions[0]!.id)).toThrow();
  });
});

describe("merging hand-entered rows on import", () => {
  it("folds a matching manual row into the imported one instead of adding a duplicate", () => {
    const manual = addManualTransaction(household(), { kind: "spent", amountMinor: 3000, date: "2026-10-10", accountId: "current", payee: "Dinner with Sam", categoryId: "cat_eating_out", notes: "birthday" });
    const r = importStatement(manual.dataset, "current", statement([
      { bookedAt: "2026-10-12", amountMinor: -3000, payee: "THE WINDING STAIR", externalId: "x1" },
      { bookedAt: "2026-10-12", amountMinor: -999, payee: "SPOTIFY", externalId: "x2" },
    ]));
    expect(r).toMatchObject({ added: 1, merged: 1, skipped: 0 });
    expect(r.dataset.transactions).toHaveLength(2);
    const merged = r.dataset.transactions.find((t) => t.id === manual.transactionIds[0])!;
    // The bank's date and reference win; the user's payee, category and note are kept.
    expect(merged).toMatchObject({ bookedAt: "2026-10-12", externalId: "x1", rawDescription: "THE WINDING STAIR CARD 1234", payee: "Dinner with Sam", categoryId: "cat_eating_out", notes: "birthday", source: "import" });
    // Importing the same file again changes nothing.
    expect(importStatement(r.dataset, "current", statement([{ bookedAt: "2026-10-12", amountMinor: -3000, payee: "THE WINDING STAIR", externalId: "x1" }]))).toMatchObject({ added: 0, merged: 0, skipped: 1 });
  });

  it("leaves manual rows alone when the amount, account or date is off", () => {
    let ds = addManualTransaction(household(), { kind: "spent", amountMinor: 3000, date: "2026-10-01", accountId: "current" }).dataset;
    ds = addManualTransaction(ds, { kind: "spent", amountMinor: 3000, date: "2026-10-10", accountId: "savings" }).dataset;
    const r = importStatement(ds, "current", statement([
      { bookedAt: "2026-10-10", amountMinor: -3000, payee: "A", externalId: "y1" },
      { bookedAt: "2026-10-01", amountMinor: -3001, payee: "B", externalId: "y2" },
    ]));
    expect(r).toMatchObject({ added: 2, merged: 0 });
  });

  it("matches each manual row once, to the nearest date", () => {
    let ds = addManualTransaction(household(), { kind: "spent", amountMinor: 500, date: "2026-10-05", accountId: "current", payee: "first" }).dataset;
    ds = addManualTransaction(ds, { kind: "spent", amountMinor: 500, date: "2026-10-07", accountId: "current", payee: "second" }).dataset;
    const r = importStatement(ds, "current", statement([
      { bookedAt: "2026-10-07", amountMinor: -500, payee: "X", externalId: "z1" },
      { bookedAt: "2026-10-05", amountMinor: -500, payee: "Y", externalId: "z2" },
    ]));
    expect(r).toMatchObject({ added: 0, merged: 2 });
    expect(r.dataset.transactions.find((t) => t.payee === "second")?.externalId).toBe("z1");
    expect(r.dataset.transactions.find((t) => t.payee === "first")?.externalId).toBe("z2");
  });
});

describe("category suggestions for quick add", () => {
  it("offers the most used spending categories, topped up with common ones", () => {
    let ds = household();
    for (const [i, cat] of ["cat_travel", "cat_travel", "cat_gifts"].entries()) ds = addManualTransaction(ds, { kind: "spent", amountMinor: 100 + i, date: asOf, accountId: "current", categoryId: cat }).dataset;
    const top = topCategories(ds, "expense", 6, asOf);
    expect(top).toHaveLength(6);
    expect(top.slice(0, 2)).toEqual(["cat_travel", "cat_gifts"]);
    expect(top).toContain("cat_groceries");
    expect(topCategories(createEmptyDataset("x"), "income", 2, asOf)).toEqual(["cat_salary", "cat_other_income"]);
  });

  it("suggests a category from a past entry with the same payee, then from rules", () => {
    const ds = addManualTransaction(household(), { kind: "spent", amountMinor: 900, date: asOf, accountId: "current", payee: "Corner shop #12", categoryId: "cat_groceries" }).dataset;
    expect(suggestCategory(ds, "corner shop")).toBe("cat_groceries");
    expect(suggestCategory(ds, "Tesco Express")).toBe("cat_groceries");
    expect(suggestCategory(ds, "zzz")).toBeNull();
    // Short brand names match whole words only: "tfl" is not inside "Netflix".
    expect(suggestCategory(ds, "Netflix")).toBe("cat_tv_subs");
    expect(suggestCategory(ds, "TFL TRAVEL CH")).toBe("cat_commute");
    expect(suggestCategory(ds, "Shell Ballsbridge")).toBe("cat_commute");
  });
});
