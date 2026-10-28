import { z } from "zod";
import { LineCounter, parseDocument, isNode, type Document } from "yaml";
import { COUNTRY_INFO } from "../countries";
import { TAX_JURISDICTIONS, type AnyPack, type Jurisdiction } from "./types";
import { packKey } from "./registry";
import { isUsState } from "../usStates";
import { isTaxYear, taxYearRange } from "./years";

// The shape of a tax rule pack. Built-in packs are checked against it in the tests, and rule files
// loaded on a device must pass it before they are used. Figures are major units; rates are decimals.

const source = z
  .string({ required_error: "Every section needs a source link" })
  .url("Source must be a link")
  .refine((s) => s.startsWith("https://"), "Source must be an https:// link");
const status = z.enum(["provisional", "verified"]);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2027-01-01");
const rate = z.number().min(0, "Rates can't be negative").max(1, "Rates are decimals between 0 and 1, e.g. 0.2 for 20%");
const amount = z.number().nonnegative("Amounts can't be negative");
const share = z.number().nonnegative();
const count = z.number().int().nonnegative();
const deadline = z.object({ monthDay: z.string().regex(/^\d{2}-\d{2}$/, "Use month-day, like 10-31"), yearOffset: z.number().int() }).strict();

/** A section of figures with its own source and, inside a verified pack, an optional status of its own. */
const section = <T extends z.ZodRawShape>(shape: T) => z.object({ source, status: status.optional(), ...shape }).strict();

/** Entries that take effect on a date, earliest first. */
const dated = <T extends z.ZodRawShape>(shape: T) =>
  z
    .array(z.object({ from: isoDate, ...shape }).strict())
    .min(1)
    .superRefine((entries, ctx) => {
      const list = entries as { from: string }[];
      list.forEach((e, i) => {
        if (i > 0 && e.from <= list[i - 1]!.from) ctx.addIssue({ code: "custom", path: [i, "from"], message: "Dates must be in rising order" });
      });
    });

/** Tax bands: limits in rising order, with no limit (null) on the top band. */
const bands = <T extends z.ZodRawShape>(shape: T) =>
  z
    .array(z.object({ upTo: amount.nullable(), rate, ...shape }).strict())
    .min(1)
    .superRefine((entries, ctx) => {
      const list = entries as { upTo: number | null }[];
      list.forEach((b, i) => {
        const last = i === list.length - 1;
        if (last && b.upTo !== null) ctx.addIssue({ code: "custom", path: [i, "upTo"], message: "The top band has no limit: use upTo: null" });
        if (!last && b.upTo === null) ctx.addIssue({ code: "custom", path: [i, "upTo"], message: "Only the top band can have no limit" });
        const prev = list[i - 1]?.upTo;
        if (i > 0 && b.upTo !== null && prev !== null && prev !== undefined && b.upTo <= prev) {
          ctx.addIssue({ code: "custom", path: [i, "upTo"], message: "Band limits must be in rising order" });
        }
      });
    });

const meta = {
  taxYear: z.string(),
  version: z.string().min(1),
  status,
  effective: z.object({ from: isoDate, to: isoDate }).strict(),
  sources: z.array(source).min(1),
};

