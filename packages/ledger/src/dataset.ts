import type { ParsedStatement } from "@cuntas/importers";
import { daysBetween, type Currency, type Jurisdiction } from "@cuntas/rules";
import { recategorise } from "./categories";
import { DEFAULT_CATEGORIES } from "./categories";
import { FxTable } from "./fx";
import { newId } from "./ids";
import { newMember, SCHEMA_VERSION, type Dataset, type Transaction } from "./schema";
import { matchTransfers } from "./transfers";

/** Placeholder date of birth for a person added before they give one; residence runs from it. */
const UNKNOWN_BIRTH_DATE = "1990-01-01";

/**
 * A new household. With `first`, it starts with that person resident in `home`, so the plan,
 * wording and rules match where the household lives from the first screen.
 */
export function createEmptyDataset(name: string, baseCurrency: Currency = "EUR", now = new Date().toISOString(), first?: { name: string; home: Jurisdiction }): Dataset {
  const member = first ? newMember({ id: newId("m"), name: first.name, dateOfBirth: UNKNOWN_BIRTH_DATE, nationality: [first.home] }) : null;
  return {
    schemaVersion: SCHEMA_VERSION,
    household: {
      id: newId("hh"),
      name,
      baseCurrency,
      createdAt: now,
      settings: {
        flags: [],
        paydayDayOfMonth: 1,
        fundBasis: "netPay",
        thresholdOverrides: {},
        ownsHome: false,
        monthlyRentMinor: 0,
        expectedMortgagePaymentMinor: null,
        children: 0,
      },
    },
    members: member ? [member] : [],
    residencePeriods: member && first ? [{ id: newId("rp"), memberId: member.id, jurisdiction: first.home, from: UNKNOWN_BIRTH_DATE, to: null, declaredBy: "user" }] : [],
    institutions: [],
    connections: [],
    accounts: [],
    transactions: [],
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    categoryRules: [],
    budgets: [],
    goals: [],
    debts: [],
    pensionPlans: [],
    contributions: [],
    holdings: [],
    fxRates: [],
    stepStates: [],
    auditEvents: [],
    payslips: [],
    bills: [],
    recurringDismissed: [],
  };
}

export function withAudit(ds: Dataset, actor: string, action: string, entity: string): Dataset {
  return { ...ds, auditEvents: [...ds.auditEvents, { id: newId("audit"), actor, action, entity, at: new Date().toISOString() }] };
}

/** Re-runs categorisation and transfer matching over the whole ledger. */
export function reconcile(ds: Dataset): Dataset {
  const fx = new FxTable(ds.fxRates);
  return { ...ds, transactions: matchTransfers(recategorise(ds.transactions, ds.categoryRules), fx) };
}

export interface ImportResult {
  dataset: Dataset;
  added: number;
  /** Hand-entered rows the statement matched, updated in place instead of added again. */
  merged: number;
  skipped: number;
  warnings: string[];
}

/**
 * Adds parsed statement lines to an account. Idempotent: lines whose (account, externalId)
 * already exist are skipped, so re-importing the same file creates no duplicates.
 */
/** How far apart a hand-entered row and a statement line can be and still be the same payment. */
const MERGE_DAYS = 3;

export function importStatement(ds: Dataset, accountId: string, statement: ParsedStatement): ImportResult {
  const account = ds.accounts.find((a) => a.id === accountId);
  if (!account) throw new Error(`Unknown account ${accountId}`);
  const existing = new Set(ds.transactions.filter((t) => t.accountId === accountId).map((t) => t.externalId));
  const fx = new FxTable(ds.fxRates);
  const warnings = [...statement.warnings];
  const added: Transaction[] = [];
  let skipped = 0;
  // Hand-entered rows on this account that a statement line can replace: same amount, within MERGE_DAYS.
  const manual = ds.transactions.filter((t) => t.accountId === accountId && t.source === "manual");
  const mergedInto = new Map<string, ParsedStatement["transactions"][number]>();
  for (const p of statement.transactions) {
    if (existing.has(p.externalId)) {
      skipped++;
      continue;
    }
    existing.add(p.externalId);
    const match = manual
      .filter((t) => !mergedInto.has(t.id) && t.amountMinor === p.amountMinor && Math.abs(daysBetween(t.bookedAt, p.bookedAt)) <= MERGE_DAYS)
      .sort((a, b) => Math.abs(daysBetween(a.bookedAt, p.bookedAt)) - Math.abs(daysBetween(b.bookedAt, p.bookedAt)))[0];
    if (match) {
      mergedInto.set(match.id, p);
      continue;
    }
    if (p.currency !== account.currency) warnings.push(`A ${p.currency} line was booked to a ${account.currency} account at face value.`);
    added.push({
      id: newId("tx"),
      accountId,
      bookedAt: p.bookedAt,
      amountMinor: p.amountMinor,
      currency: account.currency,
      fxRateToBase: account.currency === ds.household.baseCurrency ? null : (fx.rate(account.currency, ds.household.baseCurrency, p.bookedAt) ?? null),
      payee: p.payee,
      rawDescription: p.rawDescription,
      externalId: p.externalId,
      categoryId: null,
      categorySource: "none",
      transferPairId: null,
      splits: [],
      notes: "",
    });
  }
  // The bank's date and reference replace the hand-entered ones; the user's payee, category and note stay.
  const kept = ds.transactions.map((t) => {
    const p = mergedInto.get(t.id);
    return p ? { ...t, bookedAt: p.bookedAt, externalId: p.externalId, rawDescription: p.rawDescription, payee: t.payee || p.payee, source: "import" as const } : t;
  });
  const next = reconcile({ ...ds, transactions: [...kept, ...added] });
  return { dataset: withAudit(next, "user", `import:${added.length}`, `account:${accountId}`), added: added.length, merged: mergedInto.size, skipped, warnings };
}
