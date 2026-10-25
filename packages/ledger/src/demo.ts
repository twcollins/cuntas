import { addDays, addMonths, ageOn, applyRate, iePayslipCheck, packOn, toMinor, type Currency, type IsoDate } from "@cuntas/rules";
import { periodOf } from "./budgets";
import { createEmptyDataset, reconcile } from "./dataset";
import { newMember, type Account, type Dataset, type Transaction } from "./schema";

/** Small deterministic PRNG so the demo household is identical on every run. */
function prng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const eur = toMinor;

/**
 * A demo Irish household with a UK thread: one partner moved from Belfast with a UK pension, ISA and Monzo account.
 * All figures are invented for demonstration; FX rates are synthetic, not ECB data.
 */
export function createDemoDataset(asOf: IsoDate): Dataset {
  const rand = prng(20261022);
  const ds = createEmptyDataset("Byrne-Murphy household", "EUR", `${asOf}T09:00:00.000Z`);
  ds.household.id = "hh_demo";
  const start = addMonths(`${asOf.slice(0, 7)}-01`, -6);

  ds.household.settings = {
    ...ds.household.settings,
    paydayDayOfMonth: 25,
    monthlyRentMinor: eur(1850),
    expectedMortgagePaymentMinor: eur(1950),
    ownsHome: false,
  };

  ds.members = [
    newMember({ id: "m_aoife", name: "Aoife", dateOfBirth: "1992-03-14", nationality: ["IE"], grossAnnualMinor: eur(58000), ieContributionYears: 12 }),
    newMember({ id: "m_sean", name: "Seán", dateOfBirth: "1989-07-02", nationality: ["UK", "IE"], grossAnnualMinor: eur(44000), ieContributionYears: 4, ukQualifyingYears: 10, studentLoans: ["plan1"] }),
  ];
  ds.residencePeriods = [
    { id: "rp_aoife", memberId: "m_aoife", jurisdiction: "IE", from: "1992-03-14", to: null, declaredBy: "user" },
    { id: "rp_sean_uk", memberId: "m_sean", jurisdiction: "UK", from: "2011-09-01", to: "2021-12-31", declaredBy: "user" },
    { id: "rp_sean_ie", memberId: "m_sean", jurisdiction: "IE", from: "2022-01-01", to: null, declaredBy: "user" },
  ];
  ds.institutions = [
    { id: "inst_aib", name: "AIB", country: "IE" },
    { id: "inst_revolut", name: "Revolut", country: "IE" },
    { id: "inst_cu", name: "Credit union", country: "IE" },
    { id: "inst_monzo", name: "Monzo", country: "UK" },
    { id: "inst_boi", name: "Bank of Ireland", country: "IE" },
  ];

  const acc = (a: Partial<Account> & Pick<Account, "id" | "name" | "type" | "currency" | "jurisdiction">): Account => ({
    memberIds: ["m_aoife", "m_sean"],
    institutionId: null,
    wrapper: "none",
    openingBalanceMinor: 0,
    openingDate: start,
    valuations: [],
    isEmergencyFund: false,
    archived: false,
    ...a,
  });
  ds.accounts = [
    acc({ id: "acc_aib", name: "AIB joint current", type: "current", currency: "EUR", jurisdiction: "IE", institutionId: "inst_aib", openingBalanceMinor: eur(2400) }),
    acc({ id: "acc_rev", name: "Revolut (Aoife)", type: "current", currency: "EUR", jurisdiction: "IE", institutionId: "inst_revolut", memberIds: ["m_aoife"], openingBalanceMinor: eur(310) }),
    acc({ id: "acc_cu", name: "Credit union shares", type: "savings", currency: "EUR", jurisdiction: "IE", institutionId: "inst_cu", wrapper: "CreditUnionShares", openingBalanceMinor: eur(6900), isEmergencyFund: true }),
    acc({ id: "acc_monzo", name: "Monzo (Seán)", type: "current", currency: "GBP", jurisdiction: "UK", institutionId: "inst_monzo", memberIds: ["m_sean"], openingBalanceMinor: eur(420) }),
    acc({ id: "acc_cc", name: "BOI credit card", type: "creditCard", currency: "EUR", jurisdiction: "IE", institutionId: "inst_boi", memberIds: ["m_aoife"], openingBalanceMinor: -eur(2650) }),
    acc({ id: "acc_isa", name: "Stocks and shares ISA (Seán)", type: "brokerage", currency: "GBP", jurisdiction: "UK", wrapper: "ISA", memberIds: ["m_sean"], valuations: [{ date: start, valueMinor: eur(8100) }, { date: addMonths(start, 4), valueMinor: eur(8400) }] }),
    acc({ id: "acc_car", name: "Car", type: "vehicle", currency: "EUR", jurisdiction: "IE", valuations: [{ date: start, valueMinor: eur(9500) }] }),
    acc({ id: "acc_pen_aoife", name: "Aoife workplace pension", type: "pension", currency: "EUR", jurisdiction: "IE", memberIds: ["m_aoife"], valuations: [{ date: start, valueMinor: eur(29400) }, { date: addMonths(start, 5), valueMinor: eur(31800) }] }),
    acc({ id: "acc_pen_sean_uk", name: "Seán UK workplace pension", type: "pension", currency: "GBP", jurisdiction: "UK", memberIds: ["m_sean"], valuations: [{ date: start, valueMinor: eur(14200) }] }),
  ];

  ds.debts = [
    { id: "debt_cc", name: "BOI credit card", accountId: "acc_cc", kind: "creditCard", balanceMinor: eur(2650), currency: "EUR", aprBps: 2290, minPaymentMinor: eur(80), termEnd: null },
    { id: "debt_cu", name: "Credit union car loan", accountId: null, kind: "creditUnion", balanceMinor: eur(4800), currency: "EUR", aprBps: 750, minPaymentMinor: eur(180), termEnd: addMonths(asOf, 30) },
  ];
  ds.pensionPlans = [
    { id: "pp_aoife", memberId: "m_aoife", name: "Workplace DC scheme", kind: "occupationalDC", jurisdiction: "IE", currency: "EUR", valueMinor: eur(31800), employeeRate: 0.03, employerRate: 0.03, employerMatchRule: { upToRate: 0.06, ratio: 1 }, isEmployerScheme: true },
    { id: "pp_sean_mff", memberId: "m_sean", name: "MyFutureFund", kind: "MyFutureFund", jurisdiction: "IE", currency: "EUR", valueMinor: eur(560), employeeRate: 0, employerRate: 0, employerMatchRule: null, isEmployerScheme: false },
    { id: "pp_sean_uk", memberId: "m_sean", name: "Former employer pension (Belfast)", kind: "ukWorkplaceDC", jurisdiction: "UK", currency: "GBP", valueMinor: eur(14200), employeeRate: 0, employerRate: 0, employerMatchRule: null, isEmployerScheme: false },
  ];
  ds.holdings = [
    {
      id: "h_isa_global",
      accountId: "acc_isa",
      instrument: "IE0000DEMO01",
      name: "Global equity ETF (demo, Irish-domiciled)",
      taxClass: "exitTaxFund",
      unitPriceMinor: eur(140),
      currency: "GBP",
      lots: [
        { id: "lot1", date: "2019-06-10", units: 40, costMinor: eur(3000), currency: "GBP" },
        { id: "lot2", date: "2021-03-02", units: 20, costMinor: eur(1900), currency: "GBP" },
      ],
    },
  ];
  ds.goals = [
    { id: "g_ef", name: "Emergency fund", type: "emergencyFund", targetMinor: eur(19800), currency: "EUR", targetDate: null, linkedAccountIds: ["acc_cu"], savedMinor: 0, monthlyContributionMinor: eur(150) },
    { id: "g_car", name: "Replacement car for work", type: "sinkingFund", targetMinor: eur(6000), currency: "EUR", targetDate: addMonths(asOf, 14), linkedAccountIds: [], savedMinor: eur(1200), monthlyContributionMinor: eur(250) },
    { id: "g_house", name: "House deposit", type: "houseDeposit", targetMinor: eur(45000), currency: "EUR", targetDate: addMonths(asOf, 36), linkedAccountIds: [], savedMinor: eur(11500), monthlyContributionMinor: eur(400) },
  ];

  // FX: synthetic weekday EUR/GBP and EUR/USD rates, labelled as such.
  for (let d = addDays(start, -7), i = 0; d <= asOf; d = addDays(d, 1), i++) {
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    ds.fxRates.push({ date: d, base: "EUR", quote: "GBP", rate: Number((0.855 + 0.008 * Math.sin(i / 23)).toFixed(4)), source: "demo-synthetic" });
    ds.fxRates.push({ date: d, base: "EUR", quote: "USD", rate: Number((1.16 + 0.015 * Math.sin(i / 19)).toFixed(4)), source: "demo-synthetic" });
  }
  const gbpPerEur = (d: IsoDate) => [...ds.fxRates].reverse().find((r) => r.quote === "GBP" && r.date <= d)?.rate ?? 0.855;

  let n = 0;
  const tx = (accountId: string, bookedAt: IsoDate, amountMinor: number, payee: string, currency: Currency = "EUR"): Transaction => ({
    id: `tx_demo_${++n}`,
    accountId,
    bookedAt,
    amountMinor,
    currency,
    fxRateToBase: currency === "GBP" ? Number((1 / gbpPerEur(bookedAt)).toFixed(6)) : null,
    payee,
    rawDescription: payee.toUpperCase(),
    externalId: `demo:${n}`,
    categoryId: null,
    categorySource: "none",
    transferPairId: null,
    splits: [],
    notes: "",
  });
  const amt = (lo: number, hi: number) => Math.round((lo + rand() * (hi - lo)) * 100);
  const out: Transaction[] = [];

  for (let m = 0; m <= 6; m++) {
    const month = addMonths(start, m).slice(0, 7);
    const day = (d: number) => `${month}-${String(d).padStart(2, "0")}`;
    const push = (t: Transaction) => {
      if (t.bookedAt <= asOf) out.push(t);
    };
    push(tx("acc_aib", day(1), -eur(1850), "Rent M Kelly"));
    push(tx("acc_aib", day(4), -eur(55), "Virgin Media"));
    push(tx("acc_aib", day(10), -amt(120, 175), "Electric Ireland"));
    push(tx("acc_aib", day(15), -eur(124), "VHI Healthcare"));
    push(tx("acc_aib", day(18), -eur(180), "Credit Union Loan Repayment"));
    push(tx("acc_aib", day(25), eur(3720), "Salary Acme Technology Ltd"));
    push(tx("acc_aib", day(25), eur(2960), "Payroll Brightwater Ltd"));
    for (const d of [3, 10, 17, 24]) push(tx("acc_aib", day(d), -amt(55, 140), ["Tesco", "Lidl", "Dunnes Stores", "SuperValu"][Math.floor(rand() * 4)]!));
    for (const d of [6, 20]) push(tx("acc_aib", day(d), -amt(55, 70), "Circle K"));
    push(tx("acc_aib", day(9), -eur(30), "Leap Card Top-up"));

    // Internal transfers: to Revolut, to credit union savings, credit card repayment.
    push(tx("acc_aib", day(26), -eur(400), "To Revolut"));
    push(tx("acc_rev", day(26), eur(400), "Top-up from AIB"));
    push(tx("acc_aib", day(26), -eur(150), "To credit union"));
    push(tx("acc_cu", day(26), eur(150), "Lodgement"));
    push(tx("acc_aib", day(21), -eur(300), "BOI card payment"));
    push(tx("acc_cc", day(21), eur(300), "Payment received"));

    push(tx("acc_rev", day(8), -eur(25), "Three Ireland"));
    push(tx("acc_rev", day(12), -eur(1499) / 100, "Netflix"));
    // A price rise in the last two months, for recurring-bill detection to spot.
    push(tx("acc_rev", day(12), -eur(m >= 5 ? 1999 : 1799) / 100, "Spotify"));
    for (const d of [2, 9, 16, 23]) push(tx("acc_rev", day(d), -eur(420) / 100, "Insomnia Coffee"));
    push(tx("acc_rev", day(14), -amt(22, 45), "Deliveroo"));
    push(tx("acc_rev", day(19), -amt(15, 40), "PayPal *Marketplace"));

    // EUR to GBP: Revolut out, Monzo in at roughly the ECB rate less a small spread.
    const eurOut = eur(200);
    push(tx("acc_rev", day(3), -eurOut, "Exchanged to GBP"));
    push(tx("acc_monzo", day(3), Math.round(eurOut * gbpPerEur(day(3)) * 0.995), "Revolut transfer", "GBP"));
    push(tx("acc_monzo", day(5), -eur(10), "giffgaff", "GBP"));
    push(tx("acc_monzo", day(22), -amt(30, 60), "Sainsbury's", "GBP"));

    push(tx("acc_cc", day(7), -amt(30, 90), "Amazon"));
    push(tx("acc_cc", day(13), -amt(25, 70), "Penneys"));
    push(tx("acc_cc", day(28), -amt(40, 80), "Omniplex Cinema"));
  }
  ds.transactions = out;

  // Budgets for this and last pay period.
  const period = periodOf(asOf, 25);
  const lines = [
    ["cat_rent", 1850], ["cat_groceries", 420], ["cat_energy", 160], ["cat_health_insurance", 124],
    ["cat_commute", 160], ["cat_phone_internet", 90], ["cat_debt_payments", 180], ["cat_tv_subs", 35],
    ["cat_eating_out", 90], ["cat_shopping", 150], ["cat_entertainment", 60],
  ] as const;
  for (const p of [addMonths(`${period}-01`, -1).slice(0, 7), period]) {
    ds.budgets.push({ id: `b_${p}`, period: p, mode: "envelope", lines: lines.map(([categoryId, a]) => ({ categoryId, amountMinor: eur(a), rollover: true })) });
  }
  ds.categoryRules = [{ id: "rule_rent", match: { payeeContains: "rent m kelly" }, categoryId: "cat_rent", priority: 10 }];

  ds.bills = [
    { id: "bill_motor_tax", name: "Motor tax", template: "ie-motor-tax", cadence: "annual", amountMinor: eur(280), currency: "EUR", nextDue: addMonths(asOf, 2), categoryId: "cat_car", payeeKey: null },
    { id: "bill_nct", name: "NCT", template: "ie-nct", cadence: "biennial", amountMinor: eur(55), currency: "EUR", nextDue: addDays(asOf, 20), categoryId: "cat_car", payeeKey: null },
    { id: "bill_tv", name: "TV licence", template: "ie-tv-licence", cadence: "annual", amountMinor: eur(160), currency: "EUR", nextDue: addMonths(asOf, 5), categoryId: "cat_tv_subs", payeeKey: null },
  ];
  // Aoife's latest payslip, with her tax credits not fully allocated to the job, for the payslip check to flag.
  const payDate = `${period}-25` <= asOf ? `${period}-25` : `${addMonths(`${period}-01`, -1).slice(0, 7)}-25`;
  const grossMonthly = Math.round(eur(58000) / 12);
  const pensionMonthly = applyRate(grossMonthly, 0.03);
  const expected = iePayslipCheck(packOn("IE", payDate), {
    frequency: "monthly", payDate, grossPeriodMinor: grossMonthly, incomeTaxMinor: 0, uscMinor: 0, prsiMinor: 0,
    assessment: "single", age: ageOn("1992-03-14", payDate), pensionPeriodMinor: pensionMonthly, toleranceMinor: 0,
  }).expected;
  ds.payslips = [
    { id: "ps_aoife", memberId: "m_aoife", jurisdiction: "IE", payDate, frequency: "monthly", currency: "EUR", grossMinor: grossMonthly, incomeTaxMinor: expected.incomeTaxMinor + eur(177), uscMinor: expected.uscMinor, prsiMinor: expected.prsiMinor, niMinor: 0, studentLoanMinor: 0, taxCode: "", pensionMinor: pensionMonthly },
  ];

  return reconcile(ds);
}