const iePack = z
  .object({
    ...meta,
    jurisdiction: z.literal("IE"),
    currency: z.literal("EUR"),
    incomeTax: section({
      standardRateBand: z.object({ single: amount, marriedOneIncome: amount, marriedTwoIncomesMax: amount, oneParent: amount }).strict(),
      rates: z.object({ standard: rate, higher: rate }).strict(),
      credits: z
        .object({ personalSingle: amount, personalMarried: amount, employee: amount, earnedIncome: amount, rentSingleMax: amount, rentCoupleMax: amount, rentRate: rate })
        .strict(),
    }),
    usc: section({
      exemptionThreshold: amount,
      bands: bands({}),
      selfEmployedSurcharge: z.object({ above: amount, rate }).strict(),
    }),
    prsi: section({
      classA1: dated({ rate }),
      weeklyExemptionThreshold: amount,
      credit: z.object({ upperWeeklyThreshold: amount, maxWeekly: amount, taperDivisor: z.number().positive() }).strict(),
      classS: section({ rates: dated({ rate }), incomeThreshold: amount, minimumContribution: amount }).optional(),
    }),
    pension: section({
      earningsCap: amount,
      ageBands: z
        .array(z.object({ minAge: count, rate }).strict())
        .min(1)
        .superRefine((list, ctx) => {
          list.forEach((b, i) => {
            if (i > 0 && b.minAge <= list[i - 1]!.minAge) ctx.addIssue({ code: "custom", path: [i, "minAge"], message: "Ages must be in rising order" });
          });
        }),
      reliefClaimDeadline: deadline,
      statePensionAge: count,
      lumpSum: section({ share: rate, taxFreeMax: amount, standardRateTop: amount }).optional(),
    }),
    myFutureFund: section({
      from: isoDate,
      eligibility: z.object({ minAge: count, maxAge: count, minEarnings: amount }).strict(),
      earningsCap: amount,
      rates: z.object({ employee: rate, employer: rate, state: rate }).strict(),
    }),
    cgt: section({
      rates: dated({ rate }),
      developmentLandRate: rate,
      annualExemption: amount,
      payment: z.array(z.object({ disposalsThroughMonth: z.number().int().min(1).max(12), dueMonthDay: z.string().regex(/^\d{2}-\d{2}$/), yearOffset: z.number().int() }).strict()).min(1),
    }),
    exitTax: section({ rates: dated({ rate }), deemedDisposalYears: count, paymentDeadline: deadline }),
    dirt: section({ rate }),
    cat: section({ rate, thresholds: dated({ groupA: amount, groupB: amount, groupC: amount }) }),
    investmentAccount: section({
      featureFlag: z.string().min(1),
      from: isoDate,
      annualContributionLimit: amount,
      taxFreeValue: amount,
      annualChargeRate: rate,
    }).optional(),
    helpToBuy: section({ maxRelief: amount, priceRate: rate, lookbackYears: count }),
    minimumWage: section({ hourly: amount }).optional(),
    deadlines: section({ form11: deadline }),
    statePension: section({ maxWeeklyContributory: amount, contributionYearsForMax: count, minimumContributionYears: count }).optional(),
    selfAssessment: section({
      preliminaryTax: z.object({ currentYearShare: share, priorYearShare: share, prePrecedingYearShare: share }).strict(),
      preliminaryDue: deadline,
    }).optional(),
  })
  .strict();

const plan = z.object({ threshold: amount, rate }).strict();
const ukPack = z
  .object({
    ...meta,
    jurisdiction: z.literal("UK"),
    currency: z.literal("GBP"),
    incomeTax: section({
      personalAllowance: amount,
      taper: z.object({ above: amount, divisor: z.number().positive() }).strict(),
      bands: bands({}),
    }),
    nationalInsurance: section({ primaryThreshold: amount, upperEarningsLimit: amount, mainRate: rate, upperRate: rate }),
    isa: section({
      annualAllowance: amount,
      lifetimeIsaLimit: amount,
      juniorIsaLimit: amount,
      cashCap: z.object({ limit: amount, appliesUnderAge: count }).strict().optional(),
      cashInStocksIsaInterestCharge: rate.optional(),
      stocksToCashTransferBlockedUnderAge: count.optional(),
    }),
    savings: section({
      rates: z.object({ basic: rate, higher: rate, additional: rate }).strict(),
      personalSavingsAllowance: z.object({ basic: amount, higher: amount, additional: amount }).strict(),
    }),
    dividends: section({ allowance: amount, rates: z.object({ basic: rate, higher: rate, additional: rate }).strict() }).optional(),
    statePension: section({ fullWeekly: amount, qualifyingYearsForFull: count, minimumQualifyingYears: count, pensionAge: count.optional() }).optional(),
    niVoluntary: section({ class2AbroadAbolishedFrom: isoDate, class3AnnualCost: amount, abroadMinimumYearsUkLink: count }).optional(),
    pensionsIht: section({ unusedPensionsInEstateFrom: isoDate }).optional(),
    deadlines: section({ selfAssessmentOnline: deadline }),
    studentLoans: section({ plans: z.object({ plan1: plan, plan2: plan, plan4: plan, plan5: plan, postgraduate: plan }).strict() }).optional(),
    cgt: section({ annualExemptAmount: amount, rates: z.object({ basic: rate, higher: rate }).strict() }).optional(),
    pensionAnnualAllowance: section({
      annualAllowance: amount,
      taper: z.object({ thresholdIncome: amount, adjustedIncome: amount, divisor: z.number().positive(), minimum: amount }).strict(),
      moneyPurchaseAnnualAllowance: amount,
      carryForwardYears: count,
      noEarningsReliefLimit: amount,
    }).optional(),
    pensionLumpSum: section({ share: rate, lumpSumAllowance: amount }).optional(),
  })
  .strict();

