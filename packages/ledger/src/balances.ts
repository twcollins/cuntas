import type { IsoDate } from "@cuntas/rules";
import type { Account, Dataset, Transaction } from "./schema";
import { LIABILITY_TYPES } from "./schema";

const VALUED: readonly Account["type"][] = ["property", "vehicle", "pension", "brokerage", "other"];

export function latestValuation(account: Account, asOf: IsoDate) {
  return [...account.valuations].filter((v) => v.date <= asOf).sort((a, b) => b.date.localeCompare(a.date))[0];
}

/** Balance in the account's own currency. Liabilities are negative. */
export function accountBalance(account: Account, transactions: readonly Transaction[], asOf: IsoDate): number {
  if (account.tracksBalance === false) return 0;
  if (VALUED.includes(account.type) && account.valuations.length > 0) {
    return latestValuation(account, asOf)?.valueMinor ?? 0;
  }
  let balance = account.openingDate <= asOf ? account.openingBalanceMinor : 0;
  for (const t of transactions) {
    if (t.accountId === account.id && t.bookedAt <= asOf && t.bookedAt >= account.openingDate) balance += t.amountMinor;
  }
  return balance;
}

export function balancesByAccount(ds: Dataset, asOf: IsoDate): Map<string, number> {
  const byAccount = new Map<string, Transaction[]>();
  for (const t of ds.transactions) {
    const list = byAccount.get(t.accountId) ?? [];
    list.push(t);
    byAccount.set(t.accountId, list);
  }
  return new Map(ds.accounts.map((a) => [a.id, accountBalance(a, byAccount.get(a.id) ?? [], asOf)]));
}

export const isLiability = (a: Account) => LIABILITY_TYPES.includes(a.type);
