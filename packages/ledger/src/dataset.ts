import type { ParsedStatement } from "@cuntas/importers";
import type { Currency } from "@cuntas/rules";
import { recategorise } from "./categories";
import { DEFAULT_CATEGORIES } from "./categories";
import { FxTable } from "./fx";
import { newId } from "./ids";
import { SCHEMA_VERSION, type Dataset, type Transaction } from "./schema";
import { matchTransfers } from "./transfers";

export function createEmptyDataset(name: string, baseCurrency: Currency = "EUR", now = new Date().toISOString()): Dataset {
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
    members: [],
    residencePeriods: [],
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
  skipped: number;
  warnings: string[];
}

/**
 * Adds parsed statement lines to an account. Idempotent: lines whose (account, externalId)
 * already exist are skipped, so re-importing the same file creates no duplicates.
 */
export function importStatement(ds: Dataset, accountId: string, statement: ParsedStatement): ImportResult {
  const account = ds.accounts.find((a) => a.id === accountId);
  if (!account) throw new Error(`Unknown account ${accountId}`);
  const existing = new Set(ds.transactions.filter((t) => t.accountId === accountId).map((t) => t.externalId));
  const fx = new FxTable(ds.fxRates);
  const warnings = [...statement.warnings];
  const added: Transaction[] = [];
  let skipped = 0;
  for (const p of statement.transactions) {
    if (existing.has(p.externalId)) {
      skipped++;
      continue;
    }
    existing.add(p.externalId);
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
  const next = reconcile({ ...ds, transactions: [...ds.transactions, ...added] });
  return { dataset: withAudit(next, "user", `import:${added.length}`, `account:${accountId}`), added: added.length, skipped, warnings };
}
