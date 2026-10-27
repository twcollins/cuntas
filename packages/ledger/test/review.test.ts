import { describe, expect, it } from "vitest";
import { importFile } from "@cuntas/importers";
import type { ParsedStatement } from "@cuntas/importers";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyImports, categorise, cleanMerchant, createEmptyDataset, fileGroup, importStatement, isCashflow, categoryMap, reviewQueue, undoFile, type Account, type Dataset } from "../src";

const asOf = "2026-10-25";
const fixture = (name: string) => readFileSync(join(__dirname, "../../importers/fixtures", name), "utf8");

describe("merchant cleaning", () => {
  it.each([
    // US card and checking exports
    ["TRADER JOE'S #123 SAN FRANCISCO CA", "Trader Joe's"],
    ["WHOLE FOODS MKT #10 AUSTIN TX", "Whole Foods"],
    ["SAFEWAY #1234", "Safeway"],
    ["PURCHASE AUTHORIZED ON 09/02 CHEVRON 0012345 SAN JOSE CA", "Chevron"],
    ["CHECKCARD 0902 STARBUCKS STORE 12345 SEATTLE WA", "Starbucks"],
    ["PG&E DES:WEB ONLINE ID:XXXXX12 INDN:ALEX", "PG&E"],
    ["ACME CORP PAYROLL PPD ID: 1234567890", "Acme Corp Payroll"],
    ["ACME CORP DIR DEP 090126", "Acme Corp Dir Dep"],
    ["AMAZON MKTPLACE PMTS AMZN.COM/BILL WA", "Amazon"],
    ["AMZN Mktp US*2K3LM0QW2", "Amazon"],
    ["AMAZON.COM*RT4TY7HJ1 AMZN.COM/BILLWA", "Amazon"],
    ["NETFLIX.COM", "Netflix"],
    ["SPOTIFY USA", "Spotify"],
    ["APPLE.COM/BILL 866-712-7753 CA", "Apple"],
    ["SQ *BLUE BOTTLE COFFEE Oakland CA", "Blue Bottle Coffee"],
    ["TST* SHAKE SHACK 1234 NEW YORK NY", "Shake Shack"],
    ["PAYPAL *NETFLIX 402-935-7733", "Netflix"],
    ["DOORDASH*CHIPOTLE", "DoorDash"],
    ["PAYPAL *EBAYINC 402-935-7733", "eBay"],
    ["ZELLE TO JORDAN", "Zelle to Jordan"],
    ["THE HOME DEPOT #6543", "The Home Depot"],
    ["UBER TRIP SAN FRANCISCO CA", "Uber Trip"],
    ["WAL-MART #3456 HOUSTON TX", "Walmart"],
    ["CVS/PHARMACY #08321 DALLAS TX", "CVS Pharmacy"],
    ["DEBIT CARD PURCHASE XXXXX1234 TARGET T-0841 MINNEAPOLIS MN", "Target"],
    ["POS DEBIT 7-ELEVEN 34567", "7-Eleven"],
    // Irish and UK exports, already partly cleaned by the importers
    ["TESCO STORES 3245", "Tesco Stores"],
    ["DUNNES STORES", "Dunnes Stores"],
    ["CARD PAYMENT TO SAINSBURYS ON 12-09-2026", "Sainsburys"],
    // Text that is already readable is left alone
    ["Pret A Manger", "Pret A Manger"],
    ["To GBP", "To GBP"],
    ["Payment Thank You-Mobile", "Payment Thank You-Mobile"],
  ])("%s → %s", (raw, name) => {
    expect(cleanMerchant(raw)).toBe(name);
  });

  it("is idempotent and never returns nothing", () => {
    for (const raw of ["TRADER JOE'S #123 SAN FRANCISCO CA", "PG&E DES:WEB ONLINE", "#1234", "", "   "]) {
      const once = cleanMerchant(raw);
      expect(cleanMerchant(once)).toBe(once);
      if (raw.trim()) expect(once.length).toBeGreaterThan(0);
    }
  });

  it("is applied to the payee on import, keeping the bank's text", () => {
    const ds = createEmptyDataset("Test", "USD", `${asOf}T00:00:00Z`, { name: "Alex", home: "US" });
    ds.accounts = [account("checking")];
    const r = importStatement(ds, "checking", importFile("chase.csv", fixture("chase-checking.csv")));
    const tj = r.dataset.transactions.find((t) => t.amountMinor === -6418)!;
    expect(tj).toMatchObject({ payee: "Trader Joe's", rawDescription: "TRADER JOE'S #123 SAN FRANCISCO CA", categoryId: "cat_groceries" });
  });
});

