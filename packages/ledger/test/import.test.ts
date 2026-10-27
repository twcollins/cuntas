import { describe, expect, it } from "vitest";
import type { ParsedStatement } from "@cuntas/importers";
import { applyImports, buildSnapshot, createEmptyDataset, datasetSchema, guessAccount, mappingFor, planImports, rememberMapping, spendingWindow, type Account, type Dataset } from "../src";

const asOf = "2026-10-25";
const at = (n: number) => `2026-10-${String(n).padStart(2, "0")}T12:00:00Z`;

function account(id: string, over: Partial<Account> = {}): Account {
  return { id, name: id, memberIds: [], type: "current", currency: "USD", institutionId: null, wrapper: "none", jurisdiction: "US", openingBalanceMinor: 0, openingDate: "2026-01-01", valuations: [], isEmergencyFund: false, archived: false, ...over };
}

function household(accounts: Account[] = []): Dataset {
  const ds = createEmptyDataset("Test", "USD", `${asOf}T00:00:00Z`, { name: "Alex", home: "US" });
  ds.accounts = accounts;
  return ds;
}

let seq = 0;
function statement(over: Partial<ParsedStatement> = {}, rows: [string, number, string][] = [["2026-09-02", -6418, "TRADER JOE'S #123"]]): ParsedStatement {
  return {
    format: "csv",
    transactions: rows.map(([bookedAt, amountMinor, payee]) => ({ bookedAt, amountMinor, currency: "USD", payee, rawDescription: payee, externalId: `h:${seq++}` })),
    warnings: [],
    ...over,
  };
}

describe("guessing the account for a file", () => {
  it("matches by account number first, including a masked card number", () => {
    const ds = household([account("checking", { importHints: { presets: ["chase-checking"], numbers: ["900000-01234567"], lastImportAt: at(1) } }), account("amex", { type: "creditCard", importHints: { presets: ["amex"], numbers: ["11003"], lastImportAt: at(2) } })]);
    expect(guessAccount(ds, statement({ account: { number: "90000001234567" } }))).toEqual({ accountId: "checking", reason: "number" });
    expect(guessAccount(ds, statement({ preset: "amex", account: { number: "-11003", type: "creditCard" } }))).toEqual({ accountId: "amex", reason: "number" });
    expect(guessAccount(ds, statement({ account: { number: "XXXX-XXXX-XXXX-9999" } })).reason).toBe("new");
  });

  it("matches an IBAN against the numbers kept from earlier imports", () => {
    const ds = household([account("aib", { currency: "EUR", importHints: { presets: [], numbers: ["IE29AIBK93115212345678"], lastImportAt: at(1) } })]);
    expect(guessAccount(ds, statement({ format: "camt053", account: { iban: "IE29 AIBK 9311 5212 3456 78", currency: "EUR" } }))).toEqual({ accountId: "aib", reason: "number" });
  });

  it("then by the bank's layout, taking the account it last went into", () => {
    const ds = household([
      account("old", { importHints: { presets: ["chase-checking"], numbers: [], lastImportAt: at(1) } }),
      account("recent", { importHints: { presets: ["chase-checking"], numbers: [], lastImportAt: at(5) } }),
      account("archived", { archived: true, importHints: { presets: ["chase-checking"], numbers: [], lastImportAt: at(9) } }),
    ]);
    expect(guessAccount(ds, statement({ preset: "chase-checking" }))).toEqual({ accountId: "recent", reason: "preset" });
  });

  it("doesn't match by layout when the file names a different account number", () => {
    const ds = household([account("card1", { type: "creditCard", importHints: { presets: ["amex"], numbers: ["11003"], lastImportAt: at(1) } })]);
    expect(guessAccount(ds, statement({ preset: "amex", account: { number: "-22004", type: "creditCard" } }), "American Express")).toMatchObject({ reason: "new", name: "American Express ··2004" });
  });

  it("then an account of the same kind named after the bank, for accounts made before imports were remembered", () => {
    const ds = household([account("AIB joint current", { currency: "EUR" }), account("BOI credit card", { currency: "EUR", type: "creditCard" })]);
    ds.accounts[0]!.id = "aib";
    expect(guessAccount(ds, statement({ preset: "aib", account: { currency: "EUR" } }), "AIB")).toEqual({ accountId: "aib", reason: "name" });
    expect(guessAccount(ds, statement({ preset: "chase-card", account: { type: "creditCard" } }), "Chase (credit card)").reason).toBe("new");
    // A name match never takes an account a different bank's files already go into.
    ds.accounts[0]!.importHints = { presets: ["revolut"], numbers: [], lastImportAt: at(1) };
    expect(guessAccount(ds, statement({ preset: "aib", account: { currency: "EUR" } }), "AIB").reason).toBe("new");
  });

  it("never matches an account in another currency", () => {
    const ds = household([account("eur", { currency: "EUR", importHints: { presets: ["revolut"], numbers: [], lastImportAt: at(1) } })]);
    expect(guessAccount(ds, statement({ preset: "revolut" })).reason).toBe("new");
  });

  it("otherwise proposes a new account named after the bank, typed and priced from the file", () => {
    const ds = household([account("checking")]);
    expect(guessAccount(ds, statement({ preset: "amex", account: { type: "creditCard" } }), "American Express")).toEqual({ accountId: null, reason: "new", name: "American Express", type: "creditCard", currency: "USD" });
    expect(guessAccount(ds, statement(), undefined, "my-bank.csv")).toMatchObject({ name: "my-bank", type: "current" });
  });
});

