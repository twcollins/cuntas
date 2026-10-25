import { addDays, type Country, type IsoDate } from "@cuntas/rules";
import { assignContentIds } from "@cuntas/importers";
import type { BankDataProvider, ConsentSession, ProviderAccount, ProviderInstitution } from "./types";

/** In-memory provider for development, demos and tests. */
const isUk = (ref: string) => ref.includes("monzo") || ref.includes("hsbc-uk");

export class MockProvider implements BankDataProvider {
  readonly id = "mock";
  private sessions = new Map<string, ConsentSession>();

  async listInstitutions(country: Country): Promise<ProviderInstitution[]> {
    return country === "IE"
      ? [{ id: "mock:aib", name: "Mock AIB", country: "IE" }, { id: "mock:revolut", name: "Mock Revolut", country: "IE" }]
      : [{ id: "mock:monzo", name: "Mock Monzo", country: "UK" }, { id: "mock:hsbc-uk", name: "Mock HSBC UK", country: "UK" }];
  }

  async startConsent(input: { institution: ProviderInstitution; redirectUrl: string; state: string; validDays: number }) {
    const url = new URL(input.redirectUrl);
    url.searchParams.set("code", `mock-code:${input.institution.id}`);
    url.searchParams.set("state", input.state);
    return { url: url.toString(), reference: `mock-auth:${input.state}` };
  }

  async completeConsent(input: { code: string }): Promise<ConsentSession> {
    const institution = input.code.split(":").slice(1).join(":");
    const gbp = isUk(institution);
    const session: ConsentSession = {
      sessionId: `mock-session:${institution}:${this.sessions.size + 1}`,
      consentExpiresAt: new Date(Date.now() + 90 * 86_400_000).toISOString(),
      accounts: [{ ref: `${institution}:current`, name: `${institution} current`, currency: gbp ? "GBP" : "EUR" }],
    };
    this.sessions.set(session.sessionId, session);
    return session;
  }

  async fetchAccounts(sessionId: string): Promise<ProviderAccount[]> {
    return this.sessions.get(sessionId)?.accounts ?? [];
  }

  async fetchTransactions(accountRef: string, range: { from: IsoDate; to?: IsoDate }) {
    const gbp = isUk(accountRef);
    const to = range.to ?? new Date().toISOString().slice(0, 10);
    const rows = [];
    // A fixed 3-day grid, so overlapping windows return the same transactions like a real bank would.
    let d = range.from;
    while (Math.round(Date.parse(d) / 86_400_000) % 3 !== 0) d = addDays(d, 1);
    for (let i = Math.round(Date.parse(d) / 86_400_000); d <= to; d = addDays(d, 3), i++) {
      rows.push({ bookedAt: d, amountMinor: -(500 + ((i * 731) % 4000)), currency: gbp ? ("GBP" as const) : ("EUR" as const), payee: i % 2 ? "Tesco" : "Circle K", rawDescription: i % 2 ? "TESCO" : "CIRCLE K", externalId: `mock:${accountRef}:${d}` });
    }
    return assignContentIds(rows);
  }

  async revoke(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }
}
