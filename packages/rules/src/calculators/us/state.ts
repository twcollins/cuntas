import { applyRate, sumMinor, toMinor } from "../../money";
import type { ExplainedLine, PhaseOut, UsFilingStatus, UsStatePack } from "../../packs";
import { US_STATES } from "../../usStates";
import { bandedTax } from "../shared";

export interface UsStateInput {
  filingStatus: UsFilingStatus;
  federalAgiMinor: number;
  federalTaxableIncomeMinor: number;
  /** Wages (or net earnings) before 401(k) deferrals, for states that tax them gross. */
  wagesMinor: number;
  federalStandardDeductionMinor: number;
  /** People filing: 2 on a joint return. */
  filers: number;
  dependents: number;
  /** Filers aged 65 or over. */
  agedFilers?: number;
  /** Social Security and Medicare (or self-employment tax) each filer paid. */
  payrollTaxByFilerMinor?: number[];
  /** Each filer's own AGI and whether they're 65 or over, for joint-return adjustments. */
  filerAgiMinor?: number[];
  filerAged?: boolean[];
  /** Federal income tax on the return after credits, for states that let you deduct it. */
  federalIncomeTaxMinor?: number;
  /** Rent paid on the home this year. */
  rentPaidMinor?: number;
  /** The household's locality, for states whose pack carries local rates. */
  locality?: string | null;
}

/**
 * A state's income tax for residents on one return: from the state's starting point, less its
 * standard deduction and exemptions, through its rate or brackets. Local income taxes aren't
 * included; the result says when the state has them.
 */
