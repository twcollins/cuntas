import { toMinor } from "../../money";
import type { UkPack } from "../../packs";

export type IsaType = "cash" | "stocksAndShares" | "lifetime" | "innovativeFinance";

export interface IsaSubscriptions {
  cash: number;
  stocksAndShares: number;
  lifetime: number;
  innovativeFinance: number;
}

export interface IsaCheck {
  allowed: boolean;
  reasons: string[];
  totalRemainingMinor: number;
  cashRemainingMinor: number | null;
  lifetimeRemainingMinor: number;
}

/**
 * Checks a proposed ISA subscription against the year's subscriptions so far.
 * From April 2027 under-65s may put at most the cash cap into cash ISAs.
 */
export function ukIsaCheck(
  pack: UkPack,
  input: { age: number; subscribed: IsaSubscriptions; proposed?: { type: IsaType; amountMinor: number } },
): IsaCheck {
  const isa = pack.isa;
  const after = { ...input.subscribed };
  if (input.proposed) after[input.proposed.type] += input.proposed.amountMinor;
  const total = after.cash + after.stocksAndShares + after.lifetime + after.innovativeFinance;
  const reasons: string[] = [];

  const totalLimit = toMinor(isa.annualAllowance);
  if (total > totalLimit) reasons.push(`Total subscriptions would exceed the ${isa.annualAllowance} allowance for ${pack.taxYear}.`);

  const lisaLimit = toMinor(isa.lifetimeIsaLimit);
  if (after.lifetime > lisaLimit) reasons.push(`Lifetime ISA subscriptions are limited to ${isa.lifetimeIsaLimit}.`);

  let cashLimit: number | null = null;
  if (isa.cashCap && input.age < isa.cashCap.appliesUnderAge) {
    cashLimit = toMinor(isa.cashCap.limit);
    if (after.cash > cashLimit) {
      reasons.push(`Under ${isa.cashCap.appliesUnderAge}, cash ISA subscriptions are capped at ${isa.cashCap.limit} from ${pack.taxYear}.`);
    }
  }

  return {
    allowed: reasons.length === 0,
    reasons,
    totalRemainingMinor: Math.max(0, totalLimit - total),
    cashRemainingMinor: cashLimit === null ? null : Math.max(0, Math.min(cashLimit - after.cash, totalLimit - total)),
    lifetimeRemainingMinor: Math.max(0, Math.min(lisaLimit - after.lifetime, totalLimit - total)),
  };
}

/** Whether moving money from a stocks and shares ISA to a cash ISA is allowed. */
export function ukIsaTransferAllowed(pack: UkPack, input: { age: number; from: IsaType; to: IsaType }): boolean {
  const blockAge = pack.isa.stocksToCashTransferBlockedUnderAge;
  if (blockAge === undefined) return true;
  return !(input.from === "stocksAndShares" && input.to === "cash" && input.age < blockAge);
}
