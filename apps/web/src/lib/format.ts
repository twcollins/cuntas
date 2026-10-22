import { formatMoney, formatRate, type Currency } from "@cuntas/rules";
import { parseAmount } from "@cuntas/importers";

export const money = (minor: number, currency: Currency, decimals = false) => formatMoney(minor, currency, { decimals });
export const moneyExact = (minor: number, currency: Currency) => formatMoney(minor, currency, { decimals: true });
export const pct = formatRate;

/** Parses user-typed money ("1,234.50", "€12") into minor units. */
export function parseMoneyInput(value: string): number | null {
  return parseAmount(value);
}

export function minorToInput(minor: number): string {
  return (minor / 100).toFixed(2).replace(/\.00$/, "");
}

export function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function monthLabel(period: string): string {
  return new Date(`${period}-01T00:00:00Z`).toLocaleDateString("en-IE", { month: "long", year: "numeric", timeZone: "UTC" });
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
