import { applyRate, chartDefaults, formatRate, onDate, pensionReliefHeadroom, type ChartDefaults, type IePack, type RulePack, type UsPack } from "@cuntas/rules";
import { US_STEPS, usOptions } from "./steps/us";
import { IE_STEPS } from "./steps/ie";
import { money, render } from "./helpers";
import type {
  CheckDefinition,
  CheckStatus,
  EngineResult,
  EvalContext,
  HouseholdSnapshot,
  LadderRow,
  MemberState,
  NextStepCard,
  OptionCard,
  StepDefinition,
} from "./types";

export const DISCLAIMER = "This is information, not financial advice. It explains rules and ranks generic steps; it never recommends a product or provider.";

function isDismissed(s: HouseholdSnapshot, checkId: string, member?: MemberState): boolean {
  return s.dismissed.some((d) => (d.stepId === checkId || checkId.startsWith(`${d.stepId}.`)) && (!d.memberId || d.memberId === member?.id));
}

function toCard<P extends RulePack>(step: StepDefinition<P>, check: CheckDefinition<P>, ctx: EvalContext<P>): NextStepCard {
  const vars = check.vars(ctx);
  const deadline = check.deadline?.(ctx);
  return {
    step: step.id,
    check: check.id,
    order: step.order,
    title: check.title,
    ...(ctx.member ? { member: ctx.member.id, memberName: ctx.member.name } : {}),
    headline: render(check.headline, vars),
    why: render(check.explain, vars),
    ...(deadline ? { deadline } : {}),
    rulePack: ctx.pack.version,
    chart: ctx.chart.version,
    sources: check.sources(ctx),
    progress: check.progress(ctx),
    jurisdictions: step.jurisdictions,
    actions: check.actions,
    alwaysOn: !!step.alwaysOn,
  };
}

function options(ctx: EvalContext): OptionCard[] {
  const s = ctx.snapshot;
  const p = ctx.pack;
  const out: OptionCard[] = [
    { id: "discretionary", title: "More discretionary spending", detail: "Every earlier step is met, so spending more on what you value is a valid choice." },
  ];
  for (const m of s.members.filter((x) => x.grossAnnualMinor > 0)) {
    const h = pensionReliefHeadroom(p, {
      age: m.age,
      earningsMinor: m.grossAnnualMinor,
      contributedMinor: applyRate(m.grossAnnualMinor, m.pension.employeeRate),
      marginalRate: m.marginalRate,
    });
    if (h.headroomMinor > 0) {
      out.push({
        id: `max-pension:${m.id}`,
        title: `${m.name}: use remaining pension relief`,
        detail: `${money(ctx, h.headroomMinor)} of unused relief for ${p.taxYear} (limit ${formatRate(h.limitRate)} of earnings) is worth ${money(ctx, h.taxBackMinor)} back at ${formatRate(m.marginalRate)}. Claim by ${h.deadline}.` +
          (m.marginalRate >= p.incomeTax.rates.higher ? " As a higher-rate taxpayer, keeping pension ahead of deposit saving is a reasonable choice." : ""),
      });
    }
  }
  const exit = onDate(p.exitTax.rates, s.asOf < p.effective.from ? p.effective.from : s.asOf).rate;
  const cgt = onDate(p.cgt.rates, s.asOf < p.effective.from ? p.effective.from : s.asOf).rate;
  out.push({
    id: "save-or-invest",
    title: "Savings for near goals, investments for far ones",
    detail: `For goals within ${ctx.chart.goals.savingsHorizonYears} years, deposit savings (DIRT ${formatRate(p.dirt.rate)}); beyond that, investing. ` +
      `Funds and ETFs pay exit tax at ${formatRate(exit)} with deemed disposal every ${p.exitTax.deemedDisposalYears} years; directly held shares pay CGT at ${formatRate(cgt)} after a €${p.cgt.annualExemption} exemption.` +
      (p.investmentAccount ? ` The Investment Account (from ${p.investmentAccount.from}) charges ${formatRate(p.investmentAccount.annualChargeRate)} a year only on value above €${p.investmentAccount.taxFreeValue.toLocaleString("en-IE")}.` : "") +
      pficNote(s.members.filter((m) => m.usCitizen && m.residence !== "US").map((m) => m.name)),
  });
  if (s.housing.ownsHome && s.housing.mortgageMonthlyPaymentMinor) {
    out.push({
      id: "overpay-mortgage",
      title: "Overpay the mortgage",
      detail: `Overpaying by about ${formatRate(s.thresholds.mortgageOverpayRate)} would be ${money(ctx, applyRate(s.housing.mortgageMonthlyPaymentMinor, s.thresholds.mortgageOverpayRate))} a month. Compare the mortgage rate with after-tax investment returns.`,
    });
  }
  return out;
}

