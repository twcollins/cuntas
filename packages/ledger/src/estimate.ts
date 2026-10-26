import { addMonths, type IsoDate } from "@cuntas/rules";
import { withAudit } from "./dataset";
import { FxTable } from "./fx";
import { newId } from "./ids";
import type { Budget, Dataset } from "./schema";
import { categoryMap, essentialMonthlySpend } from "./spending";

// A rough monthly spending figure for households that haven't imported, or not yet enough.
// It stands in for transactions until they cover two months.

/** The estimate form's lines, each mapped to a default category. */
export const ESTIMATE_LINES = [
  { categoryId: "cat_rent", label: "Rent or mortgage" },
  { categoryId: "cat_groceries", label: "Groceries" },
  { categoryId: "cat_energy", label: "Utilities and phone" },
  { categoryId: "cat_commute", label: "Transport" },
  { categoryId: "cat_childcare", label: "Childcare" },
  { categoryId: "cat_debt_payments", label: "Debt repayments" },
  { categoryId: "cat_other", label: "Everything else" },
] as const;

/** Months of transactions needed before they replace the estimate. */
export const ESTIMATE_MONTHS = 2;

export interface EstimateLine {
  categoryId: string;
  amountMinor: number;
}

export function setSpendingEstimate(ds: Dataset, lines: readonly EstimateLine[], setOn: IsoDate): Dataset {
  const kept = lines.filter((l) => l.amountMinor > 0).map((l) => ({ categoryId: l.categoryId, amountMinor: l.amountMinor }));
  const next = { ...ds, household: { ...ds.household, spendingEstimate: kept.length > 0 ? { setOn, lines: kept } : null } };
  return withAudit(next, "user", "estimate:set", `household:${ds.household.id}`);
}

/** The form's lines: the saved estimate, or rent, mortgage and debt payments already known. */
export function estimateForm(ds: Dataset, asOf: IsoDate, fx = new FxTable(ds.fxRates)): (EstimateLine & { label: string })[] {
  const saved = ds.household.spendingEstimate;
  const base = ds.household.baseCurrency;
  const inBase = (minor: number, currency: typeof base) => fx.tryConvert(minor, currency, base, asOf) ?? minor;
  const s = ds.household.settings;
  const mortgage = ds.debts.filter((d) => d.kind === "mortgage" && d.balanceMinor > 0).reduce((a, d) => a + inBase(d.minPaymentMinor, d.currency), 0);
  const debts = ds.debts.filter((d) => d.kind !== "mortgage" && d.balanceMinor > 0).reduce((a, d) => a + inBase(d.minPaymentMinor, d.currency), 0);
  const known: Record<string, number> = { cat_rent: s.ownsHome ? mortgage : s.monthlyRentMinor, cat_debt_payments: debts };
  return ESTIMATE_LINES.map((l) => ({
    ...l,
    amountMinor: saved ? (saved.lines.find((x) => x.categoryId === l.categoryId)?.amountMinor ?? 0) : (known[l.categoryId] ?? 0),
  }));
}

/** Whether transactions cover enough months to replace the estimate. */
export function hasSpendingHistory(ds: Dataset, asOf: IsoDate): boolean {
  const cutoff = addMonths(asOf, -ESTIMATE_MONTHS);
  return ds.transactions.some((t) => t.bookedAt <= cutoff);
}

export interface EssentialSpend {
  monthlyMinor: number;
  source: "transactions" | "estimate" | "none";
}

/** Essential monthly spending: from transactions once they cover two months, else the estimate, else what transactions there are. */
export function essentialSpend(ds: Dataset, asOf: IsoDate, months = 12, fx = new FxTable(ds.fxRates)): EssentialSpend {
  const estimate = ds.household.spendingEstimate;
  if (estimate && !hasSpendingHistory(ds, asOf)) {
    const cats = categoryMap(ds);
    return { monthlyMinor: estimate.lines.reduce((a, l) => a + (cats.get(l.categoryId)?.isEssential ? l.amountMinor : 0), 0), source: "estimate" };
  }
  if (ds.transactions.length === 0) return { monthlyMinor: 0, source: "none" };
  return { monthlyMinor: essentialMonthlySpend(ds, asOf, months, fx), source: "transactions" };
}

/** A first envelope budget from the estimate, each line rounded up to a whole unit. */
export function budgetFromEstimate(ds: Dataset, period: string): Budget | null {
  const estimate = ds.household.spendingEstimate;
  if (!estimate) return null;
  const known = new Set(ds.categories.map((c) => c.id));
  const lines = estimate.lines
    .filter((l) => known.has(l.categoryId))
    .map((l) => ({ categoryId: l.categoryId, amountMinor: Math.ceil(l.amountMinor / 100) * 100, rollover: true }));
  return { id: newId("budget"), period, mode: "envelope", lines };
}
