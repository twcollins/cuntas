import type { ColumnMapping, ParsedStatement } from "@cuntas/importers";
import { COUNTRIES, COUNTRY_INFO, type Currency, type IsoDate, type Jurisdiction } from "@cuntas/rules";
import { importStatement, sameAccountNumber } from "./dataset";
import { FxTable } from "./fx";
import { newId } from "./ids";
import type { Account, Dataset, ImportMapping } from "./schema";
import { baseAmount, categoryMap, isCashflow } from "./spending";

// Importing several statement files at once: which account each file goes into, then one summary.

export interface NewAccountSpec {
  name: string;
  type: "current" | "creditCard";
  currency: Currency;
  /** Country of the new account; by default the one whose currency it is. */
  jurisdiction?: Jurisdiction;
}

export type AccountGuess = { accountId: string; reason: "number" | "preset" | "name" } | ({ accountId: null; reason: "new" } & NewAccountSpec);

const statementCurrency = (ds: Dataset, s: ParsedStatement): Currency => s.account?.currency ?? s.transactions[0]?.currency ?? ds.household.baseCurrency;

/**
 * The account a statement most likely belongs to: one whose earlier imports had the same account
 * number or IBAN; else one that last took a file in the same bank layout (when the file names no
 * other number); else a new account named after the bank, typed and priced from the file.
 */
export function guessAccount(ds: Dataset, statement: ParsedStatement, bankName?: string, fileName?: string): AccountGuess {
  const currency = statementCurrency(ds, statement);
  const open = ds.accounts.filter((a) => !a.archived && a.currency === currency && a.importHints);
  const numbers = [statement.account?.number, statement.account?.iban].filter((n): n is string => !!n);
  const byNumber = open.find((a) => a.importHints!.numbers.some((x) => numbers.some((n) => sameAccountNumber(x, n))));
  if (byNumber) return { accountId: byNumber.id, reason: "number" };
  if (statement.preset) {
    const byPreset = open
      .filter((a) => a.importHints!.presets.includes(statement.preset!))
      .filter((a) => numbers.length === 0 || a.importHints!.numbers.length === 0)
      .sort((a, b) => b.importHints!.lastImportAt.localeCompare(a.importHints!.lastImportAt))[0];
    if (byPreset) return { accountId: byPreset.id, reason: "preset" };
  }
  // Accounts from before imports were remembered: one of the same kind named after the bank.
  const bank = bankName?.replace(/\s*\(.*\)$/, "").toLowerCase();
  if (bank) {
    const institutions = new Map(ds.institutions.map((i) => [i.id, i.name.toLowerCase()]));
    const byName = ds.accounts.find(
      (a) => !a.archived && !a.importHints && a.currency === currency && a.type === (statement.account?.type ?? "current") && (a.name.toLowerCase().includes(bank) || (a.institutionId !== null && institutions.get(a.institutionId) === bank)),
    );
    if (byName) return { accountId: byName.id, reason: "name" };
  }
  const tail = numbers[0]?.replace(/\D/g, "").slice(-4);
  const base = bankName ?? (fileName ? fileName.replace(/\.\w+$/, "") : "Imported account");
  return { accountId: null, reason: "new", name: tail ? `${base} ··${tail}` : base, type: statement.account?.type ?? "current", currency };
}

export interface ImportFileInput {
  name: string;
  statement: ParsedStatement;
  bankName?: string;
}

export interface ImportItem {
  statement: ParsedStatement;
  /** An existing account id, or a new account to create. Files naming the same new account share it. */
  target: string | { new: NewAccountSpec };
}

/** A target for each file. Files with the same new-account name share one account when imported. */
export function planImports(ds: Dataset, files: ImportFileInput[]): (ImportFileInput & { target: ImportItem["target"]; reason: AccountGuess["reason"] })[] {
  return files.map((f) => {
    const g = guessAccount(ds, f.statement, f.bankName, f.name);
    return { ...f, reason: g.reason, target: g.accountId ?? { new: { name: g.name, type: g.type, currency: g.currency } } };
  });
}

