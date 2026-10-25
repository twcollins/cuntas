import { COUNTRY_INFO, CURRENCIES, CURRENCY_NAMES, formatMoney, formatRate, TAX_JURISDICTIONS, US_FILING_STATUSES, US_STATE_CODES, US_STATES, type Currency, type UsFilingStatus } from "@cuntas/rules";
import { parseAmount } from "@cuntas/importers";

export const money = (minor: number, currency: Currency, decimals = false) => formatMoney(minor, currency, { decimals });
export const moneyExact = (minor: number, currency: Currency) => formatMoney(minor, currency, { decimals: true });
export const pct = formatRate;

/** Options for a currency picker: "EUR", or "Euro (EUR)" in long form. */
export const currencyOptions = (long = false) => CURRENCIES.map((c) => ({ value: c, label: long ? `${CURRENCY_NAMES[c]} (${c})` : c }));

/** Countries with tax rules, for residence pickers. */
export const US_FILING_LABELS: Record<UsFilingStatus, string> = {
  single: "Single",
  marriedJoint: "Married filing jointly",
  marriedSeparate: "Married filing separately",
  headOfHousehold: "Head of household",
};
export const usFilingOptions = () => US_FILING_STATUSES.map((f) => ({ value: f, label: US_FILING_LABELS[f] }));

export const usStateOptions = (blank?: string) => [...(blank ? [{ value: "", label: blank }] : []), ...US_STATE_CODES.map((c) => ({ value: c, label: US_STATES[c] }))];

export const taxCountryOptions = () => TAX_JURISDICTIONS.map((j) => ({ value: j, label: COUNTRY_INFO[j].name }));

/** Parses user-typed money ("1,234.50", "€12") into minor units. */
export function parseMoneyInput(value: string): number | null {
  return parseAmount(value);
}

export function minorToInput(minor: number): string {
  return (minor / 100).toFixed(2).replace(/\.00$/, "");
}

let displayLocale: "en-IE" | "en-US" = "en-IE";

/** Dates read "3 Sep 2026" for Irish and UK households and "Sep 3, 2026" for US ones. Set from the open household. */
export function setDisplayLocale(locale: "en-IE" | "en-US") {
  displayLocale = locale;
}

export function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString(displayLocale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function monthLabel(period: string): string {
  return new Date(`${period}-01T00:00:00Z`).toLocaleDateString(displayLocale, { month: "long", year: "numeric", timeZone: "UTC" });
}

export function download(filename: string, content: string | Blob, type = "application/json") {
  const blob = typeof content === "string" ? new Blob([content], { type }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
