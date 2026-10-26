import { planFor, residenceOn, type Dataset } from "@cuntas/ledger";
import { COUNTRIES, COUNTRY_INFO, CURRENCY_NAMES, today, type Currency, type Jurisdiction } from "@cuntas/rules";

// Wording and date style follow where the household lives: US terms ("checking", "401(k)") for a
// US household, Irish/UK terms otherwise.

export interface Terms {
  us: boolean;
  locale: "en-US" | "en-IE";
  currentAccount: string;
  cashGroup: string;
  pensions: string;
}

const US: Terms = { us: true, locale: "en-US", currentAccount: "Checking account", cashGroup: "Checking and savings", pensions: "401(k) and IRAs" };
const IE: Terms = { us: false, locale: "en-IE", currentAccount: "Current account", cashGroup: "Cash and current accounts", pensions: "Pensions" };

const BY_CURRENCY: Record<Dataset["household"]["baseCurrency"], Jurisdiction> = { EUR: "IE", GBP: "UK", USD: "US" };

/** Where the household lives: everyone's shared residence, or, before anyone is added, its base currency's country. */
export function homeOf(ds: Dataset, asOf = today()): Jurisdiction {
  if (ds.members.length === 0) return BY_CURRENCY[ds.household.baseCurrency];
  if (planFor(ds, asOf) === "US") return "US";
  const first = residenceOn(ds, ds.members[0]!.id, asOf);
  return ds.members.every((m) => residenceOn(ds, m.id, asOf) === first) ? first : "IE";
}

/** The country an account in this currency is most likely in: the household's own, if it uses that currency. */
export function countryForCurrency(ds: Dataset, currency: Currency): Jurisdiction {
  const home = homeOf(ds);
  if (COUNTRY_INFO[home].currency === currency) return home;
  return COUNTRIES.find((c) => COUNTRY_INFO[c].currency === currency) ?? home;
}

/** Whether anyone in the household is resident in a country (or, with nobody added, the household lives there). */
export function involves(ds: Dataset, country: Jurisdiction, asOf = today()): boolean {
  if (ds.members.length === 0) return homeOf(ds, asOf) === country;
  return ds.members.some((m) => residenceOn(ds, m.id, asOf) === country);
}

export function termsFor(ds: Dataset): Terms {
  return homeOf(ds) === "US" ? US : IE;
}

/** "euro", "pound sterling", "US dollar" without the qualifier: for "your next dollar". */
export function currencyWord(ds: Dataset): string {
  return { EUR: "euro", GBP: "pound", USD: "dollar" }[ds.household.baseCurrency] ?? CURRENCY_NAMES[ds.household.baseCurrency];
}
