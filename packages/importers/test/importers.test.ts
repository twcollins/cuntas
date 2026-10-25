import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { guessMapping, importFile, parseAmount, parseDate, PRESETS } from "../src";

const fixture = (name: string) => readFileSync(join(__dirname, "../fixtures", name), "utf8");

describe("parsing", () => {
  it("parses amounts", () => {
    expect(parseAmount("1,234.56")).toBe(123456);
    expect(parseAmount("-€12.3")).toBe(-1230);
    expect(parseAmount("(5.00)")).toBe(-500);
    expect(parseAmount("12,30", true)).toBe(1230);
    expect(parseAmount("1.234,50", true)).toBe(123450);
    expect(parseAmount("10.00 DR")).toBe(-1000);
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
  });
  it("parses dates", () => {
    expect(parseDate("01/09/2026", "DD/MM/YYYY")).toBe("2026-09-01");
    expect(parseDate("2026-09-01 10:01:02", "YYYY-MM-DD")).toBe("2026-09-01");
    expect(parseDate("3 Sep 2026", "DD MMM YYYY")).toBe("2026-09-03");
    expect(parseDate("01/09/26", "DD/MM/YYYY")).toBe("2026-09-01");
  });
});

const cases: [string, string, number][] = [
  ["revolut.csv", "revolut", 4],
  ["aib.csv", "aib", 3],
  ["aib-current.csv", "aib", 3],
  ["boi.csv", "boi", 3],
  ["ptsb.csv", "ptsb", 2],
  ["anpost.csv", "anpost", 2],
  ["creditunion.csv", "creditunion", 2],
  ["monzo.csv", "monzo", 2],
  ["starling.csv", "starling", 2],
  ["barclays.csv", "barclays", 2],
  ["danske.csv", "danske", 1],
  ["hsbc-uk.csv", "hsbc-uk", 3],
  ["hsbc-uk-basic.csv", "hsbc-uk-basic", 3],
  ["chase-checking.csv", "chase-checking", 2],
  ["chase-card.csv", "chase-card", 2],
  ["bofa-checking.csv", "bofa-checking", 3],
  ["bofa-card.csv", "bofa-card", 2],
  ["wellsfargo.csv", "wells-fargo", 2],
  ["capitalone-card.csv", "capital-one-card", 2],
  ["capitalone-360.csv", "capital-one-360", 2],
  ["citi.csv", "citi", 2],
  ["amex.csv", "amex", 2],
  ["discover.csv", "discover", 2],
];

