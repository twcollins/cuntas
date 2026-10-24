import type { Currency } from "../money";
import type { IsoDate } from "../dates";

export type Jurisdiction = "IE" | "UK";
export type PackStatus = "provisional" | "verified";

export type Dated<T> = T & { from: IsoDate };
export type DeadlineRule = { monthDay: string; yearOffset: number };
export type Sourced = { source: string };
/** Sections added without official confirmation carry their own status, even inside a verified pack. */
export type SectionStatus = { status?: PackStatus };

export interface PackMeta {
  jurisdiction: Jurisdiction;
  taxYear: string;
  version: string;
  status: PackStatus;
  currency: Currency;
  effective: { from: IsoDate; to: IsoDate };
  sources: string[];
}

export interface IePack extends PackMeta {
  jurisdiction: "IE";
  incomeTax: Sourced & {
    standardRateBand: { single: number; marriedOneIncome: number; marriedTwoIncomesMax: number; oneParent: number };
    rates: { standard: number; higher: number };
    credits: {
      personalSingle: number;
      personalMarried: number;
      employee: number;
      earnedIncome: number;
      rentSingleMax: number;
      rentCoupleMax: number;
      rentRate: number;
    };
  };
  usc: Sourced & {
    exemptionThreshold: number;
    bands: { upTo: number | null; rate: number }[];
    selfEmployedSurcharge: { above: number; rate: number };
  };
  prsi: Sourced & {
    classA1: Dated<{ rate: number }>[];
    weeklyExemptionThreshold: number;
    credit: { upperWeeklyThreshold: number; maxWeekly: number; taperDivisor: number };
    classS?: Sourced & SectionStatus & { rates: Dated<{ rate: number }>[]; incomeThreshold: number; minimumContribution: number };
  };
  pension: Sourced & {
    earningsCap: number;
    ageBands: { minAge: number; rate: number }[];
    reliefClaimDeadline: DeadlineRule;
    statePensionAge: number;
    lumpSum?: Sourced & SectionStatus & { share: number; taxFreeMax: number; standardRateTop: number };
  };
  myFutureFund: Sourced & {
    from: IsoDate;
    eligibility: { minAge: number; maxAge: number; minEarnings: number };
    earningsCap: number;
    rates: { employee: number; employer: number; state: number };
  };
  cgt: Sourced & {
    rates: Dated<{ rate: number }>[];
    developmentLandRate: number;
    annualExemption: number;
    payment: { disposalsThroughMonth: number; dueMonthDay: string; yearOffset: number }[];
  };
  exitTax: Sourced & {
    rates: Dated<{ rate: number }>[];
    deemedDisposalYears: number;
    paymentDeadline: DeadlineRule;
  };
  dirt: Sourced & { rate: number };
  cat: Sourced & { rate: number; thresholds: Dated<{ groupA: number; groupB: number; groupC: number }>[] };
  investmentAccount?: Sourced & {
    featureFlag: string;
    from: IsoDate;
    annualContributionLimit: number;
    taxFreeValue: number;
    annualChargeRate: number;
  };
  helpToBuy: Sourced & { maxRelief: number; priceRate: number; lookbackYears: number };
  minimumWage?: Sourced & { hourly: number };
  deadlines: Sourced & { form11: DeadlineRule };
  statePension?: Sourced & SectionStatus & { maxWeeklyContributory: number; contributionYearsForMax: number; minimumContributionYears: number };
  selfAssessment?: Sourced &
    SectionStatus & {
      preliminaryTax: { currentYearShare: number; priorYearShare: number; prePrecedingYearShare: number };
      preliminaryDue: DeadlineRule;
    };
}

