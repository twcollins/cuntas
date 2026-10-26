import { addMonths, COUNTRIES, COUNTRY_INFO, type IsoDate } from "@cuntas/rules";
import { categorise, payeeKey } from "./categories";
import { reconcile, withAudit } from "./dataset";
import { FxTable } from "./fx";
import { newId } from "./ids";
import type { Account, Dataset, Transaction } from "./schema";

// Quick add: spending, income and moves entered by hand, without a statement.

export interface ManualEntry {
  kind: "spent" | "received" | "moved";
  /** Positive; the sign comes from `kind`. */
  amountMinor: number;
  date: IsoDate;
  /** The account paid from (or into); null means the Cash account, created on first use. */
  accountId: string | null;
  /** For a move: the account the money went to. */
  toAccountId?: string | null;
  payee?: string;
  categoryId?: string | null;
  notes?: string;
  /** Also add a monthly bill for it. */
  monthly?: boolean;
}

export interface ManualResult {
  dataset: Dataset;
  transactionIds: string[];
  /** The account the entry was recorded on (the Cash account if it was just created). */
  accountId: string;
  billId: string | null;
}

/** The household's quick-add Cash account, if it has one. */
export function cashAccount(ds: Dataset): Account | undefined {
  return ds.accounts.find((a) => a.type === "cash" && a.tracksBalance === false && !a.archived);
}

function withCashAccount(ds: Dataset, date: IsoDate): { dataset: Dataset; account: Account } {
  const existing = cashAccount(ds);
  if (existing) return { dataset: ds, account: existing };
  const base = ds.household.baseCurrency;
  const account: Account = {
    id: newId("acc"),
    name: "Cash",
    memberIds: ds.members.map((m) => m.id),
    type: "cash",
    currency: base,
    institutionId: null,
    wrapper: "none",
    jurisdiction: COUNTRIES.find((c) => COUNTRY_INFO[c].currency === base) ?? "IE",
    openingBalanceMinor: 0,
    openingDate: date < "2000-01-01" ? date : "2000-01-01",
    valuations: [],
    isEmergencyFund: false,
    archived: false,
    tracksBalance: false,
  };
  return { dataset: { ...ds, accounts: [...ds.accounts, account] }, account };
}

function row(ds: Dataset, account: Account, amountMinor: number, e: ManualEntry, fx: FxTable): Transaction {
  const id = newId("tx");
  const payee = e.payee?.trim() ?? "";
  return {
    id,
    accountId: account.id,
    bookedAt: e.date,
    amountMinor,
    currency: account.currency,
    fxRateToBase: account.currency === ds.household.baseCurrency ? null : (fx.rate(account.currency, ds.household.baseCurrency, e.date) ?? null),
    payee,
    rawDescription: payee,
    externalId: `manual:${id}`,
    categoryId: e.categoryId ?? null,
    categorySource: e.categoryId ? "user" : "none",
    transferPairId: null,
    splits: [],
    notes: e.notes ?? "",
    source: "manual",
  };
}

export function addManualTransaction(ds: Dataset, e: ManualEntry): ManualResult {
  if (!Number.isInteger(e.amountMinor) || e.amountMinor <= 0) throw new Error("Amount must be more than zero.");
  const fx = new FxTable(ds.fxRates);
  const from = e.accountId === null ? withCashAccount(ds, e.date) : { dataset: ds, account: ds.accounts.find((a) => a.id === e.accountId) };
  if (!from.account) throw new Error(`Unknown account ${e.accountId}`);
  let next = from.dataset;
  const account = from.account;
  const added: Transaction[] = [];
  if (e.kind === "moved") {
    const to = next.accounts.find((a) => a.id === e.toAccountId);
    if (!to) throw new Error("Choose the account the money went to.");
    if (to.id === account.id) throw new Error("A move needs two different accounts.");
    const out = row(next, account, -e.amountMinor, { ...e, categoryId: null }, fx);
    const inn = row(next, to, e.amountMinor, { ...e, categoryId: null }, fx);
    out.transferPairId = inn.id;
    inn.transferPairId = out.id;
    added.push(out, inn);
  } else {
    added.push(row(next, account, e.kind === "spent" ? -e.amountMinor : e.amountMinor, e, fx));
  }
  next = reconcile({ ...next, transactions: [...next.transactions, ...added] });

  let billId: string | null = null;
  if (e.monthly && e.kind !== "moved") {
    billId = newId("bill");
    const recorded = next.transactions.find((t) => t.id === added[0]!.id);
    const name = e.payee?.trim() || "Monthly payment";
    next = { ...next, bills: [...next.bills, { id: billId, name, template: null, cadence: "monthly", amountMinor: e.amountMinor, currency: account.currency, nextDue: addMonths(e.date, 1), categoryId: recorded?.categoryId ?? null, payeeKey: e.payee?.trim() ? payeeKey(e.payee) : null }] };
  }
  return { dataset: withAudit(next, "user", `manual:${e.kind}`, `account:${account.id}`), transactionIds: added.map((t) => t.id), accountId: account.id, billId };
}

/** Deletes a hand-entered row; for a hand-entered move, both sides. Imported rows can't be deleted. */
export function removeManualTransaction(ds: Dataset, id: string): Dataset {
  const t = ds.transactions.find((x) => x.id === id);
  if (!t || t.source !== "manual") throw new Error("Only transactions added by hand can be deleted.");
  const pair = ds.transactions.find((x) => x.id === t.transferPairId);
  const gone = new Set([id, ...(pair?.source === "manual" ? [pair.id] : [])]);
  const rest = ds.transactions.filter((x) => !gone.has(x.id)).map((x) => (x.transferPairId && gone.has(x.transferPairId) ? { ...x, transferPairId: null } : x));
  return withAudit(reconcile({ ...ds, transactions: rest }), "user", "manual:delete", `transaction:${id}`);
}

/** Category ids to offer as one-tap chips: the most used in the last six months, topped up with common ones. */
export function topCategories(ds: Dataset, kind: "expense" | "income", count: number, asOf: IsoDate): string[] {
  const since = addMonths(asOf, -6);
  const valid = new Set(ds.categories.filter((c) => c.kind === kind).map((c) => c.id));
  const uses = new Map<string, number>();
  for (const t of ds.transactions) {
    if (t.bookedAt < since || !t.categoryId || !valid.has(t.categoryId) || t.transferPairId) continue;
    uses.set(t.categoryId, (uses.get(t.categoryId) ?? 0) + 1);
  }
  const used = [...uses.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const common = kind === "expense" ? ["cat_groceries", "cat_eating_out", "cat_commute", "cat_shopping", "cat_entertainment", "cat_toiletries", "cat_other"] : ["cat_salary", "cat_other_income"];
  return [...new Set([...used, ...common.filter((id) => valid.has(id))])].slice(0, count);
}

/** The category for a payee typed in quick add: the last one used for that payee, else rules and the dictionary. */
export function suggestCategory(ds: Dataset, payee: string): string | null {
  const key = payeeKey(payee);
  if (key.length < 2) return null;
  const past = [...ds.transactions].reverse().find((t) => t.categoryId && t.categorySource === "user" && payeeKey(t.payee) === key);
  if (past) return past.categoryId;
  return categorise({ payee, rawDescription: payee, amountMinor: -1, accountId: "" }, ds.categoryRules).categoryId;
}
