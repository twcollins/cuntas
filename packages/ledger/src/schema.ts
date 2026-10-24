import { z } from "zod";

// The household dataset. Zod schemas validate imports and API payloads; types are inferred from them.
// Money is integer minor units with an ISO currency on every money field.

const id = z.string().min(1);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const currency = z.enum(["EUR", "GBP"]);
const jurisdiction = z.enum(["IE", "UK"]);
const minor = z.number().int();

export const householdSchema = z.object({
  id,
  name: z.string(),
  baseCurrency: currency,
  createdAt: z.string(),
  settings: z.object({
    flags: z.array(z.string()).default([]),
    /** Day of month pay arrives; budget months run from this day. 1 = calendar months. */
    paydayDayOfMonth: z.number().int().min(1).max(28).default(1),
    fundBasis: z.enum(["netPay", "essentialSpend"]).default("netPay"),
    thresholdOverrides: z.record(z.number()).default({}),
    ownsHome: z.boolean().default(false),
    monthlyRentMinor: minor.default(0),
    expectedMortgagePaymentMinor: minor.nullable().default(null),
    children: z.number().int().min(0).default(0),
  }),
});

export const memberSchema = z.object({
  id,
  name: z.string(),
  dateOfBirth: isoDate,
  nationality: z.array(jurisdiction),
  employmentType: z.enum(["employee", "selfEmployed", "notWorking", "retired"]),
  grossAnnualMinor: minor.default(0),
  payFrequency: z.enum(["weekly", "fortnightly", "monthly"]).default("monthly"),
  assessment: z.enum(["single", "oneParent", "marriedOneIncome", "marriedTwoIncomes"]).default("single"),
  myFutureFundOptedOut: z.boolean().default(false),
  stockMatch: z.object({ contributedRate: z.number(), fullMatchRate: z.number() }).nullable().default(null),
  /** Scottish taxpayers pay Scottish income tax when UK resident. */
  ukRegion: z.enum(["rUK", "scotland"]).default("rUK"),
  studentLoans: z.array(z.enum(["plan1", "plan2", "plan4", "plan5", "postgraduate"])).default([]),
  /** Planned retirement age; defaults to the Irish State Pension age. */
  retirementAge: z.number().int().min(40).max(80).nullable().default(null),
  /** Social insurance years so far, for State Pension estimates. */
  ieContributionYears: z.number().int().min(0).max(60).nullable().default(null),
  ukQualifyingYears: z.number().int().min(0).max(60).nullable().default(null),
  /** Self-assessment history, for preliminary tax. */
  selfAssessment: z
    .object({
      payeIncomeMinor: minor.default(0),
      payeDeductedMinor: minor.default(0),
      priorYearLiabilityMinor: minor.nullable().default(null),
      prePrecedingYearLiabilityMinor: minor.nullable().default(null),
      preliminaryPaidMinor: minor.default(0),
    })
    .default({}),
});

export const residencePeriodSchema = z.object({
  id,
  memberId: id,
  jurisdiction,
  from: isoDate,
  to: isoDate.nullable(),
  declaredBy: z.string(),
});

export const institutionSchema = z.object({ id, name: z.string(), country: jurisdiction, bic: z.string().optional(), aggregatorRef: z.string().optional() });

export const connectionSchema = z.object({
  id,
  institutionId: id,
  provider: z.string(),
  consentExpiresAt: z.string(),
  status: z.enum(["active", "expired", "revoked", "error"]),
  externalAccountIds: z.record(id).default({}),
  lastSyncedAt: z.string().nullable().default(null),
});

export const accountTypes = ["current", "savings", "creditCard", "loan", "mortgage", "pension", "brokerage", "property", "vehicle", "cash", "other"] as const;
export const wrappers = ["none", "ISA", "LISA", "SIPP", "PRSA", "AVC", "InvestmentAccount", "StateSavings", "PrizeBonds", "CreditUnionShares"] as const;

export const accountSchema = z.object({
  id,
  name: z.string(),
  memberIds: z.array(id),
  type: z.enum(accountTypes),
  currency,
  institutionId: id.nullable().default(null),
  wrapper: z.enum(wrappers).default("none"),
  jurisdiction,
  openingBalanceMinor: minor.default(0),
  openingDate: isoDate,
  /** For manually valued assets (property, vehicles, pensions): the latest valuation. */
  valuations: z.array(z.object({ date: isoDate, valueMinor: minor })).default([]),
  isEmergencyFund: z.boolean().default(false),
  archived: z.boolean().default(false),
});

