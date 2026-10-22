import { addDays, addMonths, daysBetween, type Currency, type IsoDate } from "@cuntas/rules";

/** Average days per month (365.25 / 12). */
const DAYS_PER_MONTH = 30.4375;
import { FxTable } from "./fx";
import type { Category, Dataset, Transaction } from "./schema";

export function categoryMap(ds: Dataset): Map<string, Category> {
  return new Map(ds.categories.map((c) => [c.id, c]));
}

/** Amount in base currency, using the stored booking-date rate when present. */
export function baseAmount(t: Transaction, base: Currency, fx: FxTable): number {
  if (t.currency === base) return t.amountMinor;
  if (t.fxRateToBase !== null) return Math.round(t.amountMinor * t.fxRateToBase);
  return fx.tryConvert(t.amountMinor, t.currency, base, t.bookedAt) ?? 0;
}

/** Category lines of a transaction, honouring splits. */
export function lines(t: Transaction): { categoryId: string | null; amountMinor: number }[] {
  if (t.splits.length > 0) return t.splits;
  return [{ categoryId: t.categoryId, amountMinor: t.amountMinor }];
}

/** Whether a transaction counts as spending or income (not an internal transfer). */
export function isCashflow(t: Transaction, cats: Map<string, Category>): boolean {
  if (t.transferPairId !== null) return false;
  const cat = t.categoryId ? cats.get(t.categoryId) : undefined;
  return cat?.kind !== "transfer";
}

export interface CategoryTotal {
  categoryId: string | null;
  spentMinor: number;
  incomeMinor: number;
}

/** Spending (positive) and income per category in base currency, for start <= date <= end. */
export function totalsByCategory(ds: Dataset, start: IsoDate, end: IsoDate, fx = new FxTable(ds.fxRates)): Map<string | null, CategoryTotal> {
  const cats = categoryMap(ds);
  const base = ds.household.baseCurrency;
  const out = new Map<string | null, CategoryTotal>();
  for (const t of ds.transactions) {
    if (t.bookedAt < start || t.bookedAt > end || !isCashflow(t, cats)) continue;
    const ratio = t.amountMinor === 0 ? 0 : baseAmount(t, base, fx) / t.amountMinor;
    for (const l of lines(t)) {
      const amount = Math.round(l.amountMinor * ratio);
      const cur = out.get(l.categoryId) ?? { categoryId: l.categoryId, spentMinor: 0, incomeMinor: 0 };
      const kind = l.categoryId ? cats.get(l.categoryId)?.kind : undefined;
      if (kind === "income" || (kind === undefined && amount > 0)) cur.incomeMinor += amount;
      else cur.spentMinor -= amount;
      out.set(l.categoryId, cur);
    }
  }
  return out;
}

/** Average monthly essential spending over the last `months` months (fewer if history is shorter). */
export function essentialMonthlySpend(ds: Dataset, asOf: IsoDate, months = 12, fx = new FxTable(ds.fxRates)): number {
  const cats = categoryMap(ds);
  const first = ds.transactions.reduce<string | null>((min, t) => (min === null || t.bookedAt < min ? t.bookedAt : min), null);
  if (!first) return 0;
  const windowStart = addDays(addMonths(asOf, -months), 1);
  const start = first > windowStart ? first : windowStart;
  const totals = totalsByCategory(ds, start, asOf, fx);
  let essential = 0;
  for (const [id, t] of totals) if (id && cats.get(id)?.isEssential) essential += t.spentMinor;
  const spanDays = Math.max(DAYS_PER_MONTH, daysBetween(start, asOf) + 1);
  return Math.round((essential * DAYS_PER_MONTH) / spanDays);
}
