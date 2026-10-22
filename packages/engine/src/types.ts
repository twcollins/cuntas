import type { ChartDefaults, Currency, IePack, IsoDate, Jurisdiction, RuleRef } from "@cuntas/rules";

export type Employment = "employee" | "selfEmployed" | "notWorking" | "retired";

export interface MemberState {
  id: string;
  name: string;
  age: number;
  employment: Employment;
  residence: Jurisdiction;
  grossAnnualMinor: number;
  netMonthlyMinor: number;
  marginalRate: number;
  pension: {
    hasEmployerScheme: boolean;
    /** Employee and employer contributions as a share of gross pay (0.05 = 5%). */
    employeeRate: number;
    employerRate: number;
    /** Employee rate needed to capture the full employer match; 0 when there is no match. */
    fullMatchEmployeeRate: number;
    /** Employer pays this many euro per euro matched (1 = 1:1). */
    matchRatio: number;
    personalContribYtdMinor: number;
    myFutureFund: "not-eligible-age" | "not-eligible-earnings" | "in-qualifying-scheme" | "auto-enrolled" | "opted-out";
  };
  stockMatch?: { contributedRate: number; fullMatchRate: number };
}

export interface DebtState {
  id: string;
  name: string;
  balanceMinor: number;
  /** Annual percentage rate as a decimal (0.199 = 19.9%). */
  apr: number;
  minPaymentMinor: number;
  kind: string;
}

export interface SinkingFundState {
  id: string;
  name: string;
  targetMinor: number;
  savedMinor: number;
  dueDate: IsoDate;
  monthlyContributionMinor: number;
}

export interface Thresholds {
  starterFundFloorMinor: number;
  starterFundMonths: number;
  fullFundFloorLowMinor: number;
  fullFundFloorHighMinor: number;
  fullFundMonthsLow: number;
  fullFundMonthsHigh: number;
  highAprAbove: number;
  moderateAprFrom: number;
  retirementShareOfAge: number;
  /** "netPay" follows the chart; "essentialSpend" bases the funds on 12-month essential spending. */
  fundBasis: "netPay" | "essentialSpend";
  mortgageOverpayRate: number;
}

export interface Dismissal {
  stepId: string;
  memberId?: string;
  reason: string;
}

export interface HouseholdSnapshot {
  asOf: IsoDate;
  currency: Currency;
  members: MemberState[];
  netMonthlyPayMinor: number;
  liquidSavingsMinor: number;
  essentialMonthlySpendMinor: number;
  tracking: { hasBudgetThisPeriod: boolean; transactionsLast30Days: number; uncategorisedLast30Days: number };
  waterfall: { firstShortBucket: string | null; shortfallMinor: number; buckets: number; bucketsCovered: number };
  debts: DebtState[];
  sinkingFunds: SinkingFundState[];
  housing: {
    ownsHome: boolean;
    monthlyRentMinor: number;
    monthlyDepositSavingMinor: number;
    expectedMortgagePaymentMinor: number | null;
    mortgageMonthlyPaymentMinor: number | null;
  };
  children: { count: number; collegeGoals: number; collegeFundsOnTrack: boolean };
  dismissed: Dismissal[];
  thresholds: Thresholds;
}

export interface Progress {
  current: number;
  target: number;
  unit: Currency | "months" | "%" | "count";
}

export interface ActionRef {
  id: string;
  label: string;
  to: string;
}

export interface EvalContext {
  snapshot: HouseholdSnapshot;
  member?: MemberState;
  pack: IePack;
  chart: ChartDefaults;
}

type Fn<T> = (ctx: EvalContext) => T;

export interface CheckDefinition {
  id: string;
  title: string;
  appliesWhen?: Fn<boolean>;
  isMet: Fn<boolean>;
  progress: Fn<Progress>;
  headline: string;
  explain: string;
  vars: Fn<Record<string, string | number>>;
  sources: Fn<RuleRef[]>;
  actions: ActionRef[];
  deadline?: Fn<IsoDate | undefined>;
}

export interface StepDefinition {
  id: string;
  order: number;
  title: string;
  chartRule: string;
  jurisdictions: Jurisdiction[];
  scope: "household" | "member";
  appliesWhen?: Fn<boolean>;
  alwaysOn?: boolean;
  checks: CheckDefinition[];
}

export interface NextStepCard {
  step: string;
  check: string;
  order: number;
  title: string;
  member?: string;
  memberName?: string;
  headline: string;
  why: string;
  deadline?: IsoDate;
  rulePack: string;
  chart: string;
  sources: RuleRef[];
  progress: Progress;
  jurisdictions: Jurisdiction[];
  actions: ActionRef[];
  alwaysOn: boolean;
}

export type CheckStatus = "met" | "unmet" | "not-applicable" | "dismissed";

export interface LadderRow {
  step: string;
  order: number;
  title: string;
  chartRule: string;
  jurisdictions: Jurisdiction[];
  status: "met" | "unmet" | "not-applicable";
  checks: { check: string; title: string; member?: string; memberName?: string; status: CheckStatus; progress?: Progress }[];
}

export interface OptionCard {
  id: string;
  title: string;
  detail: string;
}

export interface EngineResult {
  current: NextStepCard | null;
  alwaysOn: NextStepCard[];
  ladder: LadderRow[];
  options: OptionCard[];
  rulePack: string;
  chart: string;
  disclaimer: string;
}