export function usStateTax(pack: UsStatePack, input: UsStateInput) {
  const t = pack.incomeTax;
  const name = US_STATES[pack.state];
  const rule = (key: string, value?: number): ExplainedLine["rule"] => ({ pack: pack.version, key, source: t.source, ...(value === undefined ? {} : { value }) });
  const loc = pack.localities;
  const locality = loc && input.locality ? loc.list.find((l) => l.id === input.locality) : undefined;
  const localNote = !pack.localTax
    ? []
    : locality
      ? []
      : loc
        ? [`${pack.localTax.note} Choose your ${loc.kind} to include it.`]
        : [`${pack.localTax.note} Local income tax isn't included.`];
  const notes = [...(t.notes ?? []), ...localNote];
  if (t.none) return { pack: pack.version, taxMinor: 0, levyMinor: 0, localTaxMinor: 0, taxableMinor: 0, marginalRate: 0, lines: [] as ExplainedLine[], notes: [`${name} has no income tax on wages.`, ...notes] };

  const status = input.filingStatus;
  const base = t.base === "wages" ? input.wagesMinor : t.base === "federalTaxableIncome" ? input.federalTaxableIncomeMinor : input.federalAgiMinor;
  const married = status === "marriedJoint" || status === "marriedSeparate";
  /** Share kept as AGI crosses a phase-out range: 1 below `from`, 0 past `from + range` (in equal steps if given). */
  const kept = (po: PhaseOut | undefined) => {
    if (!po) return 1;
    const over = Math.max(0, input.federalAgiMinor - toMinor(po.from[status]));
    const range = toMinor(po.range[status]);
    const lost = po.steps ? Math.ceil(over / (range / po.steps)) / po.steps : over / range;
    return Math.max(0, 1 - lost);
  };
  const steps = t.standardDeductionSteps?.[status];
  const sliding = t.slidingStandardDeduction?.[status].find((x) => x.upTo === null || input.federalAgiMinor <= toMinor(x.upTo));
  const baseStandard =
    t.standardDeduction === "federal"
      ? input.federalStandardDeductionMinor
      : steps
        ? Math.max(toMinor(steps.min), toMinor(t.standardDeduction?.[status] ?? 0) - Math.ceil(Math.max(0, input.federalAgiMinor - toMinor(steps.from)) / toMinor(steps.step)) * toMinor(steps.reduction))
        : sliding
          ? Math.max(0, toMinor(sliding.max) - Math.round(sliding.rate * Math.max(0, input.federalAgiMinor - toMinor(sliding.from))))
          : t.standardDeduction
            ? toMinor(t.standardDeduction[status])
            : 0;
  const agedStandard = t.agedStandardDeduction ? (input.agedFilers ?? 0) * toMinor(married ? t.agedStandardDeduction.married : t.agedStandardDeduction.unmarried) : 0;
  const standard = Math.round((baseStandard + agedStandard) * kept(t.standardDeductionPhaseOut));
  const ex = t.exemption;
  const exemptionAllowed = ex && !(ex.incomeLimit && input.federalAgiMinor > toMinor(ex.incomeLimit[status]));
  const aged = input.agedFilers ?? 0;
  const band = ex?.amountByAgi?.[status].find((b) => b.upTo === null || input.federalAgiMinor <= toMinor(b.upTo));
  const perFiler = band ? toMinor(band.amount) : toMinor(ex?.perFiler ?? 0);
  const perDependent = band ? toMinor(band.amount) : toMinor(ex?.perDependent ?? 0);
  const personalBefore = ex ? Math.round((ex.byStatus ? toMinor(ex.byStatus[status]) : input.filers * perFiler) * kept(ex.phaseOut)) : 0;
  const personal = ex?.reduction ? Math.max(0, personalBefore - Math.round(ex.reduction.rate * Math.max(0, input.federalAgiMinor - toMinor(ex.reduction.from[status])))) : personalBefore;
  const lowIncomeAged = ex?.agedLowIncome && input.federalAgiMinor < toMinor(ex.agedLowIncome.below[status]) ? aged * toMinor(ex.agedLowIncome.extra) : 0;
  const exemption = ex && exemptionAllowed ? personal + input.dependents * perDependent + aged * toMinor(ex.perAged ?? 0) + lowIncomeAged : 0;
  const cd = t.childDeduction;
  const perChild = cd ? Math.max(0, toMinor(cd.max) - Math.ceil(Math.max(0, input.federalAgiMinor - toMinor(cd.from[status])) / toMinor(cd.step[status])) * toMinor(cd.reductionPerStep)) : 0;
  const childDeduction = perChild * input.dependents;
  if (ex && !exemptionAllowed) notes.push(`Income is above ${name}'s limit for personal exemptions.`);
  const payrollDeduction = t.payrollTaxDeductionMax ? sumMinor((input.payrollTaxByFilerMinor ?? []).map((p) => Math.min(p, toMinor(t.payrollTaxDeductionMax!)))) : 0;
  const rd = t.rentDeduction;
  const rentDeduction = rd ? Math.min(applyRate(input.rentPaidMinor ?? 0, rd.share), toMinor(rd.max[status])) : 0;
  const ad = t.ageDeduction;
  const ageDeduction = ad && aged > 0 ? Math.max(0, aged * toMinor(ad.perPerson) - Math.round(ad.phaseOutRate * Math.max(0, input.federalAgiMinor - toMinor(ad.phaseOutFrom[status])))) : 0;
  const shares = input.filerAgiMinor ?? [];
  const twoEarner = t.twoEarnerDeduction && status === "marriedJoint" && shares.length > 1 ? Math.min(toMinor(t.twoEarnerDeduction.max), Math.max(0, Math.min(...shares))) : 0;
  const ftd = t.federalTaxDeduction;
  const inBand = <T extends { upTo: number | null }>(list: T[] | undefined) => list?.find((b) => b.upTo === null || input.federalAgiMinor <= toMinor(b.upTo));
  const ftdShare = ftd ? (ftd.shareByAgi ? (inBand(ftd.shareByAgi)?.share ?? 0) : 1) : 0;
  const ftdCaps = [inBand(ftd?.capByAgi?.[status])?.amount, ftd?.max?.[status]].filter((c): c is number => c !== undefined).map(toMinor);
  const federalTaxDeduction = ftd ? Math.min(Math.round((input.federalIncomeTaxMinor ?? 0) * ftdShare), ...ftdCaps) : 0;
  const taxable = Math.max(0, base - standard - exemption - childDeduction - payrollDeduction - rentDeduction - ageDeduction - twoEarner - federalTaxDeduction);
  const schedule = t.brackets ? t.brackets[status] : [{ upTo: null, rate: t.rate ?? 0 }];
  const bands = schedule.map((b) => ({ upToMinor: b.upTo === null ? null : toMinor(b.upTo), rate: b.rate }));
  /** Tax on an amount: the statute's base for its bracket plus the rate on the excess, when bases are given. */
  const scheduleTax = (amount: number) => {
    const i = schedule.findIndex((b) => b.upTo === null || amount <= toMinor(b.upTo));
    const b = schedule[i]!;
    if (b.base === undefined) return sumMinor(bandedTax(amount, bands).map((x) => x.taxMinor));
    const from = i === 0 ? 0 : toMinor(schedule[i - 1]!.upTo!);
    return toMinor(b.base) + applyRate(amount - from, b.rate);
  };
  // Missouri: each spouse's share of joint taxable income (by AGI) runs through the schedule alone.
  const split = t.splitJointIncome && status === "marriedJoint" && shares.length > 1 && sumMinor(shares) > 0;
  const portions = split ? shares.map((a) => Math.round((taxable * a) / sumMinor(shares))) : [taxable];
  const banded = portions.flatMap((p) => bandedTax(p, bands));
  const cr = t.exemptionCredit;
  const dpo = cr?.dependentPhaseOut;
  const dependentCredit = cr
    ? Math.max(0, input.dependents * toMinor(cr.perDependent) - (dpo ? Math.ceil(Math.max(0, input.federalAgiMinor - toMinor(dpo.from[status])) / toMinor(dpo.step)) * toMinor(dpo.reductionPerStep) : 0))
    : 0;
  const creditCount = cr ? input.filers + aged + input.dependents : 0;
  const creditsAllowed = !(cr?.incomeLimit && input.federalAgiMinor > toMinor(cr.incomeLimit[status]));
  const allCreditCut = cr?.phaseOut ? creditCount * Math.ceil(Math.max(0, input.federalAgiMinor - toMinor(cr.phaseOut.from[status])) / toMinor(cr.phaseOut.step[status])) * toMinor(cr.phaseOut.reductionPerStep) : 0;
  const credit = cr && creditsAllowed ? Math.max(0, input.filers * toMinor(cr.perFiler) + dependentCredit + aged * toMinor(cr.perAged ?? 0) - allCreditCut) : 0;
  const rc = t.renterCredit;
  const renterCredit = rc && (input.rentPaidMinor ?? 0) > 0 && input.federalAgiMinor <= toMinor(rc.incomeLimit[status]) ? toMinor(rc.amount[status]) : 0;
  const levy = t.wageLevy ? applyRate(input.wagesMinor, t.wageLevy.rate) : 0;
  const tc = t.taxpayerCredit;
  const taxpayerCredit = tc
    ? Math.max(0, Math.round(tc.rate * (input.federalStandardDeductionMinor + input.dependents * toMinor(tc.perDependent))) - Math.round(tc.phaseOutRate * Math.max(0, taxable - toMinor(tc.base[status]))))
    : 0;
  const taxOn = scheduleTax;
  const scheduled = sumMinor(portions.map(scheduleTax));
  // New York: the supplemental tax recaptures the lower brackets' benefit as AGI rises.
  const br = t.benefitRecapture;
  let recapture = 0;
  if (br && input.federalAgiMinor > toMinor(br.agiAbove)) {
    const band = br.bands[status].find((b) => b.upTo === null || taxable <= toMinor(b.upTo));
    if (band) {
      const f = Number((Math.min(Math.max(0, input.federalAgiMinor - toMinor(band.agiFrom)), toMinor(br.width)) / toMinor(br.width)).toFixed(br.fractionDecimals));
      recapture =
        band.flatRate !== undefined
          ? Math.max(0, Math.round((applyRate(taxable, band.flatRate) - scheduled) * f))
          : toMinor(band.base ?? 0) + Math.round(toMinor(band.benefit ?? 0) * f);
    }
  }
  // Connecticut: add-backs as AGI rises, then the personal tax credit takes a share off.
  const addBack = sumMinor(
    (t.addBacks?.[status] ?? []).map((a) => Math.min(toMinor(a.cap), Math.ceil(Math.max(0, input.federalAgiMinor - toMinor(a.from)) / toMinor(a.step)) * toMinor(a.amount))),
  );
  const personalCreditRate = inBand(t.personalCreditRateByAgi?.[status])?.rate ?? 0;
  const gross = scheduled + recapture + addBack;
  const personalCredit = applyRate(gross, personalCreditRate);
  const beforeCredits = gross - personalCredit;

  // Two-earner joint returns: tax each spouse's share at the lower brackets, up to a cap.
  const sa = t.spouseAdjustment;
  let spouseAdjustment = 0;
  if (sa && status === "marriedJoint" && shares.length > 1 && taxable > toMinor(sa.minJointTaxable)) {
    const own = shares.map((a, i) => a - toMinor(ex?.perFiler ?? 0) - (input.filerAged?.[i] ? toMinor(ex?.perAged ?? 0) : 0));
    if (own.every((x) => x > 0)) {
      const lower = Math.min(...own);
      // Where the top band starts: the limit of the band below it.
      const topFrom = bands.slice(0, -1).at(-1)?.upToMinor ?? 0;
      const half = Math.round(taxable / own.length);
      spouseAdjustment =
        lower > topFrom && taxable > topFrom + topFrom
          ? toMinor(sa.cap)
          : Math.min(toMinor(sa.cap), Math.max(0, beforeCredits - taxOn(Math.min(lower, half)) - taxOn(Math.max(taxable - lower, half))));
    }
  }

  // Low-income credit per person in the family, when AGI is within the poverty guideline.
  const lc = t.lowIncomeCredit;
  let lowIncomeCredit = 0;
  if (lc && aged === 0) {
    const size = input.filers + input.dependents;
    const list = lc.incomeLimitByFamilySize;
    const limit = toMinor(list[Math.min(size, list.length) - 1]! + Math.max(0, size - list.length) * lc.perExtraPerson);
    if (input.federalAgiMinor <= limit) lowIncomeCredit = size * toMinor(lc.perPerson);
  }

  // Two-earner credit: a rate on the lower earner's income, up to a cap on that income.
  const tec = t.twoEarnerCredit;
  const twoEarnerCredit = tec && status === "marriedJoint" && shares.length > 1 ? applyRate(Math.min(Math.max(0, Math.min(...shares)), toMinor(tec.maxIncome)), tec.rate) : 0;
  // Joint filing credit: a share of the tax by income band when both spouses earn enough.
  const jfc = t.jointFilingCredit;
  const jointRate = jfc && status === "marriedJoint" && shares.length > 1 && shares.every((a) => a >= toMinor(jfc.minEachIncome))
    ? (jfc.rateByIncome.find((b) => b.upTo === null || taxable <= toMinor(b.upTo))?.rate ?? 0)
    : 0;
  // Refundable child credit, less a share of AGI over the threshold.
  const cc = t.childCredit;
  const childCredit = cc ? Math.max(0, input.dependents * toMinor(cc.perChild) - Math.round(cc.phaseOutRate * Math.max(0, input.federalAgiMinor - toMinor(cc.phaseOutFrom[status])))) : 0;

  const belowThreshold =
    (t.noTaxBelow && input.federalAgiMinor + ageDeduction < toMinor(t.noTaxBelow[status])) ||
    (t.noTaxIfTaxableAtMost !== undefined && taxable <= toMinor(t.noTaxIfTaxableAtMost));
  if (belowThreshold) notes.push(`Income is below ${name}'s filing threshold, so no ${name} tax is due.`);
  const afterCredits = belowThreshold ? 0 : Math.max(0, beforeCredits - credit - taxpayerCredit - spouseAdjustment - lowIncomeCredit - renterCredit - twoEarnerCredit);
  const jointFilingCredit = jfc ? Math.min(toMinor(jfc.max), applyRate(afterCredits, jointRate)) : 0;
  // Refundable credits can take the result below zero (a refund).
  const taxMinor = afterCredits - jointFilingCredit - childCredit;
  const localTaxMinor = locality ? applyRate(taxable, locality.rate) : 0;
  const marginalRate = taxable === 0 ? 0 : (banded.filter((b) => b.portionMinor > 0).at(-1)?.rate ?? 0) + (locality?.rate ?? 0);
  const lines: ExplainedLine[] = [
    ...(standard ? [{ label: `${name} standard deduction`, amountMinor: standard, rule: rule("incomeTax.standardDeduction") }] : []),
    ...(childDeduction ? [{ label: `${name} child deduction`, amountMinor: childDeduction, rule: rule("incomeTax.childDeduction") }] : []),
    ...(exemption ? [{ label: `${name} exemptions`, amountMinor: exemption, rule: rule("incomeTax.exemption") }] : []),
    ...(ageDeduction ? [{ label: `${name} age deduction`, amountMinor: ageDeduction, rule: rule("incomeTax.ageDeduction") }] : []),
    ...(spouseAdjustment ? [{ label: `${name} spouse tax adjustment`, amountMinor: -spouseAdjustment, rule: rule("incomeTax.spouseAdjustment") }] : []),
    ...(lowIncomeCredit ? [{ label: `${name} credit for low-income individuals`, amountMinor: -Math.min(lowIncomeCredit, beforeCredits), rule: rule("incomeTax.lowIncomeCredit") }] : []),
    ...(federalTaxDeduction ? [{ label: `${name} deduction for federal tax`, amountMinor: federalTaxDeduction, rule: rule("incomeTax.federalTaxDeduction") }] : []),
    ...(renterCredit ? [{ label: `${name} renter's credit`, amountMinor: -renterCredit, rule: rule("incomeTax.renterCredit") }] : []),
    ...(levy ? [{ label: `${name} ${t.wageLevy!.name}`, amountMinor: levy, rule: rule("incomeTax.wageLevy", t.wageLevy!.rate) }] : []),
    ...(twoEarner ? [{ label: `${name} two-income subtraction`, amountMinor: twoEarner, rule: rule("incomeTax.twoEarnerDeduction") }] : []),
    ...(recapture ? [{ label: `${name} supplemental tax (benefit recapture)`, amountMinor: recapture, rule: rule("incomeTax.benefitRecapture") }] : []),
    ...(addBack ? [{ label: `${name} rate phase-out and recapture`, amountMinor: addBack, rule: rule("incomeTax.addBacks") }] : []),
    ...(personalCredit ? [{ label: `${name} personal tax credit`, amountMinor: -personalCredit, rule: rule("incomeTax.personalCreditRateByAgi", personalCreditRate) }] : []),
    ...(twoEarnerCredit ? [{ label: `${name} married couple credit`, amountMinor: -twoEarnerCredit, rule: rule("incomeTax.twoEarnerCredit") }] : []),
    ...(jointFilingCredit ? [{ label: `${name} joint filing credit`, amountMinor: -jointFilingCredit, rule: rule("incomeTax.jointFilingCredit") }] : []),
    ...(childCredit ? [{ label: `${name} child tax credit`, amountMinor: -childCredit, rule: rule("incomeTax.childCredit") }] : []),
    ...(rentDeduction ? [{ label: `${name} renter's deduction`, amountMinor: rentDeduction, rule: rule("incomeTax.rentDeduction") }] : []),
    ...(payrollDeduction ? [{ label: `${name} Social Security and Medicare deduction`, amountMinor: payrollDeduction, rule: rule("incomeTax.payrollTaxDeductionMax") }] : []),
    ...(taxpayerCredit ? [{ label: `${name} taxpayer credit`, amountMinor: -Math.min(taxpayerCredit, beforeCredits), rule: rule("incomeTax.taxpayerCredit") }] : []),
    ...(credit ? [{ label: `${name} exemption credits`, amountMinor: -Math.min(credit, beforeCredits), rule: rule("incomeTax.exemptionCredit") }] : []),
    { label: `${name} income tax`, amountMinor: taxMinor, rule: rule(t.brackets ? `incomeTax.brackets.${status}` : "incomeTax.rate", t.rate) },
    ...(locality ? [{ label: `${locality.name} ${loc!.kind} income tax`, amountMinor: localTaxMinor, rule: { pack: pack.version, key: `localities.${locality.id}`, source: loc!.source, value: locality.rate } }] : []),
  ];
  /** taxMinor is the state's income tax; levyMinor a statewide wage levy; localTaxMinor the chosen locality's. */
  return { pack: pack.version, taxMinor, levyMinor: levy, localTaxMinor, taxableMinor: taxable, marginalRate, lines, notes };
}