export interface UkPack extends PackMeta {
  jurisdiction: "UK";
  incomeTax: Sourced & {
    personalAllowance: number;
    taper: { above: number; divisor: number };
    bands: { upTo: number | null; rate: number }[];
  };
  nationalInsurance: Sourced & { primaryThreshold: number; upperEarningsLimit: number; mainRate: number; upperRate: number };
  isa: Sourced & {
    annualAllowance: number;
    lifetimeIsaLimit: number;
    juniorIsaLimit: number;
    cashCap?: { limit: number; appliesUnderAge: number };
    cashInStocksIsaInterestCharge?: number;
    stocksToCashTransferBlockedUnderAge?: number;
  };
  savings: Sourced & {
    rates: { basic: number; higher: number; additional: number };
    personalSavingsAllowance: { basic: number; higher: number; additional: number };
  };
  dividends?: Sourced & { allowance: number; rates: { basic: number; higher: number; additional: number } };
  statePension?: Sourced & { fullWeekly: number; qualifyingYearsForFull: number; minimumQualifyingYears: number; pensionAge?: number };
  niVoluntary?: Sourced & { class2AbroadAbolishedFrom: IsoDate; class3AnnualCost: number; abroadMinimumYearsUkLink: number };
  pensionsIht?: Sourced & { unusedPensionsInEstateFrom: IsoDate };
  deadlines: Sourced & { selfAssessmentOnline: DeadlineRule };
  studentLoans?: Sourced & SectionStatus & { plans: Record<StudentLoanPlan, { threshold: number; rate: number }> };
  cgt?: Sourced & SectionStatus & { annualExemptAmount: number; rates: { basic: number; higher: number } };
  pensionAnnualAllowance?: Sourced &
    SectionStatus & {
      annualAllowance: number;
      taper: { thresholdIncome: number; adjustedIncome: number; divisor: number; minimum: number };
      moneyPurchaseAnnualAllowance: number;
      carryForwardYears: number;
      noEarningsReliefLimit: number;
    };
  pensionLumpSum?: Sourced & SectionStatus & { share: number; lumpSumAllowance: number };
}

export type StudentLoanPlan = "plan1" | "plan2" | "plan4" | "plan5" | "postgraduate";
export type UkRegion = "rUK" | "scotland";

/** A regional sub-pack that replaces the parent UK pack's income tax bands (Scotland). */
export interface UkRegionPack {
  kind: "ukRegion";
  region: Exclude<UkRegion, "rUK">;
  parent: "UK";
  taxYear: string;
  version: string;
  status: PackStatus;
  effective: { from: IsoDate; to: IsoDate };
  sources: string[];
  incomeTax: Sourced & { bands: { upTo: number | null; rate: number; name: string }[] };
}

export interface ChartDefaults {
  id: string;
  version: string;
  source: string;
  starterFund: { floor: number; months: number };
  fullFund: { floorLow: number; floorHigh: number; monthsLow: number; monthsHigh: number };
  debt: { highAprAbove: number; moderateAprFrom: number };
  retirement: { shareOfAge: number };
  mortgageOverpay: { rate: number };
  goals: { savingsHorizonYears: number };
  reminders: { renewalDaysAhead: number; consentDaysAhead: number };
  debtPlanner: { extraPaymentProbe: number };
  projections: {
    nominalReturn: number;
    inflation: number;
    scenarioSpread: number;
    withdrawalRate: number;
    depositRate: number;
    dividendYield: number;
    years: number;
  };
}

export interface TreatyPack {
  id: string;
  version: string;
  source: string;
  articles: Record<
    "employment" | "privatePension" | "governmentService" | "interest" | "eliminationOfDoubleTax",
    { ref: string; source: string }
  >;
  transBorderRelief: { ref: string; source: string };
  isa: { ref: string; source: string };
  relocation?: { source: string; toUK: RelocationNote[]; toIE: RelocationNote[] };
}

export interface RelocationNote {
  topic: string;
  text: string;
  source: string;
}

export type RulePack = IePack | UkPack;

/** A reference from a calculated figure back to the rule that produced it. */
export interface RuleRef {
  pack: string;
  key: string;
  source: string;
  value?: number | string;
}

/** One explainable line of a calculation. */
export interface ExplainedLine {
  label: string;
  amountMinor: number;
  rule?: RuleRef;
  detail?: string;
}
