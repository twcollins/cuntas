import { applyRate, sumMinor, toMinor, type Currency } from "../../money";
import type { IsoDate } from "../../dates";
import { onDate, type IePack, type Jurisdiction, type RuleRef, type UkPack } from "../../packs";
import type { UkRateBand } from "../uk/payroll";

export type WrapperId = "iePension" | "ieEtf" | "ieInvestmentTrust" | "ieInvestmentAccount" | "ieDeposit" | "ukIsaHeldInIreland" | "ukIsa" | "ukPension" | "ukGia" | "ukCash";

export interface WrapperComparisonInput {
  residence: Jurisdiction;
  iePack: IePack;
  ukPack: UkPack;
  /** What it costs you each year, after any tax relief: every wrapper gets the same. */
  annualContributionMinor: number;
  years: number;
  /** Nominal total return a year on investments. */
  growthRate: number;
  /** Part of the return paid out as dividends (taxed as income outside wrappers). */
  dividendYield: number;
  depositRate: number;
  /** Marginal income tax rate: sets pension relief. */
  marginalRate: number;
  /** Marginal rate on investment income, including USC and PRSI in Ireland. */
  incomeChargesRate: number;
  /** Tax rate assumed on pension income in retirement. */
  retirementTaxRate: number;
  ukBand: UkRateBand;
  date: IsoDate;
  flags: readonly string[];
  /** A later pack that defines the Investment Account, so it shows before its start year. */
  investmentAccountPack?: IePack;
}

export interface WrapperResult {
  id: WrapperId;
  label: string;
  currency: Currency;
  available: boolean;
  contributedMinor: number;
  investedMinor: number;
  grossValueMinor: number;
  taxPaidMinor: number;
  netValueMinor: number;
  notes: string[];
  rules: RuleRef[];
}

const grow = (value: number, rate: number) => value + applyRate(value, rate);
const mean = (values: number[]) => Math.round(sumMinor(values) / values.length);

/** Same contribution, same return, after-tax value in each wrapper open to someone with this residence. */
export function compareWrappers(input: WrapperComparisonInput): WrapperResult[] {
  return input.residence === "IE" ? irishWrappers(input) : ukWrappers(input);
}

function pensionGrossUp(contribution: number, marginalRate: number): number {
  return Math.round(contribution / (1 - marginalRate));
}

