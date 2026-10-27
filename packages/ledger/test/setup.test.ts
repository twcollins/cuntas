import { describe, expect, it } from "vitest";
import { createDemoDataset, createEmptyDataset, datasetSchema, hideSetup, confirmYou, setSpendingEstimate, setupChecklist, starterBudget, type Account, type SetupItem, type Dataset, type Transaction } from "../src";

const asOf = "2026-10-25";

function account(id: string, over: Partial<Account> = {}): Account {
  return { id, name: id, memberIds: [], type: "current", currency: "USD", institutionId: null, wrapper: "none", jurisdiction: "US", openingBalanceMinor: 0, openingDate: "2026-01-01", valuations: [], isEmergencyFund: false, archived: false, ...over };
}

function tx(id: string, bookedAt: string, amountMinor: number, categoryId: string | null): Transaction {
  return { id, accountId: "checking", bookedAt, amountMinor, currency: "USD", fxRateToBase: null, payee: id, rawDescription: id, externalId: id, categoryId, categorySource: categoryId ? "user" : "none", transferPairId: null, splits: [], notes: "" };
}

const you = (ds: Dataset) => setupChecklist(ds).items.find((i): i is Extract<SetupItem, { key: "you" }> => i.key === "you")!;
const fresh = (): Dataset => createEmptyDataset("Test", "USD", `${asOf}T00:00:00Z`, { name: "Alex", home: "US" });

describe("the setup checklist", () => {
  it("a new household starts with nothing done, and the You line says what's missing", () => {
    const c = setupChecklist(fresh());
    expect(c.show).toBe(true);
    expect(c.done).toBe(0);
    expect(c.items.map((i) => [i.key, i.done])).toEqual([["you", false], ["accounts", false], ["spending", false], ["budget", false]]);
    expect(c.items[0]).toMatchObject({ missing: ["birthDate", "pay", "state"], memberId: c.items[0]!.key === "you" ? expect.any(String) : null });
  });

  it("You is done once the birth date, pay and (for a US resident) state are given", () => {
    let ds = fresh();
    const m = ds.members[0]!;
    ds = confirmYou(ds, m.id, { dateOfBirth: "1988-04-02", employmentType: "employee", grossAnnualMinor: 8_500_000, usState: "TX" }, `${asOf}T00:00:00Z`);
    expect(setupChecklist(ds).items[0]).toMatchObject({ key: "you", done: true, missing: [] });
    expect(ds.members[0]).toMatchObject({ dateOfBirth: "1988-04-02", grossAnnualMinor: 8_500_000, usState: "TX" });
    // Someone not working has no pay to give; a real 1 January 1990 birthday counts once confirmed.
    const notWorking = fresh();
    notWorking.members[0]!.employmentType = "notWorking";
    notWorking.members[0]!.usState = "CA";
    expect(you(notWorking).missing).toEqual(["birthDate"]);
    notWorking.household.setup = { youConfirmedAt: `${asOf}T00:00:00Z` };
    expect(setupChecklist(notWorking).items[0]!.done).toBe(true);
  });

  it("accounts, spending and budget are done once ever, so the checklist doesn't come back next month", () => {
    const ds = fresh();
    ds.accounts = [account("checking"), account("cash", { type: "cash", tracksBalance: false })];
    expect(setupChecklist(ds).items[1]).toMatchObject({ done: true, names: ["checking"] });
    ds.accounts = [account("cash", { type: "cash", tracksBalance: false })];
    expect(setupChecklist(ds).items[1]!.done).toBe(false);
    ds.transactions = [tx("a", "2025-01-03", -500, null)];
    expect(setupChecklist(ds).items[2]).toMatchObject({ done: true, source: "transactions", count: 1 });
    ds.budgets = [{ id: "b", period: "2025-01", mode: "envelope", lines: [] }];
    expect(setupChecklist(ds).items[3]!.done).toBe(true);
  });

  it("a spending estimate counts as spending", () => {
    const ds = setSpendingEstimate(fresh(), [{ categoryId: "cat_groceries", amountMinor: 50_000 }], asOf);
    expect(setupChecklist(ds).items[2]).toMatchObject({ done: true, source: "estimate", monthlyMinor: 50_000 });
  });

  it("hides when everything is done, or when the user hides it", () => {
    expect(setupChecklist(createDemoDataset(asOf)).show).toBe(false);
    const hidden = hideSetup(fresh(), `${asOf}T00:00:00Z`);
    expect(setupChecklist(hidden).show).toBe(false);
    expect(datasetSchema.parse(hidden).household.setup).toEqual({ hiddenAt: `${asOf}T00:00:00Z` });
  });

  it("households saved before the checklist load without setup state", () => {
    const raw = JSON.parse(JSON.stringify(fresh())) as { household: Record<string, unknown> };
    delete raw.household.setup;
    expect(datasetSchema.parse(raw).household.setup).toEqual({});
  });
});

describe("a first budget made for you", () => {
  const withSpending = () => {
    const ds = fresh();
    ds.accounts = [account("checking")];
    ds.transactions = [tx("g1", "2026-09-03", -6418, "cat_groceries"), tx("g2", "2026-09-20", -12_000, "cat_groceries"), tx("e", "2026-09-10", -4_550, "cat_eating_out"), tx("pay", "2026-09-01", 400_000, "cat_salary"), tx("x", "2026-09-12", -900, null)];
    return ds;
  };

  it("comes from last period's spending, each line rounded up to ten", () => {
    const b = starterBudget(withSpending(), asOf)!;
    expect(b).toMatchObject({ period: "2026-10", mode: "envelope", source: "spending" });
    expect(b.lines).toEqual([
      { categoryId: "cat_groceries", amountMinor: 19_000, rollover: true },
      { categoryId: "cat_eating_out", amountMinor: 5_000, rollover: true },
    ]);
  });

  it("uses the latest month with spending when last period had none", () => {
    const ds = withSpending();
    ds.transactions = ds.transactions.map((t) => ({ ...t, bookedAt: t.bookedAt.replace("2026-09", "2026-07") }));
    expect(starterBudget(ds, asOf)!.lines[0]).toEqual({ categoryId: "cat_groceries", amountMinor: 19_000, rollover: true });
  });

  it("falls back to the estimate, and to nothing", () => {
    expect(starterBudget(fresh(), asOf)).toBeNull();
    const b = starterBudget(setSpendingEstimate(fresh(), [{ categoryId: "cat_groceries", amountMinor: 50_050 }], asOf), asOf)!;
    expect(b).toMatchObject({ source: "estimate", lines: [{ categoryId: "cat_groceries", amountMinor: 50_100, rollover: true }] });
  });
});
