import { createSign } from "node:crypto";
import { assignContentIds, cleanPayee, parseAmount } from "@cuntas/importers";
import type { Country, Currency } from "@cuntas/rules";
import { ProviderError, type BankDataProvider, type ConsentSession, type ProviderAccount, type ProviderInstitution } from "./types";

export interface EnableBankingConfig {
  applicationId: string;
  /** PEM private key registered with the Enable Banking application. */
  privateKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

const b64url = (input: Buffer | string) => Buffer.from(input).toString("base64url");

/** Signs the short-lived RS256 JWT Enable Banking expects on every request. */
export function enableBankingJwt(cfg: EnableBankingConfig, now = Math.floor(Date.now() / 1000)): string {
  const header = b64url(JSON.stringify({ typ: "JWT", alg: "RS256", kid: cfg.applicationId }));
  const payload = b64url(JSON.stringify({ iss: "enablebanking.com", aud: "api.enablebanking.com", iat: now, exp: now + 3600 }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${b64url(signer.sign(cfg.privateKey))}`;
}

interface EbTransaction {
  entry_reference?: string;
  transaction_id?: string;
  transaction_amount: { amount: string; currency: string };
  credit_debit_indicator: "CRDT" | "DBIT";
  booking_date?: string;
  value_date?: string;
  creditor?: { name?: string };
  debtor?: { name?: string };
  remittance_information?: string[];
  status?: string;
}

export function mapEnableBankingTransactions(rows: EbTransaction[]) {
  const mapped = rows
    .filter((t) => (t.status ?? "BOOK") === "BOOK")
    .map((t) => {
      const value = Math.abs(parseAmount(t.transaction_amount.amount) ?? 0);
      const credit = t.credit_debit_indicator === "CRDT";
      const party = credit ? t.debtor?.name : t.creditor?.name;
      const rawDescription = [party, ...(t.remittance_information ?? [])].filter(Boolean).join(" ");
      const id = t.entry_reference ?? t.transaction_id;
      return {
        bookedAt: (t.booking_date ?? t.value_date ?? "").slice(0, 10),
        amountMinor: credit ? value : -value,
        currency: (t.transaction_amount.currency === "GBP" ? "GBP" : "EUR") as Currency,
        payee: party ?? cleanPayee(rawDescription),
        rawDescription,
        ...(id ? { externalId: `eb:${id}` } : {}),
      };
    });
  return assignContentIds(mapped);
}

/** Enable Banking adapter (PSD2 AIS across EU and UK banks). Server-side only: it holds the app's private key. */
export class EnableBankingProvider implements BankDataProvider {
  readonly id = "enablebanking";
  private readonly base: string;
  private readonly http: typeof fetch;

  constructor(private readonly cfg: EnableBankingConfig) {
    this.base = cfg.baseUrl ?? "https://api.enablebanking.com";
    this.http = cfg.fetch ?? fetch;
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.http(`${this.base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${enableBankingJwt(this.cfg)}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) throw new ProviderError(`Enable Banking ${method} ${path} failed: ${res.status}`, res.status);
    return (method === "DELETE" ? undefined : await res.json()) as T;
  }

  async listInstitutions(country: Country): Promise<ProviderInstitution[]> {
    const ebCountry = country === "UK" ? "GB" : country;
    const r = await this.call<{ aspsps: { name: string; country: string; bic?: string }[] }>("GET", `/aspsps?country=${ebCountry}&psu_type=personal`);
    return r.aspsps.map((a) => ({ id: `${a.country}:${a.name}`, name: a.name, country, ...(a.bic ? { bic: a.bic } : {}) }));
  }

  async startConsent(input: { institution: ProviderInstitution; redirectUrl: string; state: string; validDays: number }) {
    const validUntil = new Date(Date.now() + input.validDays * 86_400_000).toISOString();
    const r = await this.call<{ url: string; authorization_id: string }>("POST", "/auth", {
      access: { valid_until: validUntil },
      aspsp: { name: input.institution.name, country: input.institution.country === "UK" ? "GB" : input.institution.country },
      state: input.state,
      redirect_url: input.redirectUrl,
      psu_type: "personal",
    });
    return { url: r.url, reference: r.authorization_id };
  }

  async completeConsent(input: { code: string }): Promise<ConsentSession> {
    const r = await this.call<{ session_id: string; access: { valid_until: string }; accounts: { uid: string; name?: string; currency?: string; account_id?: { iban?: string } }[] }>(
      "POST",
      "/sessions",
      { code: input.code },
    );
    return { sessionId: r.session_id, consentExpiresAt: r.access.valid_until, accounts: r.accounts.map(toAccount) };
  }

  async fetchAccounts(sessionId: string): Promise<ProviderAccount[]> {
    const r = await this.call<{ accounts: { uid: string; name?: string; currency?: string; account_id?: { iban?: string } }[] }>("GET", `/sessions/${sessionId}`);
    return r.accounts.map(toAccount);
  }

  async fetchTransactions(accountRef: string, range: { from: string; to?: string }) {
    const rows: EbTransaction[] = [];
    let key: string | undefined;
    do {
      const q = new URLSearchParams({ date_from: range.from, ...(range.to ? { date_to: range.to } : {}), ...(key ? { continuation_key: key } : {}) });
      const r = await this.call<{ transactions: EbTransaction[]; continuation_key?: string }>("GET", `/accounts/${accountRef}/transactions?${q}`);
      rows.push(...r.transactions);
      key = r.continuation_key;
    } while (key);
    return mapEnableBankingTransactions(rows);
  }

  async revoke(sessionId: string): Promise<void> {
    await this.call("DELETE", `/sessions/${sessionId}`);
  }
}

function toAccount(a: { uid: string; name?: string; currency?: string; account_id?: { iban?: string } }): ProviderAccount {
  return {
    ref: a.uid,
    name: a.name ?? a.account_id?.iban ?? a.uid,
    currency: a.currency === "GBP" ? "GBP" : "EUR",
    ...(a.account_id?.iban ? { iban: a.account_id.iban } : {}),
  };
}