const byStatus = <T extends z.ZodTypeAny>(t: T) => z.object({ single: t, marriedJoint: t, marriedSeparate: t, headOfHousehold: t }).strict();
/** An income range [from, to] over which something phases out. */
const range = z.tuple([amount, amount]).refine(([from, to]) => to > from, "The range must end above where it starts");

/** A rate the law states as a fraction, [numerator, denominator]: 5/9 of 1% is [5, 9] percent. */
const fraction = z.tuple([count, z.number().int().positive()]);
const assetThreshold = z.object({ yearEnd: amount, anyTime: amount }).strict();

const usPack = z
  .object({
    ...meta,
    jurisdiction: z.literal("US"),
    currency: z.literal("USD"),
    incomeTax: section({ brackets: byStatus(bands({})) }),
    standardDeduction: section({
      single: amount,
      marriedJoint: amount,
      marriedSeparate: amount,
      headOfHousehold: amount,
      additionalAged: z.object({ age: count, married: amount, unmarried: amount }).strict(),
    }),
    seniorDeduction: section({ perPerson: amount, age: count, phaseOut: z.object({ single: amount, marriedJoint: amount, rate }).strict() }).optional(),
    childTaxCredit: section({
      perChild: amount,
      underAge: count,
      phaseOut: z.object({ marriedJoint: amount, other: amount, step: z.number().positive(), reductionPerStep: amount }).strict(),
      refundable: z.object({ perChild: amount, earnedIncomeFloor: amount, rate }).strict(),
    }),
    fica: section({
      socialSecurityRate: rate,
      socialSecurityWageBase: amount,
      medicareRate: rate,
      additionalMedicare: section({ rate, thresholds: byStatus(amount) }),
    }),
    selfEmployment: section({ earningsFactor: rate, socialSecurityRate: rate, medicareRate: rate, deductibleShare: rate }),
    qualifiedBusinessIncome: section({ rate, minimumIncome: amount, threshold: byStatus(amount) }),
    retirement: section({
      employeeDeferral: amount,
      catchUpAge: count,
      catchUp50: amount,
      superCatchUpAges: z.tuple([count, count]),
      catchUp60to63: amount,
      ira: amount,
      iraCatchUp50: amount,
      rothIraPhaseOut: z.object({ single: range, marriedJoint: range, marriedSeparate: range }).strict(),
      iraDeductionPhaseOut: z.object({ coveredSingle: range, coveredMarriedJoint: range, spouseCoveredMarriedJoint: range, marriedSeparate: range }).strict(),
      phaseOutRounding: z.object({ step: z.number().positive(), minimum: amount, rothRatioDecimals: count }).strict(),
    }),
    hsa: section({ selfOnly: amount, family: amount, catchUpAge: count, catchUp55: amount }),
    estimatedTax: section({
      currentYearShare: rate,
      priorYearShare: z.number().positive(),
      priorYearShareHighIncome: z.number().positive(),
      highIncomeAgi: z.object({ other: amount, marriedSeparate: amount }).strict(),
      minimumOwed: amount,
      dueDates: z.array(deadline).min(1),
    }),
    socialSecurity: section({
      bendPoints: z.tuple([amount, amount]).refine(([a, b]) => b > a, "The second bend point is above the first"),
      factors: z.tuple([rate, rate, rate]),
      computationYears: count,
      minimumCredits: count,
      creditsPerYear: z.number().int().positive(),
      claimAges: z.tuple([count, count]).refine(([a, b]) => b > a, "The latest claiming age is above the earliest"),
      rounding: z.object({ aime: z.number().positive(), pia: z.number().positive(), benefit: z.number().positive() }).strict(),
      fullRetirementAge: section({
        byBirthYear: z
          .array(z.object({ bornFrom: count, years: count, months: z.number().int().min(0).max(11) }).strict())
          .min(1)
          .refine((l) => l.every((e, i) => i === 0 || e.bornFrom > l[i - 1]!.bornFrom), "Birth years must rise"),
      }),
      earlyReduction: section({ firstMonths: count, firstPercentPerMonth: fraction, laterPercentPerMonth: fraction }),
      delayedCredit: section({ percentPerMonth: fraction }),
    }).optional(),
    foreignReporting: section({
      fbar: section({ threshold: amount, due: deadline, extendedDue: deadline }),
      form8938: z.object({ livingInUS: byStatus(assetThreshold), livingAbroad: byStatus(assetThreshold) }).strict(),
      returnDueAbroad: section({ due: deadline }),
      foreignEarnedIncomeExclusion: section({ amount }),
    }).optional(),
    deadlines: section({ federalReturn: deadline }),
  })
  .strict();

