import { applyRate, divideMinor, formatRate, splitEvenly, sumMinor, toMinor } from "../../money";
import { MONTHS_PER_YEAR, deadlineFor, lastDayOfMonth, type IsoDate } from "../../dates";
import { onDate, type ExplainedLine, type IePack, type RuleRef } from "../../packs";
import { bandedTax } from "../shared";
import { iePrsi, ieUsc, standardBandMinor, type IeAssessment } from "./payroll";
import { pensionReliefLimit } from "./pensionRelief";

function ref(pack: IePack, key: string, source: string, value?: number | string): RuleRef {
  return { pack: pack.version, key, source, ...(value !== undefined ? { value } : {}) };
}

function selfAssessmentRules(pack: IePack) {
  const sa = pack.selfAssessment;
  if (!sa) throw new Error(`Rule pack ${pack.version} has no self-assessment data`);
  return sa;
}

/**
 * Class S PRSI on self-employed income for a tax year. A rate change during the year applies month by
 * month, so a 1 October increase counts for three months of the year.
 */
export function ieClassS(pack: IePack, incomeMinor: number): { amountMinor: number; effectiveRate: number; lines: ExplainedLine[]; notes: string[] } {
  const s = pack.prsi.classS;
  if (!s) return { amountMinor: 0, effectiveRate: 0, lines: [], notes: [`Rule pack ${pack.version} has no Class S PRSI data.`] };
  const rule = ref(pack, "prsi.classS", s.source);
  if (incomeMinor <= toMinor(s.incomeThreshold)) {
    return {
      amountMinor: 0,
      effectiveRate: 0,
      lines: [{ label: "PRSI Class S: income at or below the threshold", amountMinor: 0, rule: { ...rule, key: "prsi.classS.incomeThreshold", value: s.incomeThreshold } }],
      notes: [],
    };
  }
  const year = Number(pack.taxYear);
  const months = splitEvenly(incomeMinor, MONTHS_PER_YEAR);
  const charged = sumMinor(months.map((m, i) => applyRate(m, onDate(s.rates, lastDayOfMonth(year, i)).rate)));
  const minimum = toMinor(s.minimumContribution);
  const amountMinor = Math.max(charged, minimum);
  const rates = [...new Set(s.rates.map((r) => r.rate))];
  const lines: ExplainedLine[] = [
    { label: `PRSI Class S (${rates.map(formatRate).join(" then ")}, by month)`, amountMinor, rule },
  ];
  const notes = charged < minimum ? [`Class S has a minimum annual contribution of ${s.minimumContribution} euro.`] : [];
  return { amountMinor, effectiveRate: amountMinor / incomeMinor, lines, notes };
}

export interface IeSelfAssessmentInput {
  /** Case I/II trading profit for the year, after capital allowances. */
  tradingProfitMinor: number;
  /** Employment income in the same year, taxed through PAYE. */
  payeIncomeMinor?: number;
  /** Income tax, USC and PRSI already deducted through PAYE. */
  payeDeductedMinor?: number;
  assessment: IeAssessment;
  spouseGrossAnnualMinor?: number;
  age: number;
  /** Personal pension contributions for the year (relievable up to the age-band limit). */
  pensionContributionMinor?: number;
  /** Self-assessed liability (net of PAYE) for the year before. */
  priorYearLiabilityMinor?: number;
  /** Self-assessed liability for the year before that, for the 105% direct-debit basis. */
  prePrecedingYearLiabilityMinor?: number;
  /** Preliminary tax already paid for this year. */
  preliminaryPaidMinor?: number;
}

export interface PreliminaryOption {
  basis: "currentYear" | "priorYear" | "prePrecedingYear";
  label: string;
  amountMinor: number;
  rule: RuleRef;
}

export interface IeSelfAssessmentResult {
  pack: string;
  packStatus: IePack["status"];
  taxYear: string;
  totalIncomeMinor: number;
  pensionRelievedMinor: number;
  incomeTaxMinor: number;
  uscMinor: number;
  prsiMinor: number;
  liabilityMinor: number;
  /** Liability less tax already deducted through PAYE: what self-assessment collects. */
  netLiabilityMinor: number;
  balanceDueMinor: number;
  setAsideMonthlyMinor: number;
  setAsideRate: number;
  preliminaryThisYear: { requiredMinor: number; paidMinor: number; shortfallMinor: number; options: PreliminaryOption[] };
  preliminaryNextYear: { minimumMinor: number; options: PreliminaryOption[] };
  deadlines: { label: string; date: IsoDate }[];
  lines: ExplainedLine[];
  notes: string[];
}

