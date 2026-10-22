export * from "./types";
export * from "./consent";
export * from "./mock";
export { EnableBankingProvider, enableBankingJwt, mapEnableBankingTransactions, type EnableBankingConfig } from "./enableBanking";

import { EnableBankingProvider } from "./enableBanking";
import { MockProvider } from "./mock";
import type { BankDataProvider } from "./types";

/** Picks the provider from configuration. GoCardless (Nordigen) is closed to new sign-ups and not bundled. */
export function providerFromEnv(env: Record<string, string | undefined>): BankDataProvider {
  if (env.BANK_PROVIDER === "enablebanking") {
    if (!env.ENABLE_BANKING_APP_ID || !env.ENABLE_BANKING_PRIVATE_KEY) {
      throw new Error("ENABLE_BANKING_APP_ID and ENABLE_BANKING_PRIVATE_KEY are required for the Enable Banking provider");
    }
    return new EnableBankingProvider({ applicationId: env.ENABLE_BANKING_APP_ID, privateKey: env.ENABLE_BANKING_PRIVATE_KEY.replace(/\\n/g, "\n") });
  }
  return new MockProvider();
}