describe("planning several files", () => {
  it("sends two files from the same new account to one account, and different cards to two", () => {
    const ds = household();
    const plan = planImports(ds, [
      { name: "sep.csv", statement: statement({ preset: "chase-checking" }), bankName: "Chase (checking)" },
      { name: "oct.csv", statement: statement({ preset: "chase-checking" }), bankName: "Chase (checking)" },
      { name: "a.csv", statement: statement({ preset: "amex", account: { number: "11003", type: "creditCard" } }), bankName: "American Express" },
      { name: "b.csv", statement: statement({ preset: "amex", account: { number: "22004", type: "creditCard" } }), bankName: "American Express" },
    ]);
    expect(plan.map((p) => p.target)).toEqual([
      { new: { name: "Chase (checking)", type: "current", currency: "USD" } },
      { new: { name: "Chase (checking)", type: "current", currency: "USD" } },
      { new: { name: "American Express ··1003", type: "creditCard", currency: "USD" } },
      { new: { name: "American Express ··2004", type: "creditCard", currency: "USD" } },
    ]);
  });
});

describe("importing several files", () => {
  const files = () => [
    {
      statement: statement({ preset: "chase-checking" }, [
        ["2026-09-01", 350000, "ACME CORP PAYROLL"],
        ["2026-09-02", -6418, "TRADER JOE'S #123"],
        ["2026-09-10", -50000, "AMEX EPAYMENT"],
        ["2026-10-20", -2500, "MYSTERY SHOP 42"],
      ]),
      target: { new: { name: "Chase (checking)", type: "current" as const, currency: "USD" as const } },
    },
    {
      statement: statement({ preset: "amex", account: { number: "-11003", type: "creditCard" } }, [
        ["2026-09-03", -4500, "NETFLIX.COM"],
        ["2026-09-11", 50000, "AUTOPAY PAYMENT - THANK YOU"],
      ]),
      target: { new: { name: "American Express", type: "creditCard" as const, currency: "USD" as const } },
    },
  ];

  it("creates the accounts, imports every file and sums up what happened", () => {
    const r = applyImports(household(), files(), at(25));
    expect(r.dataset.accounts.map((a) => [a.name, a.type, a.currency, a.jurisdiction, a.openingDate])).toEqual([
      ["Chase (checking)", "current", "USD", "US", "2026-09-01"],
      ["American Express", "creditCard", "USD", "US", "2026-09-03"],
    ]);
    expect(r.summary).toMatchObject({ files: 2, added: 6, skipped: 0, merged: 0, transfers: 1, categorised: 3, uncategorised: 1, start: "2026-09-01", end: "2026-10-20" });
    // Spending: Trader Joe's (groceries), Netflix and the mystery shop, which is the one left uncategorised; the card payment is a transfer and pay is income.
    expect(r.summary.spentMinor).toBe(6418 + 4500 + 2500);
    expect(r.accountIds).toHaveLength(2);
    expect(datasetSchema.parse(r.dataset)).toBeTruthy();
  });

  it("remembers the layout and number on each account, so the next import finds it", () => {
    const r = applyImports(household(), files(), at(25));
    const amex = r.dataset.accounts.find((a) => a.name === "American Express")!;
    expect(amex.importHints).toEqual({ presets: ["amex"], numbers: ["-11003"], lastImportAt: at(25) });
    expect(guessAccount(r.dataset, statement({ preset: "amex", account: { number: "-11003" } }))).toEqual({ accountId: amex.id, reason: "number" });
    expect(guessAccount(r.dataset, statement({ preset: "chase-checking" })).reason).toBe("preset");
  });

  it("two files for the same new account create it once; re-importing skips everything", () => {
    const [chase] = files();
    const again = { ...chase!, statement: { ...chase!.statement, transactions: chase!.statement.transactions.slice(0, 2) } };
    const r = applyImports(household(), [chase!, again], at(25));
    expect(r.dataset.accounts).toHaveLength(1);
    expect(r.summary).toMatchObject({ added: 4, skipped: 2 });
    const id = r.dataset.accounts[0]!.id;
    const r2 = applyImports(r.dataset, [{ statement: chase!.statement, target: id }], at(26));
    expect(r2.summary).toMatchObject({ added: 0, skipped: 4, spentMinor: 0, start: null, end: null });
  });
});

