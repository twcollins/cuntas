import type { IsoDate } from "@cuntas/rules";
import { reconcile, withAudit } from "./dataset";
import { FxTable } from "./fx";
import { newId } from "./ids";
import { topCategories } from "./manual";
import { cleanMerchant } from "./merchant";
import type { Dataset, Transaction } from "./schema";
import { baseAmount } from "./spending";

// The review queue: uncategorised rows grouped by merchant, so one decision files many rows.

export interface ReviewGroup {
  /** Lower-case cleaned merchant name; also what a rule made from the group matches. */
  key: string;
  name: string;
  /** The bank's text for the earliest row, to show what the name was cleaned from. */
  example: string;
  /** Whether the group is, net, money in or money out. */
  direction: "in" | "out";
  count: number;
  /** Net amount, in base currency, as a positive number. */
  totalMinor: number;
  start: IsoDate;
  end: IsoDate;
  transactionIds: string[];
  /** Category ids to offer as one-tap choices. */
  suggestions: string[];
}

const merchantKey = (t: Transaction) => cleanMerchant(t.payee || t.rawDescription).toLowerCase();

/** A row waits for review when it has no category, no split and isn't one side of a transfer. */
export const needsReview = (t: Transaction) => t.categoryId === null && t.splits.length === 0 && t.transferPairId === null && t.amountMinor !== 0;

/** Uncategorised rows grouped by cleaned merchant, largest total first. */
export function reviewQueue(ds: Dataset, asOf: IsoDate, chips = 4): ReviewGroup[] {
  const fx = new FxTable(ds.fxRates);
  const base = ds.household.baseCurrency;
  const groups = new Map<string, { name: string; rows: Transaction[]; net: number }>();
  for (const t of ds.transactions) {
    if (!needsReview(t)) continue;
    const key = merchantKey(t);
    const g = groups.get(key) ?? { name: cleanMerchant(t.payee || t.rawDescription), rows: [], net: 0 };
    g.rows.push(t);
    g.net += baseAmount(t, base, fx);
    groups.set(key, g);
  }
  const spend = topCategories(ds, "expense", chips, asOf);
  const income = topCategories(ds, "income", chips, asOf);
  return [...groups.entries()]
    .map(([key, g]): ReviewGroup => {
      const rows = [...g.rows].sort((a, b) => a.bookedAt.localeCompare(b.bookedAt));
      const direction = g.net > 0 ? "in" : "out";
      return {
        key,
        name: g.name,
        example: rows[0]!.rawDescription || rows[0]!.payee,
        direction,
        count: rows.length,
        totalMinor: Math.abs(g.net),
        start: rows[0]!.bookedAt,
        end: rows[rows.length - 1]!.bookedAt,
        transactionIds: rows.map((t) => t.id),
        suggestions: direction === "in" ? income : spend,
      };
    })
    .sort((a, b) => b.totalMinor - a.totalMinor || b.count - a.count || a.key.localeCompare(b.key));
}

/** How many rows wait for review. */
export const reviewCount = (ds: Dataset) => ds.transactions.filter(needsReview).length;

/** What filing a group changed, so it can be undone. */
export interface FileUndo {
  ruleId: string | null;
  /** Each changed row's category before and after filing. */
  rows: { id: string; before: Pick<Transaction, "categoryId" | "categorySource">; after: Pick<Transaction, "categoryId" | "categorySource"> }[];
}

/**
 * Files every row in the group under a category, as the user's choice. With `rule`, also adds a
 * rule for the merchant (unless one already says the same), which files the next import's rows too.
 */
export function fileGroup(ds: Dataset, group: Pick<ReviewGroup, "key" | "transactionIds">, categoryId: string, opts: { rule: boolean }): { dataset: Dataset; undo: FileUndo } {
  const ids = new Set(group.transactionIds);
  let rules = ds.categoryRules;
  let ruleId: string | null = null;
  if (opts.rule && group.key.length >= 3 && !rules.some((r) => r.match.payeeContains === group.key && r.categoryId === categoryId)) {
    ruleId = newId("rule");
    rules = [...rules, { id: ruleId, match: { payeeContains: group.key }, categoryId, priority: 10 }];
  }
  const filed = ds.transactions.map((t) => (ids.has(t.id) ? { ...t, categoryId, categorySource: "user" as const } : t));
  const next = reconcile({ ...ds, categoryRules: rules, transactions: filed });
  const before = new Map(ds.transactions.map((t) => [t.id, t]));
  const rows: FileUndo["rows"] = [];
  for (const t of next.transactions) {
    const b = before.get(t.id);
    if (b && (b.categoryId !== t.categoryId || b.categorySource !== t.categorySource)) {
      rows.push({ id: t.id, before: { categoryId: b.categoryId, categorySource: b.categorySource }, after: { categoryId: t.categoryId, categorySource: t.categorySource } });
    }
  }
  return { dataset: withAudit(next, "user", "review:file", `category:${categoryId}`), undo: { ruleId, rows } };
}

/** Reverses a filing: removes its rule and puts back rows that nothing else has changed since. */
export function undoFile(ds: Dataset, undo: FileUndo): Dataset {
  const rows = new Map(undo.rows.map((r) => [r.id, r]));
  const transactions = ds.transactions.map((t) => {
    const r = rows.get(t.id);
    if (!r || t.categoryId !== r.after.categoryId || t.categorySource !== r.after.categorySource) return t;
    return { ...t, ...r.before };
  });
  const categoryRules = undo.ruleId ? ds.categoryRules.filter((r) => r.id !== undo.ruleId) : ds.categoryRules;
  return withAudit({ ...ds, categoryRules, transactions }, "user", "review:undo", "category");
}