const ukRegionPack = z
  .object({
    ...meta,
    kind: z.literal("ukRegion"),
    region: z.literal("scotland"),
    parent: z.literal("UK"),
    incomeTax: section({ bands: bands({ name: z.string().min(1) }) }),
  })
  .strict();

const phaseOut = z.object({ from: byStatus(amount), range: byStatus(z.number().positive()), steps: count.optional() }).strict();

/** Amounts by income band: limits rising, the last open-ended. */
const bandAmounts = z
  .array(z.object({ upTo: amount.nullable(), amount }).strict())
  .min(1)
  .refine((list) => list.at(-1)!.upTo === null && list.slice(0, -1).every((b, i, a) => b.upTo !== null && (i === 0 || b.upTo > a[i - 1]!.upTo!)), "Bands rise, and only the last has no limit");

const usStatePack = z
  .object({
    ...meta,
    kind: z.literal("usState"),
    state: z.string().refine((v) => isUsState(v), "Use a two-letter state code, like CA or DC"),
    parent: z.literal("US"),
    incomeTax: section({
      none: z.boolean().optional(),
      base: z.enum(["federalAgi", "federalTaxableIncome", "wages"]).optional(),
      rate: rate.optional(),
      brackets: byStatus(bands({ base: amount.optional() })).optional(),
      standardDeduction: z.union([z.literal("federal"), byStatus(amount)]).optional(),
      agedStandardDeduction: z.object({ married: amount, unmarried: amount }).strict().optional(),
      standardDeductionPhaseOut: phaseOut.optional(),
      standardDeductionSteps: byStatus(z.object({ from: amount, step: z.number().positive(), reduction: amount, min: amount }).strict()).optional(),
      slidingStandardDeduction: byStatus(z.array(z.object({ upTo: amount.nullable(), max: amount, from: amount, rate }).strict()).min(1)).optional(),
      exemption: z.object({ perFiler: amount, perDependent: amount, perAged: amount.optional(), agedLowIncome: z.object({ extra: amount, below: byStatus(amount) }).strict().optional(), byStatus: byStatus(amount).optional(), amountByAgi: byStatus(bandAmounts).optional(), phaseOut: phaseOut.optional(), reduction: z.object({ from: byStatus(amount), rate: z.number().nonnegative() }).strict().optional(), incomeLimit: byStatus(amount).optional() }).strict().optional(),
      childDeduction: z.object({ max: amount, reductionPerStep: amount, from: byStatus(amount), step: byStatus(z.number().positive()) }).strict().optional(),
      payrollTaxDeductionMax: amount.optional(),
      rentDeduction: z.object({ share: rate, max: byStatus(amount) }).strict().optional(),
      ageDeduction: z.object({ perPerson: amount, age: count, phaseOutFrom: byStatus(amount), phaseOutRate: z.number().nonnegative() }).strict().optional(),
      noTaxBelow: byStatus(amount).optional(),
      lowIncomeCredit: z.object({ perPerson: amount, incomeLimitByFamilySize: z.array(amount).min(1), perExtraPerson: amount }).strict().optional(),
      spouseAdjustment: z.object({ cap: amount, minJointTaxable: amount }).strict().optional(),
      taxpayerCredit: z.object({ rate, perDependent: amount, phaseOutRate: rate, base: byStatus(amount) }).strict().optional(),
      exemptionCredit: z
        .object({ perFiler: amount, perDependent: amount, perAged: amount.optional(), dependentPhaseOut: z.object({ from: byStatus(amount), step: z.number().positive(), reductionPerStep: amount }).strict().optional(), phaseOut: z.object({ from: byStatus(amount), step: byStatus(z.number().positive()), reductionPerStep: amount }).strict().optional(), incomeLimit: byStatus(amount).optional() })
        .strict()
        .optional(),
      twoEarnerDeduction: z.object({ max: amount }).strict().optional(),
      renterCredit: z.object({ amount: byStatus(amount), incomeLimit: byStatus(amount) }).strict().optional(),
      federalTaxDeduction: z
        .object({ shareByAgi: z.array(z.object({ upTo: amount.nullable(), share: rate }).strict()).min(1).optional(), capByAgi: byStatus(bandAmounts).optional(), max: byStatus(amount).optional() })
        .strict()
        .optional(),
      addBacks: byStatus(z.array(z.object({ from: amount, step: z.number().positive(), amount, cap: amount }).strict())).optional(),
      personalCreditRateByAgi: byStatus(z.array(z.object({ upTo: amount.nullable(), rate }).strict()).min(1)).optional(),
      benefitRecapture: z
        .object({
          agiAbove: amount,
          width: z.number().positive(),
          fractionDecimals: count,
          bands: byStatus(z.array(z.object({ upTo: amount.nullable(), agiFrom: amount, flatRate: rate.optional(), base: amount.optional(), benefit: amount.optional() }).strict()).min(1)),
        })
        .strict()
        .optional(),
      noTaxIfTaxableAtMost: amount.optional(),
      splitJointIncome: z.boolean().optional(),
      twoEarnerCredit: z.object({ rate, maxIncome: amount }).strict().optional(),
      jointFilingCredit: z.object({ minEachIncome: amount, max: amount, rateByIncome: z.array(z.object({ upTo: amount.nullable(), rate }).strict()).min(1) }).strict().optional(),
      childCredit: z.object({ perChild: amount, phaseOutFrom: byStatus(amount), phaseOutRate: rate }).strict().optional(),
      wageLevy: z.object({ name: z.string().min(1), rate }).strict().optional(),
      notes: z.array(z.string().min(1)).optional(),
    }).superRefine((t, ctx) => {
      const ways = [t.none === true, t.rate !== undefined, t.brackets !== undefined].filter(Boolean).length;
      if (ways !== 1) ctx.addIssue({ code: "custom", path: [], message: "Give exactly one of: none: true, a flat rate, or brackets" });
      if (!t.none && !t.base) ctx.addIssue({ code: "custom", path: ["base"], message: "Say what the state starts from: federalAgi, federalTaxableIncome or wages" });
    }),
    localTax: section({ note: z.string().min(1) }).optional(),
    localities: section({
      kind: z.string().min(1),
      list: z
        .array(z.object({ id: z.string().min(1), name: z.string().min(1), rate }).strict())
        .min(1)
        .superRefine((list, ctx) => {
          const seen = new Set<string>();
          list.forEach((l, i) => {
            if (seen.has(l.id)) ctx.addIssue({ code: "custom", path: [i, "id"], message: `${l.id} is listed twice` });
            seen.add(l.id);
          });
        }),
    }).optional(),
  })
  .strict();

