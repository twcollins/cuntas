import { applyRate, sumMinor, toMinor } from "../../money";
import { addYears, deadlineFor, monthOf, yearOf, type IsoDate } from "../../dates";
import { onDate, packOn, type IePack, type RuleRef } from "../../packs";

/** Exit tax on a fund or ETF gain. No annual exemption and no loss offset. */
export function ieExitTax(pack: IePack, input: { gainMinor: number; date: IsoDate }) {
  const { rate } = onDate(pack.exitTax.rates, input.date);
  const taxMinor = input.gainMinor > 0 ? applyRate(input.gainMinor, rate) : 0;
  const rule: RuleRef = { pack: pack.version, key: "exitTax.rates", source: pack.exitTax.source, value: rate };
  return {
    rate,
    taxMinor,
    rule,
    note: input.gainMinor < 0 ? "Exit-tax losses cannot be offset against other gains." : undefined,
  };
}

export interface FundLot {
  id: string;
  date: IsoDate;
  units: number;
  costMinor: number;
}

export interface DeemedDisposalEvent {
  lotId: string;
  date: IsoDate;
  anniversary: number;
  estimatedGainMinor: number;
  estimatedTaxMinor: number;
  rate: number;
  paymentDeadline: IsoDate;
  pack: string;
}

/**
 * Deemed-disposal events on each 8-year anniversary of each lot, from `from` until `until`.
 * Liability is estimated at today's unit price; later anniversaries use the value at the previous one as cost.
 */
export function ieDeemedDisposals(input: {
  lots: readonly FundLot[];
  unitPriceMinor: number;
  from: IsoDate;
  until: IsoDate;
  getPack?: (date: IsoDate) => IePack;
}): DeemedDisposalEvent[] {
  const getPack = input.getPack ?? ((d: IsoDate) => packOn("IE", d));
  const events: DeemedDisposalEvent[] = [];
  for (const lot of input.lots) {
    let cost = lot.costMinor;
    const valueMinor = Math.round(lot.units * input.unitPriceMinor);
    for (let n = 1; ; n++) {
      const pack = getPack(lot.date);
      const date = addYears(lot.date, pack.exitTax.deemedDisposalYears * n);
      if (date > input.until) break;
      const eventPack = getPack(date);
      const gain = valueMinor - cost;
      const { rate, taxMinor } = ieExitTax(eventPack, { gainMinor: gain, date });
      if (date >= input.from) {
        events.push({
          lotId: lot.id,
          date,
          anniversary: n,
          estimatedGainMinor: gain,
          estimatedTaxMinor: taxMinor,
          rate,
          paymentDeadline: deadlineFor(yearOf(date), eventPack.exitTax.paymentDeadline),
          pack: eventPack.version,
        });
      }
      cost = Math.max(cost, valueMinor);
    }
  }
  return events.sort((a, b) => a.date.localeCompare(b.date));
}

export interface CgtDisposal {
  date: IsoDate;
  gainMinor: number;
  developmentLand?: boolean;
}

/** CGT for one tax year: losses offset gains, the annual exemption goes to the highest-rate gains first. */
export function ieCgt(pack: IePack, input: { disposals: readonly CgtDisposal[]; lossesBroughtForwardMinor?: number }) {
  const year = Number(pack.taxYear);
  const rated = input.disposals.map((d) => ({
    ...d,
    rate: d.developmentLand ? pack.cgt.developmentLandRate : onDate(pack.cgt.rates, d.date).rate,
  }));
  let losses = sumMinor(rated.filter((d) => d.gainMinor < 0).map((d) => -d.gainMinor)) + (input.lossesBroughtForwardMinor ?? 0);
  let exemption = toMinor(pack.cgt.annualExemption);
  const gains = rated.filter((d) => d.gainMinor > 0).sort((a, b) => b.rate - a.rate);
  const taxed = gains.map((g) => {
    let chargeable = g.gainMinor;
    const lossUsed = Math.min(losses, chargeable);
    losses -= lossUsed;
    chargeable -= lossUsed;
    const exemptionUsed = Math.min(exemption, chargeable);
    exemption -= exemptionUsed;
    chargeable -= exemptionUsed;
    const month = monthOf(g.date);
    const due = pack.cgt.payment.find((p) => month <= p.disposalsThroughMonth)!;
    return {
      ...g,
      chargeableMinor: chargeable,
      taxMinor: applyRate(chargeable, g.rate),
      dueDate: deadlineFor(year, { monthDay: due.dueMonthDay, yearOffset: due.yearOffset }),
    };
  });
  return {
    taxMinor: sumMinor(taxed.map((t) => t.taxMinor)),
    disposals: taxed,
    lossesCarriedForwardMinor: losses,
    exemptionUnusedMinor: exemption,
    rule: { pack: pack.version, key: "cgt.rates", source: pack.cgt.source } satisfies RuleRef,
  };
}

/** The new Investment Account: value-based charge, no CGT, exit tax or deemed disposal. Feature-flagged. */
export function ieInvestmentAccount(
  pack: IePack,
  input: { date: IsoDate; averageValueMinor: number; contributionsThisYearMinor: number; flags: ReadonlySet<string> },
) {
  const ia = pack.investmentAccount;
  if (!ia) return { enabled: false as const, reason: `Not in rule pack ${pack.version}` };
  if (!input.flags.has(ia.featureFlag)) return { enabled: false as const, reason: "Feature flag off until legislation passes" };
  if (input.date < ia.from) return { enabled: false as const, reason: `Available from ${ia.from}` };
  const limit = toMinor(ia.annualContributionLimit);
  const taxFree = toMinor(ia.taxFreeValue);
  return {
    enabled: true as const,
    chargeMinor: applyRate(Math.max(0, input.averageValueMinor - taxFree), ia.annualChargeRate),
    contributionHeadroomMinor: Math.max(0, limit - input.contributionsThisYearMinor),
    overContributionMinor: Math.max(0, input.contributionsThisYearMinor - limit),
    rule: { pack: pack.version, key: "investmentAccount", source: ia.source } satisfies RuleRef,
  };
}

/** Help to Buy: the lowest of the maximum, the price share, and income tax plus DIRT paid over the lookback. */
export function ieHelpToBuy(pack: IePack, input: { priceMinor: number; taxPaidLookbackMinor: number }) {
  const h = pack.helpToBuy;
  const options = [
    { key: "maxRelief", amountMinor: toMinor(h.maxRelief) },
    { key: "priceRate", amountMinor: applyRate(input.priceMinor, h.priceRate) },
    { key: "taxPaid", amountMinor: input.taxPaidLookbackMinor },
  ];
  const binding = options.reduce((a, b) => (b.amountMinor < a.amountMinor ? b : a));
  return {
    reliefMinor: binding.amountMinor,
    limitedBy: binding.key,
    options,
    rule: { pack: pack.version, key: "helpToBuy", source: h.source } satisfies RuleRef,
  };
}
