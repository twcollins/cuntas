import { addDays, addMonths, type IsoDate } from "@cuntas/rules";
import { FxTable } from "./fx";
import type { Budget, Dataset } from "./schema";
import { categoryMap, isCashflow, totalsByCategory } from "./spending";

/** Budget period for a key (YYYY-MM): from the payday in that month to the day before the next payday. */
export function periodRange(period: string, paydayDayOfMonth = 1): { start: IsoDate; end: IsoDate } {
  const start = `${period}-${String(paydayDayOfMonth).padStart(2, "0")}`;
  return { start, end: addDays(addMonths(start, 1), -1) };
}

export function periodOf(date: IsoDate, paydayDayOfMonth = 1): string {
  const day = Number(date.slice(8, 10));
  return day >= paydayDayOfMonth ? date.slice(0, 7) : addMonths(`${date.slice(0, 7)}-01`, -1).slice(0, 7);
}

/**
 * The dates to show spending for: the current pay period, or, when it has no spending yet, the
 * latest period that does (an import of last month's statement), with `latest` set so it can be labelled.
 */
export function spendingWindow(ds: Dataset, asOf: IsoDate, paydayDayOfMonth = 1): { start: IsoDate; end: IsoDate; latest: boolean } {
  const current = periodRange(periodOf(asOf, paydayDayOfMonth), paydayDayOfMonth);
  const cats = categoryMap(ds);
  const spends = ds.transactions.filter((t) => t.amountMinor < 0 && t.bookedAt <= asOf && isCashflow(t, cats));
  if (spends.length === 0 || spends.some((t) => t.bookedAt >= current.start)) return { ...current, latest: false };
  const last = spends.reduce((max, t) => (t.bookedAt > max ? t.bookedAt : max), spends[0]!.bookedAt);
  return { ...periodRange(periodOf(last, paydayDayOfMonth), paydayDayOfMonth), latest: true };
}

export function previousPeriod(period: string): string {
  return addMonths(`${period}-01`, -1).slice(0, 7);
}

export interface BudgetLineReport {
  categoryId: string;
  budgetedMinor: number;
  rolloverInMinor: number;
  spentMinor: number;
  availableMinor: number;
  overspent: boolean;
}

export interface BudgetReport {
  period: string;
  start: IsoDate;
  end: IsoDate;
  mode: Budget["mode"];
  lines: BudgetLineReport[];
  incomeMinor: number;
  budgetedMinor: number;
  spentMinor: number;
  /** Envelope mode: income not yet given a job (can be negative if over-assigned). */
  toBeAssignedMinor: number;
  unbudgetedSpendMinor: number;
}

/** Reports a budget period. Rollover carries each line's leftover (or overspend) into the next period. */
export function budgetReport(ds: Dataset, period: string, fx = new FxTable(ds.fxRates), depth = 0): BudgetReport | null {
  const budget = ds.budgets.find((b) => b.period === period);
  if (!budget) return null;
  const payday = ds.household.settings.paydayDayOfMonth;
  const { start, end } = periodRange(period, payday);
  const totals = totalsByCategory(ds, start, end, fx);
  const prev = depth < 24 ? budgetReport(ds, previousPeriod(period), fx, depth + 1) : null;

  const lines = budget.lines.map((l) => {
    const prevLine = prev?.lines.find((p) => p.categoryId === l.categoryId);
    const rolloverInMinor = l.rollover && prevLine ? (budget.mode === "envelope" ? prevLine.availableMinor : Math.max(0, prevLine.availableMinor)) : 0;
    const spentMinor = totals.get(l.categoryId)?.spentMinor ?? 0;
    const availableMinor = l.amountMinor + rolloverInMinor - spentMinor;
    return { categoryId: l.categoryId, budgetedMinor: l.amountMinor, rolloverInMinor, spentMinor, availableMinor, overspent: availableMinor < 0 };
  });

  const budgeted = new Set(budget.lines.map((l) => l.categoryId));
  let incomeMinor = 0;
  let unbudgetedSpendMinor = 0;
  for (const [id, t] of totals) {
    incomeMinor += t.incomeMinor;
    if (!id || !budgeted.has(id)) unbudgetedSpendMinor += t.spentMinor;
  }
  const budgetedMinor = lines.reduce((a, l) => a + l.budgetedMinor, 0);
  const carry = prev && budget.mode === "envelope" ? prev.toBeAssignedMinor : 0;
  return {
    period,
    start,
    end,
    mode: budget.mode,
    lines,
    incomeMinor,
    budgetedMinor,
    spentMinor: lines.reduce((a, l) => a + l.spentMinor, 0) + unbudgetedSpendMinor,
    toBeAssignedMinor: incomeMinor + carry - budgetedMinor,
    unbudgetedSpendMinor,
  };
}
