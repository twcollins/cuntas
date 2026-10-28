import { addDays, type IsoDate } from "@cuntas/rules";
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

/** The highest balance an account reached between two dates, in its own currency (end of each day). */
export function maxBalanceBetween(account: Account, transactions: readonly Transaction[], from: IsoDate, to: IsoDate): number {
  if (account.tracksBalance === false) return 0;
  let balance = accountBalance(account, transactions, addDays(from, -1));
  if (VALUED.includes(account.type) && account.valuations.length > 0) {
    const inRange = account.valuations.filter((v) => v.date >= from && v.date <= to).map((v) => v.valueMinor);
    return Math.max(balance, ...inRange);
  }
  const changes = new Map<IsoDate, number>();
  if (account.openingDate >= from && account.openingDate <= to) changes.set(account.openingDate, account.openingBalanceMinor);
  for (const t of transactions) {
    if (t.accountId === account.id && t.bookedAt >= from && t.bookedAt <= to && t.bookedAt >= account.openingDate) changes.set(t.bookedAt, (changes.get(t.bookedAt) ?? 0) + t.amountMinor);
  }
  let max = balance;
  for (const day of [...changes.keys()].sort()) {
    balance += changes.get(day)!;
    max = Math.max(max, balance);
  }
  return max;
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