/** The tax year must be written the jurisdiction's way and match the effective dates. */
function yearMatchesDates(jurisdiction: Jurisdiction) {
  return (p: { taxYear: string; effective: { from: string; to: string } }, ctx: z.RefinementCtx) => {
    if (!isTaxYear(jurisdiction, p.taxYear)) {
      ctx.addIssue({ code: "custom", path: ["taxYear"], message: jurisdiction === "UK" ? 'Write the tax year as "2027-28"' : 'Write the tax year as "2027"' });
      return;
    }
    const range = taxYearRange(jurisdiction, p.taxYear);
    if (p.effective.from !== range.from || p.effective.to !== range.to) {
      ctx.addIssue({ code: "custom", path: ["effective"], message: `Tax year ${p.taxYear} runs from ${range.from} to ${range.to}` });
    }
  };
}

const schemas = {
  IE: iePack.superRefine(yearMatchesDates("IE")),
  UK: ukPack.superRefine(yearMatchesDates("UK")),
  US: usPack.superRefine(yearMatchesDates("US")),
  scotland: ukRegionPack.superRefine(yearMatchesDates("UK")),
  usState: usStatePack.superRefine(yearMatchesDates("US")),
};

export interface RuleFileError {
  /** 1-based line in the file, when it can be placed. */
  line: number | null;
  /** Dotted path to the figure, e.g. "usc.bands.2.rate". */
  path: string;
  message: string;
}