/** Form 11 estimate: liability for the year, the balance due, and preliminary tax for this year and next. */
export function ieSelfAssessment(pack: IePack, input: IeSelfAssessmentInput): IeSelfAssessmentResult {
  const sa = selfAssessmentRules(pack);
  const it = pack.incomeTax;
  const notes: string[] = [];
  const lines: ExplainedLine[] = [];
  const profit = Math.max(0, input.tradingProfitMinor);
  const paye = input.payeIncomeMinor ?? 0;
  const total = profit + paye;
  const joint = input.assessment === "marriedTwoIncomes";
  const married = joint || input.assessment === "marriedOneIncome";
  const spouseGross = joint ? (input.spouseGrossAnnualMinor ?? 0) : 0;

  const limit = pensionReliefLimit(pack, input.age, total);
  const pensionRelievedMinor = Math.min(input.pensionContributionMinor ?? 0, limit.limitMinor);
  if ((input.pensionContributionMinor ?? 0) > pensionRelievedMinor) notes.push("Pension contributions above your age-band limit get no relief this year.");
  const taxable = total - pensionRelievedMinor;
  const householdTaxable = taxable + spouseGross;
  const bandMinor = standardBandMinor(pack, { assessment: input.assessment, grossAnnualMinor: taxable, spouseGrossAnnualMinor: spouseGross });
  const banded = bandedTax(householdTaxable, [
    { upToMinor: bandMinor, rate: it.rates.standard },
    { upToMinor: null, rate: it.rates.higher },
  ]);
  lines.push({ label: `Income tax at ${formatRate(it.rates.standard)}`, amountMinor: banded[0]?.taxMinor ?? 0, rule: ref(pack, `incomeTax.standardRateBand.${input.assessment}`, it.source) });
  lines.push({ label: `Income tax at ${formatRate(it.rates.higher)}`, amountMinor: banded[1]?.taxMinor ?? 0, rule: ref(pack, "incomeTax.rates.higher", it.source) });

  const personal = toMinor(married ? it.credits.personalMarried : it.credits.personalSingle);
  // With both PAYE and trading income, the employee and earned income credits share one combined cap.
  const employee = toMinor(it.credits.employee);
  const earned = toMinor(it.credits.earnedIncome);
  const ownWork = paye > 0 ? Math.max(employee, earned) : earned;
  const workCredits = ownWork + (joint && spouseGross > 0 ? employee : 0);
  lines.push({ label: married ? "Personal tax credit (married)" : "Personal tax credit", amountMinor: -personal, rule: ref(pack, married ? "incomeTax.credits.personalMarried" : "incomeTax.credits.personalSingle", it.source) });
  lines.push({ label: paye > 0 ? "Employee and earned income credits (combined cap)" : "Earned income tax credit", amountMinor: -workCredits, rule: ref(pack, "incomeTax.credits.earnedIncome", it.source) });
  const householdTax = Math.max(0, sumMinor(banded.map((b) => b.taxMinor)) - personal - workCredits);
  const incomeTaxMinor = joint && householdTaxable > 0 ? Math.round((householdTax * taxable) / householdTaxable) : householdTax;
  if (joint) notes.push("Joint assessment: income tax is shown apportioned by share of income.");

  const usc = ieUsc(pack, total, profit);
  lines.push(...usc.lines);
  const classS = ieClassS(pack, profit);
  lines.push(...classS.lines);
  notes.push(...classS.notes);
  const classA = paye > 0 ? sumMinor(iePrsi(pack, paye, "monthly").map((p) => p.prsiMinor)) : 0;
  if (classA > 0) lines.push({ label: "PRSI Class A1 on employment income", amountMinor: classA, rule: ref(pack, "prsi.classA1", pack.prsi.source) });
  const prsiMinor = classS.amountMinor + classA;

  const liabilityMinor = incomeTaxMinor + usc.amountMinor + prsiMinor;
  const netLiabilityMinor = Math.max(0, liabilityMinor - (input.payeDeductedMinor ?? 0));
  const paidMinor = input.preliminaryPaidMinor ?? 0;
  const balanceDueMinor = netLiabilityMinor - paidMinor;
  const pt = sa.preliminaryTax;
  const saRef = (key: string, value: number) => ref(pack, `selfAssessment.preliminaryTax.${key}`, sa.source, value);

  const thisYearOptions: PreliminaryOption[] = [
    { basis: "currentYear", label: `${formatRate(pt.currentYearShare)} of this year's liability`, amountMinor: applyRate(netLiabilityMinor, pt.currentYearShare), rule: saRef("currentYearShare", pt.currentYearShare) },
  ];
  if (input.priorYearLiabilityMinor !== undefined) {
    thisYearOptions.push({ basis: "priorYear", label: `${formatRate(pt.priorYearShare)} of last year's liability`, amountMinor: applyRate(input.priorYearLiabilityMinor, pt.priorYearShare), rule: saRef("priorYearShare", pt.priorYearShare) });
  }
  if (input.prePrecedingYearLiabilityMinor !== undefined && input.prePrecedingYearLiabilityMinor > 0) {
    thisYearOptions.push({ basis: "prePrecedingYear", label: `${formatRate(pt.prePrecedingYearShare)} of the liability two years ago (direct debit only)`, amountMinor: applyRate(input.prePrecedingYearLiabilityMinor, pt.prePrecedingYearShare), rule: saRef("prePrecedingYearShare", pt.prePrecedingYearShare) });
  }
  const requiredMinor = Math.min(...thisYearOptions.map((o) => o.amountMinor));
  const shortfallMinor = Math.max(0, requiredMinor - paidMinor);
  if (shortfallMinor > 0) notes.push("Preliminary tax paid is below the lowest safe basis: Revenue may charge interest on the difference.");

  // For next year, this year becomes the prior year and last year the pre-preceding year.
  const nextOptions: PreliminaryOption[] = [
    { basis: "currentYear", label: `${formatRate(pt.currentYearShare)} of next year's liability (if income is similar)`, amountMinor: applyRate(netLiabilityMinor, pt.currentYearShare), rule: saRef("currentYearShare", pt.currentYearShare) },
    { basis: "priorYear", label: `${formatRate(pt.priorYearShare)} of this year's liability`, amountMinor: applyRate(netLiabilityMinor, pt.priorYearShare), rule: saRef("priorYearShare", pt.priorYearShare) },
  ];
  if (input.priorYearLiabilityMinor !== undefined && input.priorYearLiabilityMinor > 0) {
    nextOptions.push({ basis: "prePrecedingYear", label: `${formatRate(pt.prePrecedingYearShare)} of last year's liability (direct debit only)`, amountMinor: applyRate(input.priorYearLiabilityMinor, pt.prePrecedingYearShare), rule: saRef("prePrecedingYearShare", pt.prePrecedingYearShare) });
  }

  const year = Number(pack.taxYear);
  const deadlines = [
    { label: `Preliminary tax for ${year}`, date: deadlineFor(year, sa.preliminaryDue) },
    { label: `Form 11 for ${year}, balance for ${year} and preliminary tax for ${year + 1}`, date: deadlineFor(year, pack.deadlines.form11) },
  ];
  notes.push("Filing and paying through ROS usually extends the 31 October deadline to mid-November.");

  return {
    pack: pack.version,
    packStatus: sa.status ?? pack.status,
    taxYear: pack.taxYear,
    totalIncomeMinor: total,
    pensionRelievedMinor,
    incomeTaxMinor,
    uscMinor: usc.amountMinor,
    prsiMinor,
    liabilityMinor,
    netLiabilityMinor,
    balanceDueMinor,
    setAsideMonthlyMinor: divideMinor(netLiabilityMinor, MONTHS_PER_YEAR),
    setAsideRate: profit > 0 ? netLiabilityMinor / profit : 0,
    preliminaryThisYear: { requiredMinor, paidMinor, shortfallMinor, options: thisYearOptions },
    preliminaryNextYear: { minimumMinor: Math.min(...nextOptions.map((o) => o.amountMinor)), options: nextOptions },
    deadlines,
    lines,
    notes,
  };
}
