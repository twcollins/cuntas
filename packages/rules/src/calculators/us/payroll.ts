import { applyRate, divideMinor, sumMinor, toMinor } from "../../money";
import { MONTHS_PER_YEAR } from "../../dates";
import type { ExplainedLine, UsFilingStatus, UsPack, UsStatePack } from "../../packs";
import { US_STATES } from "../../usStates";
import { usStateTax } from "./state";
import { bandedTax } from "../shared";

export interface UsEarner {
  /** Wages, or net profit for the self-employed. */
  grossAnnualMinor: number;
  employment: "employee" | "selfEmployed";
  age: number;
  /** Traditional 401(k) deferrals: out of income tax, not FICA. */
  pretax401kMinor?: number;
  /** Section 125 (cafeteria plan) deductions such as HSA or health premiums: out of income tax and FICA. */
  pretaxSection125Minor?: number;
}

export interface UsPayrollInput extends UsEarner {
  filingStatus: UsFilingStatus;
  /** The other spouse on a joint return. */
  spouse?: UsEarner;
  /** Qualifying children claimed on this return. */
  children?: number;
  /** The state of residence's pack, when known. Without it the result is federal only. */
  state?: UsStatePack;
  /** Locality within the state, for packs that carry local rates (Indiana counties). */
  locality?: string | null;
  /** Rent paid on the home this year, for state renter's deductions. */
  rentPaidMinor?: number;
}

/** One earner's FICA or self-employment tax and their share of the return's income. */
function earnerFigures(pack: UsPack, e: UsEarner) {
  const { fica, selfEmployment: se } = pack;
  const base = toMinor(fica.socialSecurityWageBase);
  const deferral = e.pretax401kMinor ?? 0;
  const sec125 = e.pretaxSection125Minor ?? 0;
  if (e.employment === "selfEmployed") {
    const earnings = applyRate(Math.max(0, e.grossAnnualMinor - sec125), se.earningsFactor);
    const seTax = applyRate(Math.min(earnings, base), se.socialSecurityRate) + applyRate(earnings, se.medicareRate);
    const deductible = applyRate(seTax, se.deductibleShare);
    const businessIncome = Math.max(0, e.grossAnnualMinor - sec125 - deductible);
    return { agi: Math.max(0, businessIncome - deferral), medicareWages: earnings, socialSecurity: 0, medicare: 0, seTax, businessIncome, earned: businessIncome, underWageBase: earnings < base };
  }
  const ficaWages = Math.max(0, e.grossAnnualMinor - sec125);
  return {
    agi: Math.max(0, ficaWages - deferral),
    medicareWages: ficaWages,
    socialSecurity: applyRate(Math.min(ficaWages, base), fica.socialSecurityRate),
    medicare: applyRate(ficaWages, fica.medicareRate),
    seTax: 0,
    businessIncome: 0,
    earned: ficaWages,
    underWageBase: ficaWages < base,
  };
}

/**
 * US federal income tax (as owed for the year, not withheld), Social Security, Medicare and
 * self-employment tax for one person. On a joint return the return's income tax and credits are
 * shared between the spouses by income. State and local income tax are not included.
 */
