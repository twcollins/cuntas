import { applyRate, sumMinor, toMinor } from "../../money";
import type { RuleRef, StudentLoanPlan, UkPack } from "../../packs";

export const UNDERGRADUATE_PLANS: readonly StudentLoanPlan[] = ["plan1", "plan2", "plan4", "plan5"];

export interface StudentLoanLine {
  plan: StudentLoanPlan | "undergraduate";
  thresholdMinor: number;
  rate: number;
  amountMinor: number;
  rule: RuleRef;
}

/**
 * Annual student loan repayments through PAYE. With more than one undergraduate plan you repay once,
 * on income above the lowest of their thresholds; a postgraduate loan is repaid on top.
 */
export function ukStudentLoanRepayment(pack: UkPack, input: { incomeMinor: number; plans: readonly StudentLoanPlan[] }) {
  const sl = pack.studentLoans;
  const notes: string[] = [];
  if (!sl) {
    return { totalMinor: 0, lines: [] as StudentLoanLine[], notes: input.plans.length ? [`Rule pack ${pack.version} has no student loan data.`] : [] };
  }
  const lines: StudentLoanLine[] = [];
  const undergrad = UNDERGRADUATE_PLANS.filter((p) => input.plans.includes(p)).map((p) => ({ plan: p, ...sl.plans[p] }));
  if (undergrad.length > 0) {
    const lowest = [...undergrad].sort((a, b) => a.threshold - b.threshold)[0]!;
    const thresholdMinor = toMinor(lowest.threshold);
    lines.push({
      plan: undergrad.length > 1 ? "undergraduate" : lowest.plan,
      thresholdMinor,
      rate: lowest.rate,
      amountMinor: applyRate(Math.max(0, input.incomeMinor - thresholdMinor), lowest.rate),
      rule: { pack: pack.version, key: `studentLoans.plans.${lowest.plan}`, source: sl.source, value: lowest.threshold },
    });
    if (undergrad.length > 1) notes.push(`Several undergraduate plans: repayments start above the lowest threshold (${lowest.plan}) and are split between them.`);
  }
  if (input.plans.includes("postgraduate")) {
    const pg = sl.plans.postgraduate;
    const thresholdMinor = toMinor(pg.threshold);
    lines.push({
      plan: "postgraduate",
      thresholdMinor,
      rate: pg.rate,
      amountMinor: applyRate(Math.max(0, input.incomeMinor - thresholdMinor), pg.rate),
      rule: { pack: pack.version, key: "studentLoans.plans.postgraduate", source: sl.source, value: pg.threshold },
    });
  }
  return { totalMinor: sumMinor(lines.map((l) => l.amountMinor)), lines, notes };
}
