import { applyRate, toMinor } from "../../money";
import { deadlineFor, type IsoDate } from "../../dates";
import type { IePack, RuleRef } from "../../packs";

export function ageBandRate(pack: IePack, age: number): { rate: number; minAge: number } {
  const band = [...pack.pension.ageBands].sort((a, b) => b.minAge - a.minAge).find((b) => age >= b.minAge);
  if (!band) throw new Error(`No pension age band for age ${age}`);
  return band;
}

/** Maximum personal contribution that gets tax relief: age-band % of earnings capped at the earnings limit. */
export function pensionReliefLimit(pack: IePack, age: number, earningsMinor: number) {
  const { rate } = ageBandRate(pack, age);
  const cappedEarningsMinor = Math.min(earningsMinor, toMinor(pack.pension.earningsCap));
  const limitMinor = applyRate(cappedEarningsMinor, rate);
  const rules: RuleRef[] = [
    { pack: pack.version, key: "pension.ageBands", source: pack.pension.source, value: rate },
    { pack: pack.version, key: "pension.earningsCap", source: pack.pension.source, value: pack.pension.earningsCap },
  ];
  return { rate, cappedEarningsMinor, limitMinor, rules };
}

export interface PensionHeadroomInput {
  age: number;
  earningsMinor: number;
  /** Personal contributions already made for the tax year (excluding MyFutureFund, which gets no relief). */
  contributedMinor: number;
  marginalRate: number;
}

export interface PensionHeadroom {
  limitMinor: number;
  limitRate: number;
  contributedMinor: number;
  contributedRate: number;
  headroomMinor: number;
  taxBackMinor: number;
  deadline: IsoDate;
  rules: RuleRef[];
}

/** Unused age-band relief for the tax year and its value at the marginal rate. */
export function pensionReliefHeadroom(pack: IePack, input: PensionHeadroomInput): PensionHeadroom {
  const limit = pensionReliefLimit(pack, input.age, input.earningsMinor);
  const headroomMinor = Math.max(0, limit.limitMinor - input.contributedMinor);
  return {
    limitMinor: limit.limitMinor,
    limitRate: limit.rate,
    contributedMinor: input.contributedMinor,
    contributedRate: input.earningsMinor > 0 ? input.contributedMinor / input.earningsMinor : 0,
    headroomMinor,
    taxBackMinor: applyRate(headroomMinor, input.marginalRate),
    deadline: deadlineFor(Number(pack.taxYear), pack.pension.reliefClaimDeadline),
    rules: limit.rules,
  };
}
