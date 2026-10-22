import { chartDefaults, toMinor } from "@cuntas/rules";
import { defaultThresholds, type HouseholdSnapshot, type MemberState } from "../src";

export function member(over: Partial<MemberState> = {}): MemberState {
  return {
    id: "member-1",
    name: "Aoife",
    age: 34,
    employment: "employee",
    residence: "IE",
    grossAnnualMinor: toMinor(50000),
    netMonthlyMinor: toMinor(3200),
    marginalRate: 0.4,
    pension: {
      hasEmployerScheme: true,
      employeeRate: 0.05,
      employerRate: 0.05,
      fullMatchEmployeeRate: 0.05,
      matchRatio: 1,
      personalContribYtdMinor: 0,
      myFutureFund: "in-qualifying-scheme",
    },
    ...over,
  };
}

/** A household that meets every step. Tests break one thing at a time. */
export function snapshot(over: Partial<HouseholdSnapshot> = {}): HouseholdSnapshot {
  return {
    asOf: "2026-10-22",
    currency: "EUR",
    members: [member({ pension: { ...member().pension, employeeRate: 0.1, employerRate: 0.08, fullMatchEmployeeRate: 0.05 } })],
    netMonthlyPayMinor: toMinor(3200),
    liquidSavingsMinor: toMinor(20000),
    essentialMonthlySpendMinor: toMinor(1800),
    tracking: { hasBudgetThisPeriod: true, transactionsLast30Days: 40, uncategorisedLast30Days: 0 },
    waterfall: { firstShortBucket: null, shortfallMinor: 0, buckets: 7, bucketsCovered: 7 },
    debts: [],
    sinkingFunds: [],
    housing: { ownsHome: true, monthlyRentMinor: 0, monthlyDepositSavingMinor: 0, expectedMortgagePaymentMinor: null, mortgageMonthlyPaymentMinor: toMinor(1400) },
    children: { count: 0, collegeGoals: 0, collegeFundsOnTrack: true },
    dismissed: [],
    thresholds: defaultThresholds(chartDefaults()),
    ...over,
  };
}
