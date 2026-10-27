import type { ChartDefaults, Currency, IePack, IsoDate, Jurisdiction, RulePack, RuleRef, UsFilingStatus } from "@cuntas/rules";

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
  /** US members only. Amounts are in US dollars (minor units), since US limits are. */
  us?: UsMemberState;
}

export interface UsMemberState {
  filingStatus: UsFilingStatus;
  grossAnnualMinor: number;
  /** Modified AGI for IRA purposes: the return's, so both spouses' on a joint return. */
  magiMinor: number;
  coveredByWorkplacePlan: boolean;
  spouseCoveredByWorkplacePlan: boolean;
  /** 401(k) deferrals a year at the current rate. */
  employeeDeferralMinor: number;
  iraContribYtdMinor: number;
  hsaCoverage: "selfOnly" | "family" | null;
  hsaContribYtdMinor: number;
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
  /** Which ladder applies: the US one when everyone in the household lives in the US. */
  plan: "IE" | "US";
  currency: Currency;
  members: MemberState[];
  netMonthlyPayMinor: number;
  liquidSavingsMinor: number;
  essentialMonthlySpendMinor: number;
  tracking: { hasBudgetThisPeriod: boolean; transactionsLast60Days: number; uncategorisedLast60Days: number };
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
  /** Present when a member is self-employed: income tax, USC and PRSI to save each month. */
  selfEmployedTax?: { monthlySetAsideMinor: number; plannedMonthlyMinor: number; nextDeadline: IsoDate };
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

export interface EvalContext<P extends RulePack = IePack> {
  snapshot: HouseholdSnapshot;
  member?: MemberState;
  pack: P;
  chart: ChartDefaults;
}

type Fn<T, P extends RulePack> = (ctx: EvalContext<P>) => T;

export interface CheckDefinition<P extends RulePack = IePack> {
  id: string;
  title: string;
  appliesWhen?: Fn<boolean, P>;
  isMet: Fn<boolean, P>;
  progress: Fn<Progress, P>;
  headline: string;
  explain: string;
  vars: Fn<Record<string, string | number>, P>;
  sources: Fn<RuleRef[], P>;
  actions: ActionRef[];
  deadline?: Fn<IsoDate | undefined, P>;
}

export interface StepDefinition<P extends RulePack = IePack> {
  id: string;
  order: number;
  title: string;
  chartRule: string;
  jurisdictions: Jurisdiction[];
  scope: "household" | "member";
  appliesWhen?: Fn<boolean, P>;
  alwaysOn?: boolean;
  checks: CheckDefinition<P>[];
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