export interface ImportSummary {
  files: number;
  added: number;
  merged: number;
  skipped: number;
  /** Transfer pairs found among the added rows. */
  transfers: number;
  /** Added spending and income rows with a category, and without one. Transfers are in neither. */
  categorised: number;
  uncategorised: number;
  /** Spending in the added rows, in base currency. */
  spentMinor: number;
  /** Dates the added rows cover; null when nothing was added. */
  start: IsoDate | null;
  end: IsoDate | null;
  warnings: string[];
}

const countryOf = (currency: Currency): Jurisdiction => COUNTRIES.find((c) => COUNTRY_INFO[c].currency === currency) ?? "IE";

/** Imports several statements in one go, creating new accounts as planned, and sums up what happened. */
export function applyImports(ds: Dataset, items: ImportItem[], at = new Date().toISOString()): { dataset: Dataset; summary: ImportSummary; accountIds: string[] } {
  let d = ds;
  const created = new Map<string, string>();
  const accountIds: string[] = [];
  const addedIds = new Set<string>();
  const summary: ImportSummary = { files: items.length, added: 0, merged: 0, skipped: 0, transfers: 0, categorised: 0, uncategorised: 0, spentMinor: 0, start: null, end: null, warnings: [] };
  for (const item of items) {
    let accountId: string;
    if (typeof item.target === "string") accountId = item.target;
    else {
      const spec = item.target.new;
      const key = `${spec.name}|${spec.currency}`;
      accountId = created.get(key) ?? "";
      if (!accountId) {
        const first = item.statement.transactions.map((t) => t.bookedAt).sort()[0] ?? at.slice(0, 10);
        const account: Account = {
          id: newId("acc"),
          name: spec.name,
          memberIds: d.members.map((m) => m.id),
          type: spec.type,
          currency: spec.currency,
          institutionId: null,
          wrapper: "none",
          jurisdiction: spec.jurisdiction ?? countryOf(spec.currency),
          openingBalanceMinor: 0,
          openingDate: first,
          valuations: [],
          isEmergencyFund: false,
          archived: false,
        };
        d = { ...d, accounts: [...d.accounts, account] };
        accountId = account.id;
        created.set(key, accountId);
      }
    }
    const r = importStatement(d, accountId, item.statement, at);
    d = r.dataset;
    if (!accountIds.includes(accountId)) accountIds.push(accountId);
    r.addedIds.forEach((id) => addedIds.add(id));
    summary.added += r.added;
    summary.merged += r.merged;
    summary.skipped += r.skipped;
    summary.warnings.push(...r.warnings);
  }

  const cats = categoryMap(d);
  const fx = new FxTable(d.fxRates);
  const pairs = new Set<string>();
  for (const t of d.transactions) {
    if (!addedIds.has(t.id)) continue;
    if (t.transferPairId !== null) pairs.add([t.id, t.transferPairId].sort().join("|"));
    else if (isCashflow(t, cats)) {
      if (t.categoryId === null && t.splits.length === 0) summary.uncategorised++;
      else summary.categorised++;
      const kind = t.categoryId ? cats.get(t.categoryId)?.kind : undefined;
      if (t.amountMinor < 0 && kind !== "income") summary.spentMinor -= baseAmount(t, d.household.baseCurrency, fx);
    }
    if (summary.start === null || t.bookedAt < summary.start) summary.start = t.bookedAt;
    if (summary.end === null || t.bookedAt > summary.end) summary.end = t.bookedAt;
  }
  summary.transfers = pairs.size;
  return { dataset: d, summary, accountIds };
}

/** Keeps the user's column mapping for a CSV header row, replacing any earlier one. */
export function rememberMapping(ds: Dataset, headerKey: string, mapping: ColumnMapping): Dataset {
  const { date, dateFormat, amount, debit, credit, description, defaultCurrency, decimalComma } = mapping;
  const kept: ImportMapping = {
    headerKey,
    mapping: { date, dateFormat, description, defaultCurrency, ...(amount ? { amount } : {}), ...(debit ? { debit } : {}), ...(credit ? { credit } : {}), ...(decimalComma ? { decimalComma } : {}) },
  };
  return { ...ds, importMappings: [...ds.importMappings.filter((m) => m.headerKey !== headerKey), kept] };
}

/** The mapping the user made last time for this header row, if any. */
export function mappingFor(ds: Dataset, headerKey: string): ColumnMapping | undefined {
  return ds.importMappings.find((m) => m.headerKey === headerKey)?.mapping;
}