function irishWrappers(input: WrapperComparisonInput): WrapperResult[] {
  const p = input.iePack;
  const c = input.annualContributionMinor;
  const contributed = c * input.years;
  const exit = onDate(p.exitTax.rates, input.date);
  const cgtRate = onDate(p.cgt.rates, input.date).rate;
  const ref = (key: string, source: string, value?: number): RuleRef => ({ pack: p.version, key, source, ...(value !== undefined ? { value } : {}) });
  const out: WrapperResult[] = [];

  // Pension: relief at the marginal rate, tax-free growth, part of the lump sum tax-free, the rest taxed as income.
  {
    const yearly = pensionGrossUp(c, input.marginalRate);
    let value = 0;
    for (let y = 0; y < input.years; y++) value = grow(value + yearly, input.growthRate);
    const ls = p.pension.lumpSum;
    const notes = ["Locked until the scheme's retirement age. Relief is capped by your age band and the earnings limit."];
    let tax = 0;
    if (ls) {
      const lump = applyRate(value, ls.share);
      const free = Math.min(lump, toMinor(ls.taxFreeMax));
      const standard = Math.min(lump - free, toMinor(ls.standardRateTop - ls.taxFreeMax));
      tax += applyRate(standard, p.incomeTax.rates.standard) + applyRate(lump - free - standard, input.retirementTaxRate);
      tax += applyRate(value - lump, input.retirementTaxRate);
      notes.push(`${Math.round(ls.share * 100)}% taken as a lump sum; the rest drawn as income taxed at ${Math.round(input.retirementTaxRate * 100)}%.`);
    } else {
      tax += applyRate(value, input.retirementTaxRate);
    }
    out.push({ id: "iePension", label: "Pension (PRSA or occupational)", currency: "EUR", available: true, contributedMinor: contributed, investedMinor: yearly * input.years, grossValueMinor: value, taxPaidMinor: tax, netValueMinor: value - tax, notes, rules: [ref("pension.ageBands", p.pension.source), ...(ls ? [ref("pension.lumpSum", ls.source)] : [])] });
  }

  // ETF or fund: exit tax on gains, including a deemed disposal of each year's purchase every 8 years.
  {
    const lots: { value: number; cost: number; age: number }[] = [];
    let tax = 0;
    for (let y = 0; y < input.years; y++) {
      lots.push({ value: c, cost: c, age: 0 });
      for (const lot of lots) {
        lot.value = grow(lot.value, input.growthRate);
        lot.age += 1;
        if (lot.age % p.exitTax.deemedDisposalYears === 0 && lot.value > lot.cost) {
          const t = applyRate(lot.value - lot.cost, exit.rate);
          tax += t;
          lot.value -= t; // units are sold to pay the tax
          lot.cost = lot.value;
        }
      }
    }
    const gross = sumMinor(lots.map((l) => l.value));
    const final = sumMinor(lots.map((l) => (l.value > l.cost ? applyRate(l.value - l.cost, exit.rate) : 0)));
    tax += final;
    out.push({ id: "ieEtf", label: "ETF or fund (exit tax)", currency: "EUR", available: true, contributedMinor: contributed, investedMinor: contributed, grossValueMinor: gross + tax - final, taxPaidMinor: tax, netValueMinor: gross - final, notes: [`Exit tax at ${Math.round(exit.rate * 100)}% with a deemed disposal every ${p.exitTax.deemedDisposalYears} years; no annual exemption and no loss relief.`], rules: [ref("exitTax.rates", p.exitTax.source, exit.rate), ref("exitTax.deemedDisposalYears", p.exitTax.source, p.exitTax.deemedDisposalYears)] });
  }

  // Investment trust or shares: dividends taxed as income each year, CGT on the gain at the end.
  out.push(cgtWrapper("ieInvestmentTrust", "Investment trust or shares (CGT)", "EUR", input, {
    capitalGainsRate: cgtRate,
    exemptionMinor: toMinor(p.cgt.annualExemption),
    dividendTax: (d) => applyRate(d, input.incomeChargesRate),
    notes: [`CGT at ${Math.round(cgtRate * 100)}% above the annual exemption; dividends taxed at your marginal rate with USC and PRSI.`],
    rules: [ref("cgt.rates", p.cgt.source, cgtRate), ref("cgt.annualExemption", p.cgt.source, p.cgt.annualExemption)],
  }));

  // Investment Account: no tax on growth, 1% a year on average value above the tax-free amount.
  const iaPack = p.investmentAccount ? p : input.investmentAccountPack;
  if (iaPack?.investmentAccount) {
    const ia = iaPack.investmentAccount;
    const enabled = input.flags.includes(ia.featureFlag);
    const limit = toMinor(ia.annualContributionLimit);
    const yearly = Math.min(c, limit);
    let value = 0;
    let tax = 0;
    for (let y = 0; y < input.years; y++) {
      const start = value + yearly;
      const end = grow(start, input.growthRate);
      const charge = applyRate(Math.max(0, mean([start, end]) - toMinor(ia.taxFreeValue)), ia.annualChargeRate);
      tax += charge;
      value = end - charge;
    }
    const notes = [`Up to ${ia.annualContributionLimit.toLocaleString("en-IE")} euro a year; ${ia.annualChargeRate * 100}% a year on average value above ${ia.taxFreeValue.toLocaleString("en-IE")} euro.`];
    if (c > limit) notes.push("Your contribution is above the annual limit: only the limit is invested here.");
    if (!enabled) notes.push(`Proposed from ${ia.from}; turn it on in Household settings once legislated.`);
    out.push({ id: "ieInvestmentAccount", label: "Investment Account", currency: "EUR", available: enabled, contributedMinor: yearly * input.years, investedMinor: yearly * input.years, grossValueMinor: value + tax, taxPaidMinor: tax, netValueMinor: value, notes, rules: [{ pack: iaPack.version, key: "investmentAccount", source: ia.source }] });
  }

  out.push(depositWrapper("ieDeposit", "Deposit account (DIRT)", "EUR", input, (interest) => applyRate(interest, p.dirt.rate), [`DIRT at ${Math.round(p.dirt.rate * 100)}% on interest.`], [ref("dirt.rate", p.dirt.source, p.dirt.rate)]));

  // A UK ISA has no Irish exemption: for an Irish resident, ISA funds are taxed like Irish-resident funds.
  const etf = out.find((w) => w.id === "ieEtf")!;
  out.push({ ...etf, id: "ukIsaHeldInIreland", label: "UK ISA held while Irish resident", currency: "EUR", notes: ["No Irish tax exemption for ISAs: fund holdings are taxed like the ETF row (exit tax and deemed disposal)."], rules: [...etf.rules] });
  return out;
}