export const transactionSchema = z.object({
  id,
  accountId: id,
  bookedAt: isoDate,
  amountMinor: minor,
  currency,
  /** Units of base currency per unit of transaction currency on the booking date. */
  fxRateToBase: z.number().nullable().default(null),
  payee: z.string(),
  rawDescription: z.string(),
  externalId: z.string(),
  categoryId: id.nullable().default(null),
  categorySource: z.enum(["user", "rule", "dictionary", "none"]).default("none"),
  transferPairId: id.nullable().default(null),
  splits: z.array(z.object({ categoryId: id, amountMinor: minor })).default([]),
  notes: z.string().default(""),
});

export const waterfallBuckets = ["housing", "food", "essentialBills", "incomeCosts", "minimumDebt", "emergencyFund", "nonEssentialBills"] as const;

export const categorySchema = z.object({
  id,
  name: z.string(),
  group: z.string(),
  isEssential: z.boolean(),
  kind: z.enum(["expense", "income", "transfer"]).default("expense"),
  waterfall: z.enum(waterfallBuckets).nullable().default(null),
});

export const categoryRuleSchema = z.object({
  id,
  match: z.object({
    payeeContains: z.string().optional(),
    regex: z.string().optional(),
    minMinor: minor.optional(),
    maxMinor: minor.optional(),
    accountId: id.optional(),
  }),
  categoryId: id,
  priority: z.number().int().default(0),
});

export const budgetSchema = z.object({
  id,
  /** Period key YYYY-MM; with a payday, the period starts on the payday in that month. */
  period: z.string().regex(/^\d{4}-\d{2}$/),
  mode: z.enum(["envelope", "cap"]),
  lines: z.array(z.object({ categoryId: id, amountMinor: minor, rollover: z.boolean().default(true) })),
});

export const goalSchema = z.object({
  id,
  name: z.string(),
  type: z.enum(["emergencyFund", "houseDeposit", "sinkingFund", "college", "taxSetAside", "other"]),
  targetMinor: minor,
  currency,
  targetDate: isoDate.nullable().default(null),
  linkedAccountIds: z.array(id).default([]),
  /** Saved amount for goals not linked to an account. */
  savedMinor: minor.default(0),
  monthlyContributionMinor: minor.default(0),
});

export const debtSchema = z.object({
  id,
  name: z.string(),
  accountId: id.nullable().default(null),
  kind: z.enum(["creditCard", "loan", "creditUnion", "bnpl", "pcp", "overdraft", "studentLoan", "mortgage", "other"]),
  balanceMinor: minor,
  currency,
  aprBps: z.number().int().min(0),
  minPaymentMinor: minor,
  termEnd: isoDate.nullable().default(null),
});

export const pensionKinds = ["occupationalDC", "occupationalDB", "PRSA", "AVC", "MyFutureFund", "ARF", "ukWorkplaceDC", "ukWorkplaceDB", "SIPP", "statePensionIE", "statePensionUK"] as const;

export const pensionPlanSchema = z.object({
  id,
  memberId: id,
  name: z.string(),
  kind: z.enum(pensionKinds),
  jurisdiction,
  currency,
  valueMinor: minor.default(0),
  /** Contribution rates as a share of gross pay. */
  employeeRate: z.number().min(0).max(1).default(0),
  employerRate: z.number().min(0).max(1).default(0),
  /** Employer matches employee contributions up to this rate of pay, at this ratio. */
  employerMatchRule: z.object({ upToRate: z.number(), ratio: z.number() }).nullable().default(null),
  isEmployerScheme: z.boolean().default(false),
});

export const contributionSchema = z.object({
  id,
  pensionPlanId: id,
  date: isoDate,
  employeeMinor: minor,
  employerMinor: minor,
  stateMinor: minor.default(0),
  reliefClaimed: z.boolean().default(false),
});

export const holdingSchema = z.object({
  id,
  accountId: id,
  instrument: z.string(),
  name: z.string(),
  taxClass: z.enum(["exitTaxFund", "cgtAsset", "wrapperExempt"]),
  unitPriceMinor: minor,
  currency,
  lots: z.array(z.object({ id, date: isoDate, units: z.number(), costMinor: minor, currency })),
});

export const fxRateSchema = z.object({ date: isoDate, base: z.literal("EUR"), quote: z.literal("GBP"), rate: z.number().positive(), source: z.string() });

