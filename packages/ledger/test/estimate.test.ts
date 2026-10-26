import { describe, expect, it } from "vitest";
import { toMinor } from "@cuntas/rules";
import {
  addManualTransaction,
  budgetFromEstimate,
  buildSnapshot,
  createEmptyDataset,
  datasetSchema,
  essentialSpend,
  estimateForm,
  setSpendingEstimate,
  type Account,
  type Dataset,
} from "../src";

const asOf = "2026-10-22";

function household(): Dataset {
  const ds = createEmptyDataset("Test", "USD", `${asOf}T00:00:00Z`, { name: "Alex", home: "US" });
  const checking: Account = { id: "checking", name: "Checking", memberIds: [], type: "current", currency: "USD", institutionId: null, wrapper: "none", jurisdiction: "US", openingBalanceMinor: toMinor(500), openingDate: "2026-01-01", valuations: [], isEmergencyFund: false, archived: false };
  ds.accounts = [checking];
  return ds;
}

const estimate = (ds: Dataset) =>
  setSpendingEstimate(ds, [
    { categoryId: "cat_rent", amountMinor: toMinor(1800) },
    { categoryId: "cat_groceries", amountMinor: toMinor(600) },
    { categoryId: "cat_energy", amountMinor: toMinor(250) },
    { categoryId: "cat_commute", amountMinor: toMinor(200) },
    { categoryId: "cat_childcare", amountMinor: 0 },
    { categoryId: "cat_debt_payments", amountMinor: toMinor(150) },
    { categoryId: "cat_other", amountMinor: toMinor(700) },
  ], asOf);

describe("monthly spending estimate", () => {
  it("is stored on the household, without zero lines, and survives the schema", () => {
    const ds = estimate(household());
    expect(ds.household.spendingEstimate).toEqual({ setOn: asOf, lines: expect.arrayContaining([{ categoryId: "cat_rent", amountMinor: toMinor(1800) }]) });
    expect(ds.household.spendingEstimate!.lines).toHaveLength(6);
    expect(datasetSchema.parse(ds).household.spendingEstimate).toEqual(ds.household.spendingEstimate);
    // Older datasets have none.
    const old = household() as { household: Record<string, unknown> };
    delete old.household.spendingEstimate;
    expect(datasetSchema.parse(old).household.spendingEstimate).toBeNull();
  });

  it("stands in for essential spending until there are two months of transactions", () => {
    const ds = estimate(household());
    // Everything but "everything else" is essential.
    expect(essentialSpend(ds, asOf)).toEqual({ monthlyMinor: toMinor(3000), source: "estimate" });
    // A few weeks of spending doesn't replace it.
    const recent = addManualTransaction(ds, { kind: "spent", amountMinor: toMinor(80), date: "2026-10-01", accountId: "checking", categoryId: "cat_groceries" }).dataset;
    expect(essentialSpend(recent, asOf).source).toBe("estimate");
    // Two months of history does.
    const older = addManualTransaction(recent, { kind: "spent", amountMinor: toMinor(90), date: "2026-08-20", accountId: "checking", categoryId: "cat_groceries" }).dataset;
    expect(essentialSpend(older, asOf).source).toBe("transactions");
  });

  it("without an estimate, transactions are used however few, and nothing is none", () => {
    expect(essentialSpend(household(), asOf)).toEqual({ monthlyMinor: 0, source: "none" });
    const ds = addManualTransaction(household(), { kind: "spent", amountMinor: toMinor(80), date: "2026-10-01", accountId: "checking", categoryId: "cat_groceries" }).dataset;
    expect(essentialSpend(ds, asOf).source).toBe("transactions");
  });

  it("gives a household with no transactions and no pay a real emergency-fund target", () => {
    const s = buildSnapshot(estimate(household()), asOf);
    expect(s.netMonthlyPayMinor).toBe(0);
    expect(s.essentialMonthlySpendMinor).toBe(toMinor(3000));
    // The waterfall's needs come from the estimate when there's no budget or past spending.
    expect(s.waterfall.firstShortBucket).not.toBeNull();
  });

  it("prefills the form from rent and debts, then from the saved estimate", () => {
    const ds = household();
    ds.household.settings.monthlyRentMinor = toMinor(1650);
    ds.debts = [
      { id: "cc", name: "Card", accountId: null, kind: "creditCard", balanceMinor: toMinor(3000), currency: "USD", aprBps: 2400, minPaymentMinor: toMinor(90), termEnd: null },
      { id: "car", name: "Car", accountId: null, kind: "loan", balanceMinor: toMinor(8000), currency: "USD", aprBps: 700, minPaymentMinor: toMinor(250), termEnd: null },
      { id: "paid", name: "Old", accountId: null, kind: "loan", balanceMinor: 0, currency: "USD", aprBps: 700, minPaymentMinor: toMinor(50), termEnd: null },
    ];
    const form = estimateForm(ds, asOf);
    expect(form.map((l) => l.label)).toEqual(["Rent or mortgage", "Groceries", "Utilities and phone", "Transport", "Childcare", "Debt repayments", "Everything else"]);
    expect(form.find((l) => l.categoryId === "cat_rent")?.amountMinor).toBe(toMinor(1650));
    expect(form.find((l) => l.categoryId === "cat_debt_payments")?.amountMinor).toBe(toMinor(340));
    expect(form.find((l) => l.categoryId === "cat_groceries")?.amountMinor).toBe(0);
    // A homeowner's mortgage payment fills the first line.
    const owner = { ...ds, household: { ...ds.household, settings: { ...ds.household.settings, ownsHome: true } }, debts: [{ ...ds.debts[0]!, id: "m", kind: "mortgage" as const, minPaymentMinor: toMinor(1400) }] };
    expect(estimateForm(owner, asOf)[0]!.amountMinor).toBe(toMinor(1400));
    // Once saved, the saved figures win.
    expect(estimateForm(estimate(ds), asOf).find((l) => l.categoryId === "cat_rent")?.amountMinor).toBe(toMinor(1800));
  });

  it("turns into a first budget, rounded up to whole units", () => {
    const ds = setSpendingEstimate(household(), [{ categoryId: "cat_groceries", amountMinor: 61234 }, { categoryId: "cat_rent", amountMinor: toMinor(1800) }], asOf);
    const b = budgetFromEstimate(ds, "2026-10");
    expect(b).toMatchObject({ period: "2026-10", mode: "envelope", lines: [{ categoryId: "cat_groceries", amountMinor: 61300, rollover: true }, { categoryId: "cat_rent", amountMinor: toMinor(1800), rollover: true }] });
    expect(budgetFromEstimate(household(), "2026-10")).toBeNull();
  });
});