function account(id: string, over: Partial<Account> = {}): Account {
  return { id, name: id, memberIds: [], type: "current", currency: "USD", institutionId: null, wrapper: "none", jurisdiction: "US", openingBalanceMinor: 0, openingDate: "2026-01-01", valuations: [], isEmergencyFund: false, archived: false, ...over };
}

describe("the US merchant dictionary", () => {
  const cat = (text: string, amountMinor = -1000) => categorise({ payee: cleanMerchant(text), rawDescription: text, amountMinor, accountId: "a" }, []).categoryId;

  it.each([
    ["TRADER JOE'S #123 SAN FRANCISCO CA", "cat_groceries"],
    ["WHOLE FOODS MKT #10 AUSTIN TX", "cat_groceries"],
    ["SAFEWAY #1234", "cat_groceries"],
    ["KROGER #614", "cat_groceries"],
    ["COSTCO WHSE #0123", "cat_groceries"],
    ["H-E-B #456 SAN ANTONIO TX", "cat_groceries"],
    ["WAL-MART #3456 HOUSTON TX", "cat_groceries"],
    ["COSTCO GAS #0123", "cat_commute"],
    ["PURCHASE AUTHORIZED ON 09/02 CHEVRON 0012345 SAN JOSE CA", "cat_commute"],
    ["EXXONMOBIL 4455", "cat_commute"],
    ["UBER TRIP SAN FRANCISCO CA", "cat_commute"],
    ["UBER EATS", "cat_eating_out"],
    ["LYFT *RIDE TUE 8PM", "cat_commute"],
    ["E-ZPASS REPLENISH", "cat_commute"],
    ["PG&E DES:WEB ONLINE ID:XXXXX12 INDN:ALEX", "cat_energy"],
    ["CON ED OF NY", "cat_energy"],
    ["DUKE ENERGY PAYMENT", "cat_energy"],
    ["COMCAST CABLE COMM", "cat_phone_internet"],
    ["VERIZON WIRELESS", "cat_phone_internet"],
    ["AT&T *PAYMENT", "cat_phone_internet"],
    ["T-MOBILE AUTOPAY", "cat_phone_internet"],
    ["GEICO *AUTO", "cat_car"],
    ["STATE FARM INSURANCE", "cat_car"],
    ["CVS/PHARMACY #08321 DALLAS TX", "cat_toiletries"],
    ["WALGREENS #1234", "cat_toiletries"],
    ["BLUE CROSS BLUE SHIELD", "cat_health_insurance"],
    ["NETFLIX.COM", "cat_tv_subs"],
    ["HULU 877-8244858 CA", "cat_tv_subs"],
    ["SPOTIFY USA", "cat_tv_subs"],
    ["CHIPOTLE 1234", "cat_eating_out"],
    ["CHICK-FIL-A #01234", "cat_eating_out"],
    ["SQ *BLUE BOTTLE COFFEE Oakland CA", "cat_eating_out"],
    ["PEET'S COFFEE #123", "cat_eating_out"],
    ["TST* SHAKE SHACK 1234 NEW YORK NY", "cat_eating_out"],
    ["DOORDASH*CHIPOTLE", "cat_eating_out"],
    ["DEBIT CARD PURCHASE XXXXX1234 TARGET T-0841 MINNEAPOLIS MN", "cat_shopping"],
    ["AMAZON MKTPLACE PMTS AMZN.COM/BILL WA", "cat_shopping"],
    ["AMZN Mktp US*2K3LM0QW2", "cat_shopping"],
    ["THE HOME DEPOT #6543", "cat_shopping"],
    ["BEST BUY 00012345", "cat_shopping"],
    ["AMC 1234 ONLINE", "cat_entertainment"],
    ["PLANET FITNESS", "cat_entertainment"],
    ["DELTA AIR LINES ATLANTA", "cat_travel"],
    ["MARRIOTT HOTELS", "cat_travel"],
    ["SALLIE MAE BANK", "cat_debt_payments"],
    ["KINDERCARE #1234", "cat_childcare"],
    ["ACME CORP DIR DEP 090126", "cat_salary", 240000],
  ])("%s → %s", (text, id, amount = -1000) => {
    expect(cat(text, amount)).toBe(id);
  });

  it("card payments on the card are transfers, so they never count as income", () => {
    for (const text of ["AUTOPAY PAYMENT - THANK YOU", "Payment Thank You-Mobile", "INTERNET PAYMENT - THANK YOU", "ONLINE PAYMENT, THANK YOU"]) expect(cat(text, 40000)).toBe("cat_transfer");
  });

  it("doesn't misfire on US text that looks like an Irish or UK merchant", () => {
    expect(cat("THE COFFEE BEAN #123")).toBe("cat_eating_out");
    expect(cat("COSTA MESA SMOG CHECK")).not.toBe("cat_eating_out");
    expect(cat("NEW HAVEN PARKING AUTH")).toBe("cat_commute");
    expect(cat("ICELANDAIR")).not.toBe("cat_groceries");
    expect(cat("DISNEYLAND RESORT")).toBe("cat_entertainment");
    expect(cat("TESLA SUPERCHARGER")).not.toBe("cat_fees");
    expect(cat("MONTHLY SERVICE FEE")).toBe("cat_fees");
  });

  it("income words on a payment out are not income", () => {
    expect(cat("ACME CORP DIR DEP 090126", -2400)).toBeNull();
  });

  it("leaves under a fifth of a typical US month's spending uncategorised", () => {
    const rows: [string, number][] = [
      ["ACME CORP PAYROLL PPD ID: 1234567890", 412000],
      ["RENT PAYMENT", -210000],
      ["TRADER JOE'S #123 SAN FRANCISCO CA", -6418],
      ["SAFEWAY #1234", -8240],
      ["WHOLE FOODS MKT #10 AUSTIN TX", -5421],
      ["COSTCO WHSE #0123", -18760],
      ["TRADER JOE'S #123 SAN FRANCISCO CA", -4890],
      ["PG&E DES:WEB ONLINE ID:XXXXX12 INDN:ALEX", -12000],
      ["COMCAST CABLE COMM", -8999],
      ["VERIZON WIRELESS", -7500],
      ["GEICO *AUTO", -14200],
      ["CHEVRON 0012345 SAN JOSE CA", -5210],
      ["SHELL OIL 57444", -4800],
      ["UBER TRIP SAN FRANCISCO CA", -1840],
      ["NETFLIX.COM", -1549],
      ["SPOTIFY USA", -1199],
      ["SQ *BLUE BOTTLE COFFEE Oakland CA", -650],
      ["STARBUCKS STORE 12345", -575],
      ["CHIPOTLE 1234", -1385],
      ["DOORDASH*THAI PLACE", -3420],
      ["TST* LITTLE STAR PIZZA", -4100],
      ["AMZN Mktp US*2K3LM0QW2", -2399],
      ["TARGET T-0841", -6120],
      ["CVS/PHARMACY #08321", -1835],
      ["PLANET FITNESS", -2499],
      ["AMC 1234 ONLINE", -3200],
      ["LUCIA'S NAIL SALON", -4500],
      ["BOB'S HARDWARE 2231", -2760],
      ["ZELLE TO JORDAN", -6000],
      ["VENMO PAYMENT 1023", -2500],
    ];
    const ds = createEmptyDataset("Test", "USD", `${asOf}T00:00:00Z`, { name: "Alex", home: "US" });
    ds.accounts = [account("checking")];
    const statement: ParsedStatement = { format: "csv", warnings: [], transactions: rows.map(([text, amountMinor], i) => ({ bookedAt: `2026-09-${String(i + 1).padStart(2, "0")}`, amountMinor, currency: "USD", payee: text, rawDescription: text, externalId: `x${i}` })) };
    const { dataset } = importStatement(ds, "checking", statement);
    const cats = categoryMap(dataset);
    const out = dataset.transactions.filter((t) => t.amountMinor < 0 && isCashflow(t, cats));
    const total = out.reduce((s, t) => s - t.amountMinor, 0);
    const uncategorised = out.filter((t) => t.categoryId === null).reduce((s, t) => s - t.amountMinor, 0);
    expect(uncategorised / total).toBeLessThan(0.2);
  });
});

