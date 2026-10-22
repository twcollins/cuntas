import { monthsBetween, type IsoDate } from "@cuntas/rules";
import { balancesByAccount } from "./balances";
import { FxTable } from "./fx";
import type { Dataset, Goal } from "./schema";

export interface GoalProgress {
  goal: Goal;
  savedMinor: number;
  remainingMinor: number;
  monthsLeft: number | null;
  monthlyNeededMinor: number | null;
  onTrack: boolean;
}

/** Saved amount comes from linked accounts (converted to the goal's currency) or the manual figure. */
export function goalProgress(ds: Dataset, goal: Goal, asOf: IsoDate, fx = new FxTable(ds.fxRates)): GoalProgress {
  let saved = goal.savedMinor;
  if (goal.linkedAccountIds.length > 0) {
    const balances = balancesByAccount(ds, asOf);
    saved = goal.linkedAccountIds.reduce((sum, id) => {
      const a = ds.accounts.find((x) => x.id === id);
      return a ? sum + (fx.tryConvert(balances.get(id) ?? 0, a.currency, goal.currency, asOf) ?? 0) : sum;
    }, 0);
  }
  const remaining = Math.max(0, goal.targetMinor - saved);
  const monthsLeft = goal.targetDate ? Math.max(1, monthsBetween(asOf, goal.targetDate)) : null;
  const monthlyNeeded = monthsLeft === null ? null : Math.ceil(remaining / monthsLeft);
  return {
    goal,
    savedMinor: saved,
    remainingMinor: remaining,
    monthsLeft,
    monthlyNeededMinor: monthlyNeeded,
    onTrack: remaining === 0 || (monthlyNeeded !== null && goal.monthlyContributionMinor >= monthlyNeeded),
  };
}
