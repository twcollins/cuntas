import { daysBetween } from "@cuntas/rules";
import type { FxTable } from "./fx";
import type { Transaction } from "./schema";

export interface TransferMatchOptions {
  windowDays: number;
  /** Allowed relative difference for cross-currency pairs (covers provider FX spread). */
  crossCurrencyTolerance: number;
}

export const DEFAULT_TRANSFER_OPTIONS: TransferMatchOptions = { windowDays: 3, crossCurrencyTolerance: 0.03 };

/**
 * Pairs outflows with inflows in other accounts so internal transfers are not counted as spending or income.
 * Same-currency pairs must match exactly; EUR-GBP pairs match within a tolerance at the ECB rate.
 * Existing pairs are kept. Returns a new transaction list.
 */
export function matchTransfers(
  transactions: readonly Transaction[],
  fx: FxTable,
  options: TransferMatchOptions = DEFAULT_TRANSFER_OPTIONS,
): Transaction[] {
  const out = transactions.map((t) => ({ ...t }));
  const byId = new Map(out.map((t) => [t.id, t]));
  const free = (t: Transaction) => t.transferPairId === null || !byId.has(t.transferPairId);
  const inflows = out.filter((t) => t.amountMinor > 0).sort((a, b) => a.bookedAt.localeCompare(b.bookedAt));
  const outflows = out.filter((t) => t.amountMinor < 0).sort((a, b) => a.bookedAt.localeCompare(b.bookedAt));

  for (const o of outflows) {
    if (!free(o)) continue;
    let best: { t: Transaction; score: number } | undefined;
    for (const i of inflows) {
      if (!free(i) || i.accountId === o.accountId) continue;
      const gap = Math.abs(daysBetween(o.bookedAt, i.bookedAt));
      if (gap > options.windowDays) continue;
      let diff: number;
      if (i.currency === o.currency) {
        if (i.amountMinor !== -o.amountMinor) continue;
        diff = 0;
      } else {
        const converted = fx.tryConvert(-o.amountMinor, o.currency, i.currency, o.bookedAt);
        if (converted === null) continue;
        diff = Math.abs(converted - i.amountMinor) / i.amountMinor;
        if (diff > options.crossCurrencyTolerance) continue;
      }
      const score = gap + diff * 100;
      if (!best || score < best.score) best = { t: i, score };
    }
    if (best) {
      o.transferPairId = best.t.id;
      best.t.transferPairId = o.id;
    }
  }
  return out;
}

export const isTransfer = (t: Transaction) => t.transferPairId !== null;