export function usPayroll(pack: UsPack, input: UsPayrollInput) {
  const status = input.filingStatus;
  const joint = status === "marriedJoint" && input.spouse !== undefined;
  const married = status === "marriedJoint" || status === "marriedSeparate";
  const earners = joint ? [input, input.spouse!] : [input];
  const figures = earners.map((e) => earnerFigures(pack, e));
  const self = figures[0]!;
  const agi = sumMinor(figures.map((f) => f.agi));
  const rule = (key: string, source: string, value?: number): ExplainedLine["rule"] => ({ pack: pack.version, key, source, ...(value === undefined ? {} : { value }) });
  const notes: string[] = input.state ? [] : ["Federal only: State and local income tax are not included."];

  // Deductions: standard, extra for age, the senior deduction, then qualified business income.
  const sd = pack.standardDeduction;
  const standard = toMinor(sd[status]);
  const aged = earners.filter((e) => e.age >= sd.additionalAged.age).length;
  const agedExtra = aged * toMinor(married ? sd.additionalAged.married : sd.additionalAged.unmarried);
  let senior = 0;
  const sen = pack.seniorDeduction;
  if (sen && status !== "marriedSeparate") {
    const reduction = applyRate(Math.max(0, agi - toMinor(joint ? sen.phaseOut.marriedJoint : sen.phaseOut.single)), sen.phaseOut.rate);
    senior = earners.filter((e) => e.age >= sen.age).reduce((a) => a + Math.max(0, toMinor(sen.perPerson) - reduction), 0);
  }
  const beforeQbi = Math.max(0, agi - standard - agedExtra - senior);
  const q = pack.qualifiedBusinessIncome;
  const businessIncome = sumMinor(figures.map((f) => f.businessIncome));
  let qbi = 0;
  if (businessIncome >= toMinor(q.minimumIncome)) {
    if (beforeQbi <= toMinor(q.threshold[status])) qbi = applyRate(Math.min(businessIncome, beforeQbi), q.rate);
    else notes.push("Business income deduction not estimated: above the threshold, wage and property limits apply.");
  }
  const taxable = beforeQbi - qbi;

  const bands = pack.incomeTax.brackets[status].map((b) => ({ upToMinor: b.upTo === null ? null : toMinor(b.upTo), rate: b.rate }));
  const banded = bandedTax(taxable, bands);
  const taxBeforeCredits = sumMinor(banded.map((b) => b.taxMinor));

  // Child tax credit: reduced in steps above the income threshold; the part above the tax owed is
  // refundable up to a cap per child and a share of earned income.
  const c = pack.childTaxCredit;
  const children = input.children ?? 0;
  const over = Math.max(0, agi - toMinor(status === "marriedJoint" ? c.phaseOut.marriedJoint : c.phaseOut.other));
  const ctc = Math.max(0, children * toMinor(c.perChild) - Math.ceil(over / toMinor(c.phaseOut.step)) * toMinor(c.phaseOut.reductionPerStep));
  const nonRefundable = Math.min(ctc, taxBeforeCredits);
  const earned = sumMinor(figures.map((f) => f.earned));
  const refundable = Math.min(ctc - nonRefundable, children * toMinor(c.refundable.perChild), applyRate(Math.max(0, earned - toMinor(c.refundable.earnedIncomeFloor)), c.refundable.rate));
  const returnTax = taxBeforeCredits - nonRefundable;

  const am = pack.fica.additionalMedicare;
  const medicareWages = sumMinor(figures.map((f) => f.medicareWages));
  const additionalMedicare = applyRate(Math.max(0, medicareWages - toMinor(am.thresholds[status])), am.rate);

  // This person's share of return-level amounts.
  const share = (amount: number) => (!joint ? amount : agi === 0 ? Math.round(amount / earners.length) : Math.round((amount * self.agi) / agi));
  const shareByMedicare = (amount: number) => (!joint || medicareWages === 0 ? amount : Math.round((amount * self.medicareWages) / medicareWages));
  if (joint) notes.push("Filing jointly: income tax and credits are the joint return's, split between you by income.");
  if (children > 0 && ctc < children * toMinor(c.perChild)) notes.push("The child tax credit is reduced because income is above the threshold.");

  // State income tax on the same return, shared the same way.
  const wages = sumMinor(earners.map((e) => Math.max(0, e.grossAnnualMinor - (e.pretaxSection125Minor ?? 0))));
  const stateTax = input.state
    ? usStateTax(input.state, {
        filingStatus: status,
        federalAgiMinor: agi,
        federalTaxableIncomeMinor: taxable,
        wagesMinor: wages,
        federalStandardDeductionMinor: standard,
        // A joint return has both spouses as filers.
        filers: 1 + (status === "marriedJoint" ? 1 : 0),
        dependents: children,
        agedFilers: aged,
        payrollTaxByFilerMinor: figures.map((f) => f.socialSecurity + f.medicare + f.seTax),
        locality: input.locality ?? null,
        rentPaidMinor: input.rentPaidMinor ?? 0,
        filerAgiMinor: figures.map((f) => f.agi),
        federalIncomeTaxMinor: returnTax,
        filerAged: earners.map((e) => e.age >= sd.additionalAged.age),
      })
    : null;
  if (stateTax) notes.push(...stateTax.notes);
  const levyMinor = stateTax ? share(stateTax.levyMinor) : 0;
  const stateTaxMinor = (stateTax ? share(stateTax.taxMinor) : 0) + levyMinor;
  const localTaxMinor = stateTax ? share(stateTax.localTaxMinor) : 0;

  const incomeTaxMinor = share(returnTax);
  const refundableCreditMinor = share(refundable);
  const medicareMinor = self.medicare + shareByMedicare(additionalMedicare);
  const deductions = (input.pretax401kMinor ?? 0) + (input.pretaxSection125Minor ?? 0);
  const netAnnualMinor = input.grossAnnualMinor - deductions - incomeTaxMinor - self.socialSecurity - medicareMinor - self.seTax + refundableCreditMinor - stateTaxMinor - localTaxMinor;

  const bracketRate = taxable === 0 ? 0 : (banded.filter((b) => b.portionMinor > 0).at(-1)?.rate ?? 0);
  const overAdditional = medicareWages > toMinor(am.thresholds[status]) ? am.rate : 0;
  const se = pack.selfEmployment;
  const payrollRate =
    input.employment === "selfEmployed"
      ? se.earningsFactor * ((self.underWageBase ? se.socialSecurityRate : 0) + se.medicareRate + overAdditional)
      : (self.underWageBase ? pack.fica.socialSecurityRate : 0) + pack.fica.medicareRate + overAdditional;

  const lines: ExplainedLine[] = [
    { label: "Standard deduction", amountMinor: standard, rule: rule(`standardDeduction.${status}`, sd.source) },
    ...(agedExtra ? [{ label: "Additional deduction, 65 or over", amountMinor: agedExtra, rule: rule("standardDeduction.additionalAged", sd.source) }] : []),
    ...(senior && sen ? [{ label: "Senior deduction", amountMinor: senior, rule: rule("seniorDeduction", sen.source) }] : []),
    ...(qbi ? [{ label: "Qualified business income deduction", amountMinor: qbi, rule: rule("qualifiedBusinessIncome", q.source, q.rate) }] : []),
    ...banded
      .filter((b) => b.portionMinor > 0)
      .map((b, i) => ({ label: `Federal income tax at ${Math.round(b.rate * 100)}%`, amountMinor: share(b.taxMinor), rule: rule(`incomeTax.brackets.${status}[${i}]`, pack.incomeTax.source, b.rate) })),
    ...(ctc ? [{ label: "Child tax credit", amountMinor: -share(ctc), rule: rule("childTaxCredit", c.source) }] : []),
    ...(input.employment === "employee"
      ? [
          { label: "Social Security", amountMinor: self.socialSecurity, rule: rule("fica.socialSecurityRate", pack.fica.source, pack.fica.socialSecurityRate) },
          { label: "Medicare", amountMinor: self.medicare, rule: rule("fica.medicareRate", pack.fica.source, pack.fica.medicareRate) },
        ]
      : [{ label: "Self-employment tax", amountMinor: self.seTax, rule: rule("selfEmployment", se.source) }]),
    ...(additionalMedicare ? [{ label: "Additional Medicare tax", amountMinor: shareByMedicare(additionalMedicare), rule: rule("fica.additionalMedicare", am.source, am.rate) }] : []),
    ...(stateTax
      ? stateTax.lines.map((l) =>
          l.label === `${US_STATES[input.state!.state]} income tax`
            ? { ...l, amountMinor: stateTaxMinor - levyMinor }
            : l.rule?.key.startsWith("localities.")
              ? { ...l, amountMinor: localTaxMinor }
              : l.rule?.key === "incomeTax.wageLevy"
                ? { ...l, amountMinor: levyMinor }
                : l,
        )
      : []),
  ];

  return {
    pack: pack.version,
    packStatus: pack.status,
    taxYear: pack.taxYear,
    grossMinor: input.grossAnnualMinor,
    filingStatus: status,
    /** Adjusted gross income on the return (joint returns: both spouses). */
    agiMinor: agi,
    /** Taxable income on the return (joint returns: both spouses). */
    taxableIncomeMinor: taxable,
    returnIncomeTaxBeforeCreditsMinor: taxBeforeCredits,
    childTaxCreditMinor: ctc,
    /** This person's federal income tax after credits. */
    incomeTaxMinor,
    refundableCreditMinor,
    socialSecurityMinor: self.socialSecurity,
    medicareMinor,
    selfEmploymentTaxMinor: self.seTax,
    netAnnualMinor,
    netPerPeriodMinor: divideMinor(netAnnualMinor, MONTHS_PER_YEAR),
    marginalRate: bracketRate + payrollRate + (stateTax?.marginalRate ?? 0),
    /** This person's share of state income tax; 0 without a state pack. */
    stateTaxMinor,
    /** This person's share of local income tax, where the pack carries the locality's rate. */
    localTaxMinor,
    statePack: stateTax?.pack ?? null,
    lines,
    notes,
  };
}
