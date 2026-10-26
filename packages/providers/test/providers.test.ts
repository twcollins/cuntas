import { generateKeyPairSync, createVerify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { consentReminderDate, consentStatus, EnableBankingProvider, enableBankingJwt, mapEnableBankingTransactions, MockProvider } from "../src";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });

describe("consent", () => {
  it("reminds 7 days before the 90-day consent expires", () => {
    expect(consentReminderDate("2026-12-31T10:00:00Z", 7)).toBe("2026-12-24");
    expect(consentStatus("2026-12-31T10:00:00Z", "2026-12-01", 7)).toBe("active");
    expect(consentStatus("2026-12-31T10:00:00Z", "2026-12-25", 7)).toBe("expiring");
    expect(consentStatus("2026-12-31T10:00:00Z", "2026-12-31", 7)).toBe("expired");
  });
});

describe("Enable Banking", () => {
  it("signs a verifiable RS256 JWT with the application id as kid", () => {
    const jwt = enableBankingJwt({ applicationId: "app-1", privateKey }, 1_700_000_000);
    const [h, p, s] = jwt.split(".");
    expect(JSON.parse(Buffer.from(h!, "base64url").toString())).toEqual({ typ: "JWT", alg: "RS256", kid: "app-1" });
    expect(JSON.parse(Buffer.from(p!, "base64url").toString())).toMatchObject({ aud: "api.enablebanking.com", iat: 1_700_000_000 });
    const v = createVerify("RSA-SHA256");
    v.update(`${h}.${p}`);
    expect(v.verify(publicKey, Buffer.from(s!, "base64url"))).toBe(true);
  });

  it("maps booked transactions and follows continuation keys", async () => {
    const pages = [
      { transactions: [{ entry_reference: "e1", transaction_amount: { amount: "12.50", currency: "EUR" }, credit_debit_indicator: "DBIT", booking_date: "2026-09-01", creditor: { name: "SPAR" } }], continuation_key: "k" },
      { transactions: [{ entry_reference: "e2", transaction_amount: { amount: "100.00", currency: "EUR" }, credit_debit_indicator: "CRDT", booking_date: "2026-09-02", debtor: { name: "ACME" } }, { transaction_amount: { amount: "1.00", currency: "EUR" }, credit_debit_indicator: "DBIT", booking_date: "2026-09-03", status: "PDNG" }] },
    ];
    const urls: string[] = [];
    const fakeFetch = (async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify(pages.shift()), { status: 200 });
    }) as unknown as typeof fetch;
    const p = new EnableBankingProvider({ applicationId: "a", privateKey, fetch: fakeFetch });
    const txs = await p.fetchTransactions("acc-uid", { from: "2026-09-01" });
    expect(txs).toMatchObject([
      { amountMinor: -1250, payee: "SPAR", externalId: "eb:e1" },
      { amountMinor: 10000, payee: "ACME", externalId: "eb:e2" },
    ]);
    expect(urls[1]).toContain("continuation_key=k");
  });

  it("maps content-hash ids when the bank gives no reference", () => {
    const rows = mapEnableBankingTransactions([{ transaction_amount: { amount: "5", currency: "GBP" }, credit_debit_indicator: "DBIT", booking_date: "2026-09-01" }]);
    expect(rows[0]!.externalId).toMatch(/^h:/);
    expect(rows[0]!.currency).toBe("GBP");
  });

  it("keeps US dollar transactions in dollars", () => {
    const rows = mapEnableBankingTransactions([{ transaction_amount: { amount: "5", currency: "USD" }, credit_debit_indicator: "DBIT", booking_date: "2026-09-01" }]);
    expect(rows[0]!.currency).toBe("USD");
  });
});

describe("mock provider", () => {
  it("runs the consent flow end to end", async () => {
    const p = new MockProvider();
    const [inst] = await p.listInstitutions("IE");
    const { url } = await p.startConsent({ institution: inst!, redirectUrl: "http://localhost/cb", state: "s", validDays: 90 });
    const session = await p.completeConsent({ code: new URL(url).searchParams.get("code")! });
    expect(session.accounts).toHaveLength(1);
    const txs = await p.fetchTransactions(session.accounts[0]!.ref, { from: "2026-09-01", to: "2026-09-10" });
    expect(txs.length).toBeGreaterThanOrEqual(3);
  });
});
