import type { Currency } from "./money";

/**
 * Countries the app knows about: for nationality, banks, file importers and accounts.
 * Tax jurisdictions (with rule packs and calculators) are the subset in TAX_JURISDICTIONS.
 */
export const COUNTRIES = ["IE", "UK", "US"] as const;
export type Country = (typeof COUNTRIES)[number];

export interface CountryInfo {
  name: string;
  /** Used after "Moved to" and in sentences: "the UK". */
  inSentence: string;
  /** "Irish national", "Irish tax figures". */
  adjective: string;
  currency: Currency;
}

export const COUNTRY_INFO: Record<Country, CountryInfo> = {
  IE: { name: "Ireland", inSentence: "Ireland", adjective: "Irish", currency: "EUR" },
  UK: { name: "UK", inSentence: "the UK", adjective: "British", currency: "GBP" },
  US: { name: "United States", inSentence: "the US", adjective: "American", currency: "USD" },
};

export function isCountry(value: string): value is Country {
  return (COUNTRIES as readonly string[]).includes(value);
}
