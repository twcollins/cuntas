import { addMonths, type IsoDate } from "@cuntas/rules";

export interface PlannerDebt {
  id: string;
  name: string;
  balanceMinor: number;
  /** APR as a decimal. */
  apr: number;
  minPaymentMinor: number;
}

export type Strategy = "avalanche" | "snowball";

export interface PayoffPlan {
  strategy: Strategy;
  feasible: boolean;
  months: number;
  totalInterestMinor: number;
  totalPaidMinor: number;
  payoffDates: { id: string; name: string; month: number; date: IsoDate; interestMinor: number }[];
  order: string[];
  schedule: { month: number; date: IsoDate; balanceMinor: number; interestMinor: number }[];
  warning?: string;
}

const MAX_MONTHS = 600;

function orderOf(debts: PlannerDebt[], strategy: Strategy): PlannerDebt[] {
  return [...debts].sort((a, b) =>
    strategy === "avalanche" ? b.apr - a.apr || a.balanceMinor - b.balanceMinor : a.balanceMinor - b.balanceMinor || b.apr - a.apr,
  );
}

/**
 * Month-by-month payoff simulation. Every debt gets its minimum; the rest of the monthly budget
 * goes to the target debt (highest APR for avalanche, smallest balance for snowball). Freed minimums roll on.
 */
export function planPayoff(debts: readonly PlannerDebt[], monthlyBudgetMinor: number, strategy: Strategy, start: IsoDate): PayoffPlan {
  const active = debts.filter((d) => d.balanceMinor > 0).map((d) => ({ ...d, interest: 0, paidOffMonth: 0 }));
  const minimums = active.reduce((a, d) => a + d.minPaymentMinor, 0);
  const order = orderOf(active, strategy).map((d) => d.id);
  const schedule: PayoffPlan["schedule"] = [];
  let totalInterest = 0;
  let totalPaid = 0;
  let month = 0;
  const warning = monthlyBudgetMinor < minimums ? "Monthly budget is below the sum of minimum payments." : undefined;

  while (active.some((d) => d.balanceMinor > 0) && month < MAX_MONTHS) {
    month++;
    let interestThisMonth = 0;
    for (const d of active) {
      if (d.balanceMinor <= 0) continue;
      const interest = Math.round((d.balanceMinor * d.apr) / 12);
      d.balanceMinor += interest;
      d.interest += interest;
      interestThisMonth += interest;
    }
    let budget = Math.max(monthlyBudgetMinor, 0);
    for (const d of active) {
      if (d.balanceMinor <= 0) continue;
      const pay = Math.min(d.minPaymentMinor, d.balanceMinor, budget);
      d.balanceMinor -= pay;
      budget -= pay;
      totalPaid += pay;
    }
    for (const id of order) {
      const d = active.find((x) => x.id === id)!;
      if (d.balanceMinor <= 0 || budget <= 0) continue;
      const pay = Math.min(d.balanceMinor, budget);
      d.balanceMinor -= pay;
      budget -= pay;
      totalPaid += pay;
    }
    for (const d of active) if (d.balanceMinor <= 0 && d.paidOffMonth === 0) d.paidOffMonth = month;
    totalInterest += interestThisMonth;
    schedule.push({ month, date: addMonths(start, month), balanceMinor: active.reduce((a, d) => a + Math.max(0, d.balanceMinor), 0), interestMinor: interestThisMonth });
    if (interestThisMonth > 0 && schedule.length > 1 && schedule[schedule.length - 1]!.balanceMinor >= schedule[schedule.length - 2]!.balanceMinor) {
      break; // payments don't cover interest
    }
  }
  const feasible = active.every((d) => d.balanceMinor <= 0);
  const finalWarning = warning ?? (feasible ? undefined : "Payments never clear the balance at this budget.");
  return {
    strategy,
    feasible,
    months: month,
    totalInterestMinor: totalInterest,
    totalPaidMinor: totalPaid,
    payoffDates: active.map((d) => ({ id: d.id, name: d.name, month: d.paidOffMonth, date: addMonths(start, d.paidOffMonth), interestMinor: d.interest })),
    order,
    schedule,
    ...(finalWarning ? { warning: finalWarning } : {}),
  };
}

/** Compares avalanche and snowball, and the interest saved by paying an extra amount each month. */
export function comparePayoff(debts: readonly PlannerDebt[], monthlyBudgetMinor: number, start: IsoDate, extraProbeMinor: number) {
  const avalanche = planPayoff(debts, monthlyBudgetMinor, "avalanche", start);
  const snowball = planPayoff(debts, monthlyBudgetMinor, "snowball", start);
  const withExtra = planPayoff(debts, monthlyBudgetMinor + extraProbeMinor, "avalanche", start);
  return {
    avalanche,
    snowball,
    extraProbeMinor,
    interestSavedByExtraMinor: avalanche.totalInterestMinor - withExtra.totalInterestMinor,
    monthsSavedByExtra: avalanche.months - withExtra.months,
  };
}