/** US citizens living in Ireland or the UK: funds domiciled there are PFICs for US tax. */
function pficNote(names: string[]): string {
  if (names.length === 0) return "";
  const who = names.length === 1 ? `${names[0]} is a US citizen` : `${names.slice(0, -1).join(", ")} and ${names.at(-1)} are US citizens`;
  return ` ${who}: for US tax, Irish and UK funds and ETFs are PFICs, which need Form 8621 every year and, without an election, have gains taxed at the top rate plus an interest charge. Shares held directly are not PFICs.`;
}

/** Evaluates the Irish ladder (also used for UK and mixed households). Output is a pure function of the snapshot, rule pack and chart defaults. */
export function evaluate(
  snapshot: HouseholdSnapshot,
  pack: IePack,
  chart: ChartDefaults = chartDefaults(),
  steps: readonly StepDefinition[] = IE_STEPS,
): EngineResult {
  return runLadder(snapshot, pack, chart, steps, options);
}

/** Evaluates the US ladder, for a household where everyone lives in the US. */
export function evaluateUs(
  snapshot: HouseholdSnapshot,
  pack: UsPack,
  chart: ChartDefaults = chartDefaults("US"),
  steps: readonly StepDefinition<UsPack>[] = US_STEPS,
): EngineResult {
  return runLadder(snapshot, pack, chart, steps, usOptions);
}

function runLadder<P extends RulePack>(
  snapshot: HouseholdSnapshot,
  pack: P,
  chart: ChartDefaults,
  steps: readonly StepDefinition<P>[],
  optionsFor: (ctx: EvalContext<P>) => OptionCard[],
): EngineResult {
  const ladder: LadderRow[] = [];
  let current: NextStepCard | null = null;
  const alwaysOn: NextStepCard[] = [];

  for (const step of [...steps].sort((a, b) => a.order - b.order)) {
    const targets: (MemberState | undefined)[] = step.scope === "member" ? snapshot.members : [undefined];
    const row: LadderRow = { step: step.id, order: step.order, title: step.title, chartRule: step.chartRule, jurisdictions: step.jurisdictions, status: "not-applicable", checks: [] };
    let stepUnmetCard: NextStepCard | null = null;

    for (const member of targets) {
      const ctx: EvalContext<P> = { snapshot, member, pack, chart };
      if (step.appliesWhen && !step.appliesWhen(ctx)) continue;
      let blocked = false; // sub-checks are ordered: later ones wait for earlier ones
      for (const check of step.checks) {
        if (check.appliesWhen && !check.appliesWhen(ctx)) continue;
        const base = { check: check.id, title: check.title, ...(member ? { member: member.id, memberName: member.name } : {}) };
        if (isDismissed(snapshot, check.id, member)) {
          row.checks.push({ ...base, status: "dismissed" });
          continue;
        }
        const met = check.isMet(ctx);
        const status: CheckStatus = met ? "met" : "unmet";
        row.checks.push({ ...base, status, progress: check.progress(ctx) });
        if (!met && !blocked) {
          blocked = true;
          stepUnmetCard ??= toCard(step, check, ctx);
          if (step.alwaysOn) {
            const card = toCard(step, check, ctx);
            if (!alwaysOn.some((c) => c.check === card.check && c.member === card.member)) alwaysOn.push(card);
          }
        }
      }
    }

    const evaluated = row.checks.filter((c) => c.status === "met" || c.status === "unmet");
    row.status = evaluated.length === 0 ? "not-applicable" : evaluated.some((c) => c.status === "unmet") ? "unmet" : "met";
    ladder.push(row);
    if (!current && stepUnmetCard && !step.alwaysOn) current = stepUnmetCard;
  }

  // An always-on card that is also the first unmet step shows once, as the current step.
  const ctx: EvalContext<P> = { snapshot, pack, chart };
  return {
    current,
    alwaysOn,
    ladder,
    options: current ? [] : optionsFor(ctx),
    rulePack: pack.version,
    chart: chart.version,
    disclaimer: DISCLAIMER,
  };
}
