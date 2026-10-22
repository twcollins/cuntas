import { applyRate, divideMinor, sumMinor, toMinor } from "../../money";
import { MONTHS_PER_YEAR } from "../../dates";
import type { ExplainedLine, UkPack } from "../../packs";
import { bandedTax } from "../shared";

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

/** UK PAYE income tax and Class 1 employee NI for one tax year (England, Wales, NI). */
export function ukPayroll(pack: UkPack, input: { grossAnnualMinor: number; pensionSalarySacrificeMinor?: number }) {
  const gross = input.grossAnnualMinor - (input.pensionSalarySacrificeMinor ?? 0);
  const pa = ukPersonalAllowance(pack, gross);
  const taxable = Math.max(0, gross - pa);
  const bands = pack.incomeTax.bands.map((b) => ({ upToMinor: b.upTo === null ? null : toMinor(b.upTo), rate: b.rate }));
  const banded = bandedTax(taxable, bands);
  const incomeTaxMinor = sumMinor(banded.map((b) => b.taxMinor));

  const ni = pack.nationalInsurance;
  const niMain = Math.max(0, Math.min(gross, toMinor(ni.upperEarningsLimit)) - toMinor(ni.primaryThreshold));
  const niUpper = Math.max(0, gross - toMinor(ni.upperEarningsLimit));
  const niMinor = applyRate(niMain, ni.mainRate) + applyRate(niUpper, ni.upperRate);

  const lines: ExplainedLine[] = [
    { label: "Personal allowance", amountMinor: pa, rule: { pack: pack.version, key: "incomeTax.personalAllowance", source: pack.incomeTax.source } },
    ...banded.map((b, i) => ({
      label: `Income tax band ${i + 1}`,
      amountMinor: b.taxMinor,
      rule: { pack: pack.version, key: `incomeTax.bands[${i}]`, source: pack.incomeTax.source, value: b.rate },
    })),
    { label: "Employee National Insurance", amountMinor: niMinor, rule: { pack: pack.version, key: "nationalInsurance", source: ni.source } },
  ];
  const netAnnualMinor = gross - incomeTaxMinor - niMinor;
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
    netAnnualMinor,
    netPerPeriodMinor: divideMinor(netAnnualMinor, MONTHS_PER_YEAR),
    marginalRate,
    rateBand: band,
    lines,
    notes: ["Student loan repayments are not modelled yet."],
  };
}

/** Tax on savings interest after the Personal Savings Allowance for the taxpayer's band. */
export function ukSavingsTax(pack: UkPack, input: { interestMinor: number; band: UkRateBand }) {
  const allowance = toMinor(pack.savings.personalSavingsAllowance[input.band]);
  const rate = pack.savings.rates[input.band];
  const taxableMinor = Math.max(0, input.interestMinor - allowance);
  return { allowanceMinor: allowance, rate, taxableMinor, taxMinor: applyRate(taxableMinor, rate) };
}
