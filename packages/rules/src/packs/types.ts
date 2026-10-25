import type { Currency } from "../money";
import type { UsState } from "../usStates";
import type { IsoDate } from "../dates";

/** Countries with rule packs and calculators. US packs are federal only; states come later. */
export const TAX_JURISDICTIONS = ["IE", "UK", "US"] as const;
export type Jurisdiction = (typeof TAX_JURISDICTIONS)[number];
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

export const US_FILING_STATUSES = ["single", "marriedJoint", "marriedSeparate", "headOfHousehold"] as const;
export type UsFilingStatus = (typeof US_FILING_STATUSES)[number];
export type ByFilingStatus<T> = Record<UsFilingStatus, T>;
type Bands = { upTo: number | null; rate: number }[];
/** An income range [from, to] over which something phases out. */
type Range = [number, number];

export interface UsPack extends PackMeta {
  jurisdiction: "US";
  incomeTax: Sourced & { brackets: ByFilingStatus<Bands> };
  standardDeduction: Sourced & ByFilingStatus<number> & { additionalAged: { age: number; married: number; unmarried: number } };
  seniorDeduction?: Sourced & SectionStatus & { perPerson: number; age: number; phaseOut: { single: number; marriedJoint: number; rate: number } };
  childTaxCredit: Sourced & {
    perChild: number;
    underAge: number;
    phaseOut: { marriedJoint: number; other: number; step: number; reductionPerStep: number };
    refundable: { perChild: number; earnedIncomeFloor: number; rate: number };
  };
  fica: Sourced & {
    socialSecurityRate: number;
    socialSecurityWageBase: number;
    medicareRate: number;
    additionalMedicare: Sourced & { rate: number; thresholds: ByFilingStatus<number> };
  };
  selfEmployment: Sourced & { earningsFactor: number; socialSecurityRate: number; medicareRate: number; deductibleShare: number };
  qualifiedBusinessIncome: Sourced & { rate: number; minimumIncome: number; threshold: ByFilingStatus<number> };
  retirement: Sourced & {
    employeeDeferral: number;
    catchUpAge: number;
    catchUp50: number;
    superCatchUpAges: [number, number];
    catchUp60to63: number;
    ira: number;
    iraCatchUp50: number;
    rothIraPhaseOut: { single: Range; marriedJoint: Range; marriedSeparate: Range };
    iraDeductionPhaseOut: { coveredSingle: Range; coveredMarriedJoint: Range; spouseCoveredMarriedJoint: Range; marriedSeparate: Range };
    phaseOutRounding: { step: number; minimum: number; rothRatioDecimals: number };
  };
  hsa: Sourced & { selfOnly: number; family: number; catchUpAge: number; catchUp55: number };
  estimatedTax: Sourced & {
    currentYearShare: number;
    priorYearShare: number;
    priorYearShareHighIncome: number;
    highIncomeAgi: { other: number; marriedSeparate: number };
    minimumOwed: number;
    dueDates: DeadlineRule[];
  };
  deadlines: Sourced & { federalReturn: DeadlineRule };
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

/**
 * A US state's income tax, as a sub-pack of the federal one (like Scotland's of the UK's). Covers
 * residents' tax on wages; local income taxes are left out and noted.
 */
export interface UsStatePack {
  kind: "usState";
  state: UsState;
  parent: "US";
  taxYear: string;
  version: string;
  status: PackStatus;
  effective: { from: IsoDate; to: IsoDate };
  sources: string[];
  incomeTax: Sourced &
    SectionStatus & {
      /** No tax on wages (the state may tax other income; say so in notes). */
      none?: boolean;
      /** What the state starts from. */
      base?: "federalAgi" | "federalTaxableIncome" | "wages";
      /**
       * A flat rate, or brackets per filing status. A bracket's `base`, when given, is the
       * statute's tax at its start ("$4,191 plus 5.90% of the excess") and is used as written.
       */
      rate?: number;
      brackets?: ByFilingStatus<{ upTo: number | null; rate: number; base?: number }[]>;
      /** Per filing status, or the same as the federal standard deduction. */
      standardDeduction?: ByFilingStatus<number> | "federal";
      /** Extra standard deduction per filer 65 or over, by marital status (Maine). */
      agedStandardDeduction?: { married: number; unmarried: number };
      /**
       * The standard deduction fades out: lost in proportion as AGI crosses from `from` over `range`;
       * with `steps`, in that many equal steps, each started by any amount over (Rhode Island).
       */
      standardDeductionPhaseOut?: PhaseOut;
      /** A standard deduction that steps down by `reduction` per `step` (or part) of AGI over `from`, to `min` (Alabama). */
      standardDeductionSteps?: ByFilingStatus<{ from: number; step: number; reduction: number; min: number }>;
      /**
       * A sliding standard deduction: the first segment whose `upTo` covers income gives
       * `max - rate x (income - from)`, never below 0 (Wisconsin).
       */
      slidingStandardDeduction?: ByFilingStatus<{ upTo: number | null; max: number; from: number; rate: number }[]>;
      exemption?: {
        perFiler: number;
        perDependent: number;
        /** Extra for each filer aged 65 or over. */
        perAged?: number;
        /** A further amount per filer 65 or over when AGI is below `below` (Indiana). */
        agedLowIncome?: { extra: number; below: ByFilingStatus<number> };
        /** A set personal exemption per return by filing status, in place of perFiler per filer. */
        byStatus?: ByFilingStatus<number>;
        /** The per-person amount by AGI band, in place of perFiler and perDependent (Maryland). */
        amountByAgi?: ByFilingStatus<{ upTo: number | null; amount: number }[]>;
        /** Personal (filer) exemptions fade out in proportion as AGI crosses from `from` over `range` (Maine). */
        phaseOut?: PhaseOut;
        /** The personal exemption falls by `rate` per dollar of AGI over `from` (Connecticut). */
        reduction?: { from: ByFilingStatus<number>; rate: number };
        /** Above this income (by filing status) no exemption is allowed. */
        incomeLimit?: ByFilingStatus<number>;
      };
      /**
       * A deduction per dependent child that steps down as AGI rises: `max`, less `reductionPerStep`
       * for each `step` (or part) of AGI over `from`.
       */
      childDeduction?: { max: number; reductionPerStep: number; from: ByFilingStatus<number>; step: ByFilingStatus<number> };
      /**
       * A deduction for each filer at or over `age`, reduced by `phaseOutRate` of AGI over
       * `phaseOutFrom` (Virginia's age deduction; on a joint return, reduced as one).
       */
      ageDeduction?: { perPerson: number; age: number; phaseOutFrom: ByFilingStatus<number>; phaseOutRate: number };
      /** No tax at all when AGI is below this (a filing threshold that works as a cliff). */
      noTaxBelow?: ByFilingStatus<number>;
      /**
       * A nonrefundable credit per person in the family when AGI is at or below the poverty
       * guideline for its size (`incomeLimitByFamilySize[0]` for one person), not with age 65 relief.
       */
      lowIncomeCredit?: { perPerson: number; incomeLimitByFamilySize: number[]; perExtraPerson: number };
      /**
       * Two-earner joint returns: the tax saved by taxing each spouse's share separately, up to `cap`
       * (Virginia's spouse tax adjustment).
       */
      spouseAdjustment?: { cap: number; minJointTaxable: number };
      /** A share of rent paid on the home, up to a maximum by filing status. */
      rentDeduction?: { share: number; max: ByFilingStatus<number> };
      /** Each filer deducts Social Security and Medicare paid, up to this much (Massachusetts). */
      payrollTaxDeductionMax?: number;
      /**
       * A credit of `rate` times (the federal standard deduction plus `perDependent` per dependent),
       * less `phaseOutRate` of income over `base` (Utah's taxpayer tax credit).
       */
      taxpayerCredit?: { rate: number; perDependent: number; phaseOutRate: number; base: ByFilingStatus<number> };
      /** Exemptions given as tax credits (taken off the tax, not the income). */
      exemptionCredit?: {
        perFiler: number;
        perDependent: number;
        perAged?: number;
        /** The dependent credits fall by `reductionPerStep` for each `step` (or part) of AGI over `from`. */
        dependentPhaseOut?: { from: ByFilingStatus<number>; step: number; reductionPerStep: number };
        /** Every credit falls by `reductionPerStep` for each `step` (or part) of AGI over `from` (California). */
        phaseOut?: { from: ByFilingStatus<number>; step: ByFilingStatus<number>; reductionPerStep: number };
        /** No credits above this AGI (Oregon). */
        incomeLimit?: ByFilingStatus<number>;
      };
      /** A flat credit for renters at or below an AGI limit (California). */
      renterCredit?: { amount: ByFilingStatus<number>; incomeLimit: ByFilingStatus<number> };
      /**
       * Federal income tax paid is deductible: a share of it set by AGI band (Missouri; 1 when not
       * given), up to a cap by AGI band (Oregon) or by filing status (Missouri); uncapped otherwise.
       */
      federalTaxDeduction?: {
        shareByAgi?: { upTo: number | null; share: number }[];
        capByAgi?: ByFilingStatus<{ upTo: number | null; amount: number }[]>;
        max?: ByFilingStatus<number>;
      };
      /**
       * Amounts added to the tax as AGI rises: in each segment, `amount` for each `step` begun over
       * `from`, up to `cap` (Connecticut's tables C and D).
       */
      addBacks?: ByFilingStatus<{ from: number; step: number; amount: number; cap: number }[]>;
      /** Tax is then reduced by this share, by AGI band (Connecticut's personal tax credit, table E). */
      personalCreditRateByAgi?: ByFilingStatus<{ upTo: number | null; rate: number }[]>;
      /**
       * New York's supplemental tax above an AGI: by taxable-income band, either moving the whole
       * income to a flat rate (`flatRate`) or adding `base` plus `benefit`, each phased in over `width`
       * of AGI above the band's `agiFrom` (the fraction rounded to `fractionDecimals` places).
       */
      benefitRecapture?: {
        agiAbove: number;
        width: number;
        fractionDecimals: number;
        bands: ByFilingStatus<{ upTo: number | null; agiFrom: number; flatRate?: number; base?: number; benefit?: number }[]>;
      };
      /** No tax at all when taxable income is at or below this (Ohio). */
      noTaxIfTaxableAtMost?: number;
      /** A joint return taxes each spouse's share of taxable income (by AGI) on the schedule separately (Missouri). */
      splitJointIncome?: boolean;
      /** Two-earner joint returns: `rate` of the lower earner's income, counting at most `maxIncome` (Wisconsin, South Carolina). */
      twoEarnerCredit?: { rate: number; maxIncome: number };
      /**
       * Joint returns where each spouse earns at least `minEachIncome`: a share of the tax by income
       * band (the first band whose `upTo` covers taxable income), up to `max` (Ohio).
       */
      jointFilingCredit?: { minEachIncome: number; max: number; rateByIncome: { upTo: number | null; rate: number }[] };
      /**
       * A refundable credit per dependent child, less `phaseOutRate` of AGI over `phaseOutFrom`
       * (Minnesota). It can take state tax below zero.
       */
      childCredit?: { perChild: number; phaseOutFrom: ByFilingStatus<number>; phaseOutRate: number };
      /** A flat statewide tax on wages, on top of income tax (Oregon's transit tax). */
      wageLevy?: { name: string; rate: number };
      /** Two-earner joint returns subtract the lower earner's income up to `max` (Maryland). */
      twoEarnerDeduction?: { max: number };
      notes?: string[];
    };
  /** Present when some cities or counties levy their own income tax. */
  localTax?: Sourced & { note: string };
  /**
   * Local income tax rates where the pack carries them (Indiana's counties): a rate on the same
   * taxable income as the state's. A household picks its locality.
   */
  localities?: Sourced & { kind: string; list: { id: string; name: string; rate: number }[] };
}

/** Lost in proportion as AGI crosses from `from` over `range`, or in `steps` equal steps. */
export interface PhaseOut {
  from: ByFilingStatus<number>;
  range: ByFilingStatus<number>;
  steps?: number;
}

export type SubPack = UkRegionPack | UsStatePack;
/** Any tax pack: national or a sub-pack. */
export type AnyPack = RulePack | SubPack;

/** The country a pack belongs to. */
export function parentOf(pack: AnyPack): Jurisdiction {
  return "kind" in pack ? pack.parent : pack.jurisdiction;
}

export interface ChartDefaults {
  id: string;
  version: string;
  status?: PackStatus;
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

export interface TreatyRef {
  ref: string;
  source: string;
}

/** A double taxation treaty between two countries, as references only (no figures). */
export interface TreatyPack {
  id: string;
  version: string;
  status?: "provisional" | "verified";
  source: string;
  articles: Record<"employment" | "privatePension" | "governmentService" | "interest" | "eliminationOfDoubleTax", TreatyRef> &
    Partial<Record<"socialSecurity" | "lumpSum" | "savingClause", TreatyRef>>;
  /** Ireland's relief for cross-border workers (IE-UK only). */
  transBorderRelief?: TreatyRef;
  /** How the other country treats a UK ISA. */
  isa?: TreatyRef;
  /** US passive foreign investment company rules (US treaties only). */
  pfic?: TreatyRef;
  /** What changes when someone moves to each country, keyed by destination. */
  relocation?: { source: string; toIE?: RelocationNote[]; toUK?: RelocationNote[]; toUS?: RelocationNote[] };
}

export interface RelocationNote {
  topic: string;
  text: string;
  source: string;
}

export type RulePack = IePack | UkPack | UsPack;

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