describe("remembered column mappings", () => {
  it("keeps one mapping per header row and returns it for the next file", () => {
    const m = { date: "When", dateFormat: "YYYY-MM-DD" as const, amount: "Value", description: ["What"], defaultCurrency: "USD" as const };
    let ds = rememberMapping(household(), "when|what|value", m);
    ds = rememberMapping(ds, "when|what|value", { ...m, dateFormat: "MM/DD/YYYY" });
    expect(ds.importMappings).toHaveLength(1);
    expect(mappingFor(ds, "when|what|value")?.dateFormat).toBe("MM/DD/YYYY");
    expect(mappingFor(ds, "other")).toBeUndefined();
    expect(datasetSchema.parse(ds).importMappings).toHaveLength(1);
  });
});

describe("an import counts as tracking for 60 days", () => {
  const withRows = (dates: string[]) => {
    const ds = household([account("checking")]);
    ds.transactions = dates.map((d, i) => ({ id: `t${i}`, accountId: "checking", bookedAt: d, amountMinor: -1000, currency: "USD", fxRateToBase: null, payee: "Shop", rawDescription: "Shop", externalId: `e${i}`, categoryId: null, categorySource: "none", transferPairId: null, splits: [], notes: "" }));
    return ds;
  };
  it("last month's statement, imported late in this month, is tracking", () => {
    expect(buildSnapshot(withRows(["2026-09-05"]), asOf).tracking.transactionsLast60Days).toBe(1);
    expect(buildSnapshot(withRows(["2026-08-20"]), asOf).tracking.transactionsLast60Days).toBe(0);
  });
  it("spending falls back to the latest month with data, and says so", () => {
    expect(spendingWindow(withRows(["2026-09-05", "2026-09-20"]), asOf, 1)).toEqual({ start: "2026-09-01", end: "2026-09-30", latest: true });
    expect(spendingWindow(withRows(["2026-09-05", "2026-10-02"]), asOf, 1)).toEqual({ start: "2026-10-01", end: "2026-10-31", latest: false });
    expect(spendingWindow(withRows([]), asOf, 1)).toEqual({ start: "2026-10-01", end: "2026-10-31", latest: false });
    expect(spendingWindow(withRows(["2026-12-01"]), asOf, 1).latest).toBe(false);
  });
});