export type RuleFileResult =
  | { ok: true; key: string; pack: AnyPack }
  | { ok: false; errors: RuleFileError[] };

function lineOf(doc: Document, lines: LineCounter, path: (string | number)[]): number | null {
  for (let n = path.length; n >= 0; n--) {
    const node = n === 0 ? doc.contents : doc.getIn(path.slice(0, n), true);
    if (isNode(node) && node.range) return lines.linePos(node.range[0]).line;
  }
  return null;
}

/**
 * Reads a rule file (YAML) and checks it: the right shape, a source on every section, sensible
 * numbers, and a year that matches its dates. Nothing is registered here; see setLoadedPacks.
 */
export function parseRuleFile(text: string): RuleFileResult {
  const lines = new LineCounter();
  const doc = parseDocument(text, { lineCounter: lines, uniqueKeys: true });
  if (doc.errors.length > 0) {
    return { ok: false, errors: doc.errors.map((e) => ({ line: e.linePos?.[0].line ?? null, path: "", message: e.message.split("\n")[0]! })) };
  }
  const data = doc.toJS() as Record<string, unknown> | null;
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { ok: false, errors: [{ line: 1, path: "", message: "This isn't a rule pack: expected a list of named sections" }] };
  }
  const jurisdiction = TAX_JURISDICTIONS.find((j) => j === data.jurisdiction);
  const schema = data.kind === "ukRegion" ? schemas.scotland : data.kind === "usState" ? schemas.usState : jurisdiction ? schemas[jurisdiction] : null;
  if (!schema) {
    const names = TAX_JURISDICTIONS.map((j) => `${j} (${COUNTRY_INFO[j].name})`);
    const supported = `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`;
    return { ok: false, errors: [{ line: lineOf(doc, lines, ["jurisdiction"]), path: "jurisdiction", message: `Not a tax rule pack: jurisdiction must be ${supported}` }] };
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    const errors = parsed.error.issues.map((i) => {
      const message = i.code === "unrecognized_keys" ? `Unknown name: ${i.keys.join(", ")}` : i.message;
      return { line: lineOf(doc, lines, i.path), path: i.path.join("."), message };
    });
    return { ok: false, errors: errors.sort((a, b) => (a.line ?? 0) - (b.line ?? 0)) };
  }
  const pack = parsed.data as AnyPack;
  const key = packKey(pack);
  return { ok: true, key, pack };
}

/** Section keys of a pack: the parts that carry a source and get ticked when checked. */
export function packSections(pack: object): string[] {
  return Object.entries(pack)
    .filter(([, v]) => typeof v === "object" && v !== null && !Array.isArray(v) && typeof (v as { source?: unknown }).source === "string")
    .map(([k]) => k);
}