describe("bank presets", () => {
  it("has a fixture for every preset", () => {
    expect([...new Set(cases.map((c) => c[1]))].sort()).toEqual(PRESETS.map((p) => p.id).sort());
  });
  for (const [file, preset, count] of cases) {
    it(`${preset}: detects and parses`, () => {
      const r = importFile(file, fixture(file));
      expect(r.preset).toBe(preset);
      expect(r.transactions).toHaveLength(count);
      expect(r.warnings).toEqual([]);
      for (const t of r.transactions) {
        expect(t.bookedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(Number.isInteger(t.amountMinor)).toBe(true);
      }
    });
    it(`${preset}: re-import produces identical ids`, () => {
      const a = importFile(file, fixture(file)).transactions.map((t) => t.externalId);
      const b = importFile(file, fixture(file)).transactions.map((t) => t.externalId);
      expect(a).toEqual(b);
      expect(new Set(a).size).toBe(a.length);
    });
  }

  it("Revolut: subtracts fees, skips pending, keeps identical same-day rows", () => {
    const r = importFile("revolut.csv", fixture("revolut.csv"));
    expect(r.transactions.map((t) => t.amountMinor)).toEqual([-2345, -420, -420, -20100]);
  });
  it("AIB: debit/credit columns and quoted thousands", () => {
    const r = importFile("aib.csv", fixture("aib.csv"));
    expect(r.transactions.map((t) => t.amountMinor)).toEqual([-4510, 320000, -112000]);
    expect(r.transactions[0]!.payee).toBe("DUNNES STORES");
  });
  it("AIB current account: single Description column, two-digit years, detail rows folded in", () => {
    const r = importFile("aib-current.csv", fixture("aib-current.csv"));
    expect(r.transactions.map((t) => [t.bookedAt, t.amountMinor])).toEqual([
      ["2026-10-27", 330134],
      ["2026-10-23", -6000],
      ["2026-10-23", -33694],
    ]);
    expect(r.transactions[0]).toMatchObject({ rawDescription: "DAFM20135600000000 IE26102600000000", balanceMinor: 883567 });
    expect(r.transactions[1]).toMatchObject({ payee: "Brinks ATM", rawDescription: "VDA-Brinks ATM D08 X00X 21OCT26 20:31" });
    expect(r.transactions[1]!.balanceMinor).toBeUndefined();
    expect(r.transactions[2]).toMatchObject({ payee: "Electric Irela", balanceMinor: 553433 });
  });
  it("guesses a column mapping from header names when no preset matches", () => {
    expect(guessMapping(["Account", "Txn Date", "Narrative", "Money Out", "Money In", "Balance"], "EUR")).toMatchObject({
      date: "Txn Date",
      dateFormat: "DD/MM/YYYY",
      description: ["Narrative"],
      debit: "Money Out",
      credit: "Money In",
    });
    expect(guessMapping(["When", "What", "Value"], "GBP")).toMatchObject({ date: "When", description: ["What"], amount: "Value" });
  });
  it("HSBC UK: paid out/in columns with quoted thousands", () => {
    const r = importFile("hsbc-uk.csv", fixture("hsbc-uk.csv"));
    expect(r.transactions.map((t) => t.amountMinor)).toEqual([-104210, 285000, -2345]);
    expect(r.transactions.every((t) => t.currency === "GBP")).toBe(true);
    expect(r.transactions[0]!.balanceMinor).toBe(231055);
  });
  it("HSBC UK: detects the export with no header row and keeps the first line", () => {
    const r = importFile("hsbc-uk-basic.csv", fixture("hsbc-uk-basic.csv"));
    expect(r.transactions[0]).toMatchObject({ bookedAt: "2026-09-05", amountMinor: -780, rawDescription: "TFL TRAVEL CH" });
    expect(r.transactions[2]!.amountMinor).toBe(285000);
  });
  it("a headerless file that is not HSBC's shape still asks for a mapping", () => {
    expect(importFile("x.csv", "foo,bar\nbaz,qux\n").warnings[0]).toMatch(/map the columns/);
  });
  it("Monzo: uses the bank's transaction id", () => {
    expect(importFile("monzo.csv", fixture("monzo.csv")).transactions[0]!.externalId).toBe("tx_0000A1");
  });
  it("unknown layouts ask for a column mapping, then import", () => {
    const text = "When,What,Value\n2026-09-01,Thing,-1.00\n";
    expect(importFile("x.csv", text).warnings[0]).toMatch(/map the columns/);
    const r = importFile("x.csv", text, { date: "When", dateFormat: "YYYY-MM-DD", amount: "Value", description: ["What"], defaultCurrency: "GBP" });
    expect(r.transactions[0]).toMatchObject({ bookedAt: "2026-09-01", amountMinor: -100, currency: "GBP" });
  });
});

describe("OFX and CAMT.053", () => {
  it("parses OFX SGML", () => {
    const r = importFile("sample.ofx", fixture("sample.ofx"));
    expect(r.format).toBe("ofx");
    expect(r.transactions).toMatchObject([
      { bookedAt: "2026-09-01", amountMinor: -1250, externalId: "ofx:A1", payee: "SPAR" },
      { bookedAt: "2026-09-02", amountMinor: 10000, externalId: "ofx:A2" },
    ]);
  });
  it("parses camt.053", () => {
    const r = importFile("s.xml", fixture("sample.camt053.xml"));
    expect(r.format).toBe("camt053");
    expect(r.account?.iban).toBe("IE29AIBK93115212345678");
    expect(r.transactions).toMatchObject([
      { bookedAt: "2026-09-04", amountMinor: -4999, payee: "Virgin Media", externalId: "camt:R1" },
      { bookedAt: "2026-09-25", amountMinor: 320000, payee: "ACME LTD", externalId: "camt:R2" },
    ]);
  });
});

describe("US bank presets", () => {
  const first = (file: string) => importFile(file, fixture(file)).transactions;
  it("reads dollars, with money out negative", () => {
    expect(first("chase-checking.csv").map((t) => [t.bookedAt, t.amountMinor, t.currency])).toEqual([["2026-09-02", -6418, "USD"], ["2026-09-01", 350000, "USD"]]);
    expect(first("chase-card.csv")[0]!.amountMinor).toBe(-1549);
  });
  it("flips Amex and Discover, which export charges as positive", () => {
    expect(first("amex.csv").map((t) => t.amountMinor)).toEqual([-41260, 41260]);
    expect(first("discover.csv").map((t) => t.amountMinor)).toEqual([-2399, 2399]);
  });
  it("finds Bank of America's header below its summary block and skips the opening balance line", () => {
    const t = first("bofa-checking.csv");
    expect(t.map((x) => x.amountMinor)).toEqual([-12000, 280000, -113000]);
    expect(t.at(-1)!.balanceMinor).toBe(255000);
  });
  it("Capital One 360 takes the sign from the transaction type", () => {
    expect(first("capitalone-360.csv").map((t) => [t.bookedAt, t.amountMinor])).toEqual([["2026-09-02", 150000], ["2026-09-03", -20000]]);
  });
  it("Capital One and Citi card debits are money out, credits money in; Citi pending rows wait", () => {
    expect(first("capitalone-card.csv").map((t) => t.amountMinor)).toEqual([-1199, 25000]);
    expect(first("citi.csv").map((t) => t.amountMinor)).toEqual([-5421, 30000]);
  });
  it("Wells Fargo has no header row", () => {
    expect(first("wellsfargo.csv").map((t) => [t.bookedAt, t.amountMinor])).toEqual([["2026-09-03", -4210], ["2026-09-01", 240000]]);
  });
});