function ukWrappers(input: WrapperComparisonInput): WrapperResult[] {
  const p = input.ukPack;
  const c = input.annualContributionMinor;
  const contributed = c * input.years;
  const ref = (key: string, source: string, value?: number): RuleRef => ({ pack: p.version, key, source, ...(value !== undefined ? { value } : {}) });
  const out: WrapperResult[] = [];

  {
    const yearly = Math.min(c, toMinor(p.isa.annualAllowance));
    let value = 0;
    for (let y = 0; y < input.years; y++) value = grow(value + yearly, input.growthRate);
    const notes = ["No tax on income or gains while you are UK resident."];
    if (c > yearly) notes.push("Your contribution is above the ISA allowance: only the allowance is invested here.");
    out.push({ id: "ukIsa", label: "Stocks and shares ISA", currency: "GBP", available: true, contributedMinor: yearly * input.years, investedMinor: yearly * input.years, grossValueMinor: value, taxPaidMinor: 0, netValueMinor: value, notes, rules: [ref("isa.annualAllowance", p.isa.source, p.isa.annualAllowance)] });
  }

  {
    const yearly = pensionGrossUp(c, input.marginalRate);
    let value = 0;
    for (let y = 0; y < input.years; y++) value = grow(value + yearly, input.growthRate);
    const ls = p.pensionLumpSum;
    const lump = ls ? Math.min(applyRate(value, ls.share), toMinor(ls.lumpSumAllowance)) : 0;
    const tax = applyRate(value - lump, input.retirementTaxRate);
    out.push({ id: "ukPension", label: "Pension (workplace or SIPP)", currency: "GBP", available: true, contributedMinor: contributed, investedMinor: yearly * input.years, grossValueMinor: value, taxPaidMinor: tax, netValueMinor: value - tax, notes: ["Locked until the minimum pension age.", ls ? `Up to ${Math.round(ls.share * 100)}% tax-free, capped by the lump sum allowance.` : "", "Subject to the annual allowance."].filter(Boolean), rules: ls ? [ref("pensionLumpSum", ls.source)] : [] });
  }

  const dividends = p.dividends;
  const cgt = p.cgt;
  const higher = input.ukBand !== "basic";
  out.push(cgtWrapper("ukGia", "General investment account", "GBP", input, {
    capitalGainsRate: cgt ? (higher ? cgt.rates.higher : cgt.rates.basic) : 0,
    exemptionMinor: cgt ? toMinor(cgt.annualExemptAmount) : 0,
    dividendTax: (d) => (dividends ? applyRate(Math.max(0, d - toMinor(dividends.allowance)), dividends.rates[input.ukBand]) : 0),
    notes: ["Dividends above the allowance taxed at dividend rates; CGT on gains above the annual exempt amount."],
    rules: [...(cgt ? [ref("cgt", cgt.source)] : []), ...(dividends ? [ref("dividends", dividends.source)] : [])],
  }));

  const psa = toMinor(p.savings.personalSavingsAllowance[input.ukBand]);
  out.push(depositWrapper("ukCash", "Cash savings", "GBP", input, (interest) => applyRate(Math.max(0, interest - psa), p.savings.rates[input.ukBand]), ["Interest above your Personal Savings Allowance taxed at your savings rate."], [ref("savings", p.savings.source)]));
  return out;
}

function cgtWrapper(
  id: WrapperId,
  label: string,
  currency: Currency,
  input: WrapperComparisonInput,
  t: { capitalGainsRate: number; exemptionMinor: number; dividendTax: (dividendsMinor: number) => number; notes: string[]; rules: RuleRef[] },
): WrapperResult {
  const c = input.annualContributionMinor;
  let value = 0;
  let cost = 0;
  let tax = 0;
  const capitalGrowth = input.growthRate - input.dividendYield;
  for (let y = 0; y < input.years; y++) {
    value += c;
    cost += c;
    const dividends = applyRate(value, input.dividendYield);
    const dTax = t.dividendTax(dividends);
    tax += dTax;
    value = grow(value, capitalGrowth) + dividends - dTax;
    cost += dividends - dTax; // reinvested dividends add to the base cost
  }
  const gainTax = applyRate(Math.max(0, value - cost - t.exemptionMinor), t.capitalGainsRate);
  return { id, label, currency, available: true, contributedMinor: c * input.years, investedMinor: c * input.years, grossValueMinor: value + tax, taxPaidMinor: tax + gainTax, netValueMinor: value - gainTax, notes: t.notes, rules: t.rules };
}

function depositWrapper(id: WrapperId, label: string, currency: Currency, input: WrapperComparisonInput, taxOn: (interestMinor: number) => number, notes: string[], rules: RuleRef[]): WrapperResult {
  let value = 0;
  let tax = 0;
  for (let y = 0; y < input.years; y++) {
    value += input.annualContributionMinor;
    const interest = applyRate(value, input.depositRate);
    const t = taxOn(interest);
    tax += t;
    value += interest - t;
  }
  return { id, label, currency, available: true, contributedMinor: input.annualContributionMinor * input.years, investedMinor: input.annualContributionMinor * input.years, grossValueMinor: value + tax, taxPaidMinor: tax, netValueMinor: value, notes, rules };
}
