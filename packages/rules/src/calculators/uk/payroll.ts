import { applyRate, divideMinor, sumMinor, toMinor } from "../../money";
import { MONTHS_PER_YEAR } from "../../dates";
import { regionPackFor, type ExplainedLine, type StudentLoanPlan, type UkPack, type UkRegion } from "../../packs";
import { bandedTax } from "../shared";
import { ukStudentLoanRepayment } from "./studentLoan";

export type UkRateBand = "basic" | "higher" | "additional";

/** Personal allowance after the taper above the income threshold. */
export function ukPersonalAllowance(pack: UkPack, adjustedNetIncomeMinor: number): number {
  const pa = toMinor(pack.incomeTax.personalAllowance);
  const over = Math.max(0, adjustedNetIncomeMinor - toMinor(pack.incomeTax.taper.above));
  return Math.max(0, pa - Math.floor(over / pack.incomeTax.taper.divisor));
}

export function ukRateBand(pack: UkPack, incomeMinor: number): UkRateBand {
  const taxable = Math.max(0, incomeMinor - ukPersonalAllowance(pack, incomeMinor));
  const [basic, higher] = pack.incomeTax.bands;
  if (taxable <= toMinor(basic!.upTo!)) return "basic";
  if (taxable <= toMinor(higher!.upTo!)) return "higher";
  return "additional";
}

/** Income tax bands for a region: Scottish taxpayers use the Scottish sub-pack for the same tax year. */
export function ukIncomeTaxBands(pack: UkPack, region: UkRegion = "rUK") {
  if (region === "rUK") {
    return { version: pack.version, source: pack.incomeTax.source, exact: true, bands: pack.incomeTax.bands.map((b, i) => ({ ...b, name: `band ${i + 1}` })) };
  }
  const { pack: sub, exact } = regionPackFor(region, pack.taxYear);
  return { version: sub.version, source: sub.incomeTax.source, exact, bands: sub.incomeTax.bands };
}

export interface UkPayrollInput {
  grossAnnualMinor: number;
  pensionSalarySacrificeMinor?: number;
  /** Scottish taxpayers pay Scottish income tax; Wales and Northern Ireland follow the rUK bands. */
  region?: UkRegion;
  studentLoans?: readonly StudentLoanPlan[];
}

/** UK PAYE income tax, Class 1 employee NI and student loan repayments for one tax year. */
export function ukPayroll(pack: UkPack, input: UkPayrollInput) {
  const notes: string[] = [];
  const gross = input.grossAnnualMinor - (input.pensionSalarySacrificeMinor ?? 0);
  const pa = ukPersonalAllowance(pack, gross);
  const taxable = Math.max(0, gross - pa);
  const region = input.region ?? "rUK";
  const regional = ukIncomeTaxBands(pack, region);
  if (!regional.exact) notes.push(`Scottish rates for ${pack.taxYear} are not published yet; using ${regional.version}.`);
  const bands = regional.bands.map((b) => ({ upToMinor: b.upTo === null ? null : toMinor(b.upTo), rate: b.rate }));
  const banded = bandedTax(taxable, bands);
  const incomeTaxMinor = sumMinor(banded.map((b) => b.taxMinor));

  const ni = pack.nationalInsurance;
  const niMain = Math.max(0, Math.min(gross, toMinor(ni.upperEarningsLimit)) - toMinor(ni.primaryThreshold));
  const niUpper = Math.max(0, gross - toMinor(ni.upperEarningsLimit));
  const niMinor = applyRate(niMain, ni.mainRate) + applyRate(niUpper, ni.upperRate);

  const lines: ExplainedLine[] = [
    { label: "Personal allowance", amountMinor: pa, rule: { pack: pack.version, key: "incomeTax.personalAllowance", source: pack.incomeTax.source } },
    ...banded.map((b, i) => ({
      label: region === "rUK" ? `Income tax band ${i + 1}` : `Scottish ${regional.bands[i]?.name ?? ""} rate`,
      amountMinor: b.taxMinor,
      rule: { pack: regional.version, key: `incomeTax.bands[${i}]`, source: regional.source, value: b.rate },
    })),
    { label: "Employee National Insurance", amountMinor: niMinor, rule: { pack: pack.version, key: "nationalInsurance", source: ni.source } },
  ];
  const loans = ukStudentLoanRepayment(pack, { incomeMinor: gross, plans: input.studentLoans ?? [] });
  for (const l of loans.lines) lines.push({ label: `Student loan (${l.plan})`, amountMinor: l.amountMinor, rule: l.rule });
  notes.push(...loans.notes);
  const netAnnualMinor = gross - incomeTaxMinor - niMinor - loans.totalMinor;
  const band = ukRateBand(pack, gross);
  const marginalRate = taxable === 0 ? 0 : (banded.filter((b) => b.portionMinor > 0).at(-1)?.rate ?? 0);
  return {
    pack: pack.version,
    packStatus: pack.status,
    taxYear: pack.taxYear,
    grossMinor: input.grossAnnualMinor,
    personalAllowanceMinor: pa,
    incomeTaxMinor,
    niMinor,
    studentLoanMinor: loans.totalMinor,
    region,
    netAnnualMinor,
    netPerPeriodMinor: divideMinor(netAnnualMinor, MONTHS_PER_YEAR),
    marginalRate,
    rateBand: band,
    lines,
    notes,
  };
}

/** Tax on savings interest after the Personal Savings Allowance for the taxpayer's band. */
export function ukSavingsTax(pack: UkPack, input: { interestMinor: number; band: UkRateBand }) {
  const allowance = toMinor(pack.savings.personalSavingsAllowance[input.band]);
  const rate = pack.savings.rates[input.band];
  const taxableMinor = Math.max(0, input.interestMinor - allowance);
  return { allowanceMinor: allowance, rate, taxableMinor, taxMinor: applyRate(taxableMinor, rate) };
}
