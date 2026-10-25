import type { ParsedTransaction } from "@cuntas/importers";
import type { Country, Currency, IsoDate } from "@cuntas/rules";

export interface ProviderInstitution {
  id: string;
  name: string;
  country: Country;
  bic?: string;
}

export interface ProviderAccount {
  ref: string;
  name: string;
  iban?: string;
  currency: Currency;
}

export interface ConsentSession {
  sessionId: string;
  consentExpiresAt: string;
  accounts: ProviderAccount[];
}

/**
 * Read-only account information (AIS) behind one interface, so switching aggregator is configuration.
 * Implementations never see or store bank credentials: the user authenticates with their bank.
 */
export interface BankDataProvider {
  readonly id: string;
  listInstitutions(country: Country): Promise<ProviderInstitution[]>;
  startConsent(input: { institution: ProviderInstitution; redirectUrl: string; state: string; validDays: number }): Promise<{ url: string; reference: string }>;
  completeConsent(input: { code: string }): Promise<ConsentSession>;
  fetchAccounts(sessionId: string): Promise<ProviderAccount[]>;
  fetchTransactions(accountRef: string, range: { from: IsoDate; to?: IsoDate }): Promise<ParsedTransaction[]>;
  revoke(sessionId: string): Promise<void>;
}

export class ProviderError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}