function withRows(rows: [string, number, string?][]): Dataset {
  const ds = createEmptyDataset("Test", "USD", `${asOf}T00:00:00Z`, { name: "Alex", home: "US" });
  ds.accounts = [account("checking")];
  ds.transactions = rows.map(([payee, amountMinor, bookedAt], i) => ({
    id: `t${i}`,
    accountId: "checking",
    bookedAt: bookedAt ?? `2026-09-${String(i + 1).padStart(2, "0")}`,
    amountMinor,
    currency: "USD",
    fxRateToBase: null,
    payee,
    rawDescription: payee,
    externalId: `e${i}`,
    categoryId: null,
    categorySource: "none",
    transferPairId: null,
    splits: [],
    notes: "",
  }));
  return ds;
}

describe("the review queue", () => {
  const ds = () =>
    withRows([
      ["LUCIA'S NAIL SALON #1 OAKLAND CA", -4500, "2026-09-02"],
      ["BOB'S HARDWARE 2231", -2760, "2026-09-03"],
      ["LUCIA'S NAIL SALON #2 BERKELEY CA", -5500, "2026-10-18"],
      ["BOB'S HARDWARE 2231", -1000, "2026-09-20"],
      ["CORNER STORE", -900, "2026-09-21"],
      ["BOB'S HARDWARE", 500, "2026-09-22"],
      ["SIDE GIG LLC", 30000, "2026-09-23"],
    ]);

  it("groups uncategorised rows by cleaned merchant, largest total first", () => {
    const q = reviewQueue(ds(), asOf);
    expect(q.map((g) => [g.name, g.count, g.totalMinor])).toEqual([
      ["Side Gig LLC", 1, 30000],
      ["Lucia's Nail Salon", 2, 10000],
      ["Bob's Hardware", 3, 3260],
      ["Corner Store", 1, 900],
    ]);
    expect(q[1]).toMatchObject({ key: "lucia's nail salon", direction: "out", start: "2026-09-02", end: "2026-10-18", example: "LUCIA'S NAIL SALON #1 OAKLAND CA" });
    expect(q[0]!.direction).toBe("in");
  });

  it("offers income categories for money in and spending categories for money out", () => {
    const q = reviewQueue(ds(), asOf);
    expect(q[0]!.suggestions).toContain("cat_other_income");
    expect(q[1]!.suggestions).toHaveLength(4);
    expect(q[1]!.suggestions).toContain("cat_groceries");
  });

  it("leaves out categorised rows, transfers and split rows", () => {
    const d = ds();
    d.transactions[0]!.categoryId = "cat_shopping";
    d.transactions[1]!.transferPairId = "t4";
    d.transactions[4]!.splits = [{ categoryId: "cat_shopping", amountMinor: -900 }];
    const q = reviewQueue(d, asOf);
    expect(q.find((g) => g.name === "Lucia's Nail Salon")!.count).toBe(1);
    expect(q.find((g) => g.name === "Bob's Hardware")!.count).toBe(2);
    expect(q.find((g) => g.name === "Corner Store")).toBeUndefined();
  });

  it("filing a group categorises every row in it and, by default, makes a rule for the next import", () => {
    const start = ds();
    const group = reviewQueue(start, asOf).find((g) => g.name === "Bob's Hardware")!;
    const r = fileGroup(start, group, "cat_shopping", { rule: true });
    expect(r.dataset.transactions.filter((t) => group.transactionIds.includes(t.id)).every((t) => t.categoryId === "cat_shopping" && t.categorySource === "user")).toBe(true);
    expect(r.dataset.categoryRules).toEqual([expect.objectContaining({ match: { payeeContains: "bob's hardware" }, categoryId: "cat_shopping" })]);
    expect(reviewQueue(r.dataset, asOf).map((g) => g.name)).not.toContain("Bob's Hardware");
    // The next statement's row for the same shop is filed by the rule.
    const next = applyImports(r.dataset, [{ statement: { format: "csv", warnings: [], transactions: [{ bookedAt: "2026-10-20", amountMinor: -1500, currency: "USD", payee: "BOB'S HARDWARE 2231", rawDescription: "BOB'S HARDWARE 2231", externalId: "n1" }] }, target: "checking" }], `${asOf}T00:00:00Z`);
    expect(next.summary).toMatchObject({ added: 1, categorised: 1, uncategorised: 0 });
  });

  it("without the rule, files only the rows in the group", () => {
    const r = fileGroup(ds(), reviewQueue(ds(), asOf)[1]!, "cat_toiletries", { rule: false });
    expect(r.dataset.categoryRules).toEqual([]);
    expect(r.dataset.transactions.filter((t) => t.categoryId === "cat_toiletries")).toHaveLength(2);
  });

  it("undo puts back the rows and removes the rule, leaving other changes alone", () => {
    const start = ds();
    const group = reviewQueue(start, asOf).find((g) => g.name === "Bob's Hardware")!;
    const r = fileGroup(start, group, "cat_shopping", { rule: true });
    const edited = { ...r.dataset, transactions: r.dataset.transactions.map((t) => (t.id === "t4" ? { ...t, categoryId: "cat_eating_out", categorySource: "user" as const } : t)) };
    const back = undoFile(edited, r.undo);
    expect(back.categoryRules).toEqual([]);
    expect(back.transactions.filter((t) => group.transactionIds.includes(t.id)).every((t) => t.categoryId === null && t.categorySource === "none")).toBe(true);
    expect(back.transactions.find((t) => t.id === "t4")!.categoryId).toBe("cat_eating_out");
  });

  it("doesn't add a second copy of a rule that already exists", () => {
    const d = ds();
    d.categoryRules = [{ id: "r1", match: { payeeContains: "corner store" }, categoryId: "cat_eating_out", priority: 10 }];
    const g = reviewQueue(d, asOf).find((x) => x.name === "Corner Store");
    // The rule has already filed it, so it isn't in the queue at all once reconciled.
    expect(g === undefined || fileGroup(d, g, "cat_eating_out", { rule: true }).dataset.categoryRules.length === 1).toBe(true);
  });
});