export const stepStateSchema = z.object({
  id,
  memberId: id.nullable(),
  stepId: z.string(),
  status: z.enum(["dismissed", "met", "unmet"]),
  dismissedReason: z.string().nullable().default(null),
  evaluatedAt: z.string(),
});

export const payslipSchema = z.object({
  id,
  memberId: id,
  jurisdiction,
  payDate: isoDate,
  frequency: z.enum(["weekly", "fortnightly", "monthly"]),
  currency,
  grossMinor: minor,
  incomeTaxMinor: minor,
  /** IE only. */
  uscMinor: minor.default(0),
  prsiMinor: minor.default(0),
  /** UK only. */
  niMinor: minor.default(0),
  studentLoanMinor: minor.default(0),
  taxCode: z.string().default(""),
  pensionMinor: minor.default(0),
});

export const billCadences = ["weekly", "fortnightly", "monthly", "quarterly", "annual", "biennial"] as const;

export const billSchema = z.object({
  id,
  name: z.string(),
  /** Template id from BILL_TEMPLATES, or null for a bill added from detection or by hand. */
  template: z.string().nullable().default(null),
  cadence: z.enum(billCadences),
  amountMinor: minor,
  currency,
  nextDue: isoDate,
  categoryId: id.nullable().default(null),
  /** Links a confirmed bill to a detected recurring payee. */
  payeeKey: z.string().nullable().default(null),
});

export const auditEventSchema = z.object({ id, actor: z.string(), action: z.string(), entity: z.string(), at: z.string() });

export const SCHEMA_VERSION = 1;

export const datasetSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  household: householdSchema,
  members: z.array(memberSchema),
  residencePeriods: z.array(residencePeriodSchema),
  institutions: z.array(institutionSchema),
  connections: z.array(connectionSchema),
  accounts: z.array(accountSchema),
  transactions: z.array(transactionSchema),
  categories: z.array(categorySchema),
  categoryRules: z.array(categoryRuleSchema),
  budgets: z.array(budgetSchema),
  goals: z.array(goalSchema),
  debts: z.array(debtSchema),
  pensionPlans: z.array(pensionPlanSchema),
  contributions: z.array(contributionSchema),
  holdings: z.array(holdingSchema),
  fxRates: z.array(fxRateSchema),
  stepStates: z.array(stepStateSchema),
  auditEvents: z.array(auditEventSchema),
  payslips: z.array(payslipSchema).default([]),
  bills: z.array(billSchema).default([]),
  /** Detected recurring payees the user said are not bills. */
  recurringDismissed: z.array(z.string()).default([]),
});

export type Household = z.infer<typeof householdSchema>;
export type Member = z.infer<typeof memberSchema>;
export type ResidencePeriod = z.infer<typeof residencePeriodSchema>;
export type Institution = z.infer<typeof institutionSchema>;
export type Connection = z.infer<typeof connectionSchema>;
export type Account = z.infer<typeof accountSchema>;
export type AccountType = Account["type"];
export type Transaction = z.infer<typeof transactionSchema>;
export type Category = z.infer<typeof categorySchema>;
export type CategoryRule = z.infer<typeof categoryRuleSchema>;
export type Budget = z.infer<typeof budgetSchema>;
export type Goal = z.infer<typeof goalSchema>;
export type Debt = z.infer<typeof debtSchema>;
export type PensionPlan = z.infer<typeof pensionPlanSchema>;
export type Contribution = z.infer<typeof contributionSchema>;
export type Holding = z.infer<typeof holdingSchema>;
export type FxRate = z.infer<typeof fxRateSchema>;
export type StepState = z.infer<typeof stepStateSchema>;
export type AuditEvent = z.infer<typeof auditEventSchema>;
export type Payslip = z.infer<typeof payslipSchema>;
export type Bill = z.infer<typeof billSchema>;
export type BillCadence = Bill["cadence"];
export type Dataset = z.infer<typeof datasetSchema>;
export type WaterfallBucket = (typeof waterfallBuckets)[number];

export const LIABILITY_TYPES: readonly AccountType[] = ["creditCard", "loan", "mortgage"];
export const LIQUID_TYPES: readonly AccountType[] = ["current", "savings", "cash"];

/** A member with every optional field at its default. */
export function newMember(fields: Pick<Member, "id" | "name" | "dateOfBirth"> & Partial<Member>): Member {
  return memberSchema.parse({ nationality: ["IE"], employmentType: "employee", ...fields });
}
