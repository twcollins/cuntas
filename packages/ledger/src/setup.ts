import type { IsoDate, UsState } from "@cuntas/rules";
import { periodOf, periodRange, previousPeriod, spendingWindow } from "./budgets";
import { UNKNOWN_BIRTH_DATE, withAudit } from "./dataset";
import { budgetFromEstimate } from "./estimate";
import { newId } from "./ids";
import type { Budget, Dataset, Member } from "./schema";
import { categoryMap, totalsByCategory } from "./spending";

// The setup checklist a new household sees on Overview in place of step 0: you, accounts, spending, budget.
// Each line counts as done once ever, so a new month without a budget doesn't bring the checklist back.

export type YouMissing = "person" | "birthDate" | "pay" | "state";

export type SetupItem =
  | { key: "you"; done: boolean; memberId: string | null; missing: YouMissing[] }
  | { key: "accounts"; done: boolean; names: string[] }
  | { key: "spending"; done: boolean; source: "transactions" | "estimate" | "none"; count: number; monthlyMinor: number }
  | { key: "budget"; done: boolean };

export interface SetupChecklist {
  items: SetupItem[];
  done: number;
  /** Shown until every line is done or the user hides it. */
  show: boolean;
}

const livesInUs = (ds: Dataset, memberId: string) => ds.residencePeriods.some((r) => r.memberId === memberId && r.to === null && r.jurisdiction === "US");
const earns = (m: Member) => m.employmentType === "employee" || m.employmentType === "selfEmployed";

export function setupChecklist(ds: Dataset): SetupChecklist {
  const me = ds.members[0];
  const missing: YouMissing[] = [];
  if (!me) missing.push("person");
  else {
    if (me.dateOfBirth === UNKNOWN_BIRTH_DATE && !ds.household.setup.youConfirmedAt) missing.push("birthDate");
    if (earns(me) && me.grossAnnualMinor <= 0) missing.push("pay");
    if (livesInUs(ds, me.id) && !me.usState) missing.push("state");
  }
  const accounts = ds.accounts.filter((a) => !a.archived && a.tracksBalance !== false);
  const estimate = ds.household.spendingEstimate;
  const spending: SetupItem =
    ds.transactions.length > 0
      ? { key: "spending", done: true, source: "transactions", count: ds.transactions.length, monthlyMinor: 0 }
      : estimate
        ? { key: "spending", done: true, source: "estimate", count: 0, monthlyMinor: estimate.lines.reduce((a, l) => a + l.amountMinor, 0) }
        : { key: "spending", done: false, source: "none", count: 0, monthlyMinor: 0 };
  const items: SetupItem[] = [
    { key: "you", done: missing.length === 0, memberId: me?.id ?? null, missing },
    { key: "accounts", done: accounts.length > 0, names: accounts.map((a) => a.name) },
    spending,
    { key: "budget", done: ds.budgets.length > 0 },
  ];
  const done = items.filter((i) => i.done).length;
  return { items, done, show: done < items.length && !ds.household.setup.hiddenAt };
}

export interface YouDetails {
  dateOfBirth?: IsoDate;
  employmentType?: Member["employmentType"];
  grossAnnualMinor?: number;
  usState?: UsState | null;
}

/** Saves the first person's details from the checklist and marks them confirmed, so a real 1 January 1990 birthday counts. */
export function confirmYou(ds: Dataset, memberId: string, details: YouDetails, at = new Date().toISOString()): Dataset {
  const members = ds.members.map((m) => (m.id === memberId ? { ...m, ...details } : m));
  // The first person's residence started on the placeholder birth date; move it to the real one.
  const residencePeriods = details.dateOfBirth
    ? ds.residencePeriods.map((r) => (r.memberId === memberId && r.from === UNKNOWN_BIRTH_DATE ? { ...r, from: details.dateOfBirth! } : r))
    : ds.residencePeriods;
  const next = { ...ds, members, residencePeriods, household: { ...ds.household, setup: { ...ds.household.setup, youConfirmedAt: at } } };
  return withAudit(next, "user", "setup:you", `member:${memberId}`);
}

export function hideSetup(ds: Dataset, at = new Date().toISOString()): Dataset {
  return { ...ds, household: { ...ds.household, setup: { ...ds.household.setup, hiddenAt: at } } };
}

/** An envelope budget from spending between two dates, each expense line rounded up to a multiple of ten. */
export function budgetFromSpending(ds: Dataset, period: string, start: IsoDate, end: IsoDate): Budget {
  const cats = categoryMap(ds);
  const lines = [...totalsByCategory(ds, start, end).values()]
    .filter((t) => t.categoryId && t.spentMinor > 0 && cats.get(t.categoryId)?.kind === "expense")
    .sort((a, b) => b.spentMinor - a.spentMinor)
    .map((t) => ({ categoryId: t.categoryId!, amountMinor: Math.ceil(t.spentMinor / 1000) * 1000, rollover: true }));
  return { id: newId("budget"), period, mode: "envelope", lines };
}

/**
 * A first budget for this period, made for the user: from last period's spending, else the latest
 * period with spending, else the monthly estimate. Null when there's nothing to go on.
 */
export function starterBudget(ds: Dataset, asOf: IsoDate): (Budget & { source: "spending" | "estimate" }) | null {
  const payday = ds.household.settings.paydayDayOfMonth;
  const period = periodOf(asOf, payday);
  const last = periodRange(previousPeriod(period), payday);
  const fromLast = budgetFromSpending(ds, period, last.start, last.end);
  if (fromLast.lines.length > 0) return { ...fromLast, source: "spending" };
  const window = spendingWindow(ds, asOf, payday);
  if (window.latest) {
    const fromLatest = budgetFromSpending(ds, period, window.start, window.end);
    if (fromLatest.lines.length > 0) return { ...fromLatest, source: "spending" };
  }
  const fromEstimate = budgetFromEstimate(ds, period);
  return fromEstimate && fromEstimate.lines.length > 0 ? { ...fromEstimate, source: "estimate" } : null;
}
