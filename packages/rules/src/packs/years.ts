import type { IsoDate } from "../dates";
import type { Jurisdiction } from "./types";

/** IE and US tax years are calendar years; UK runs 6 April to 5 April. */
const calendar = (j: Jurisdiction) => j !== "UK";

export function taxYearOf(jurisdiction: Jurisdiction, date: IsoDate): string {
  const year = Number(date.slice(0, 4));
  if (calendar(jurisdiction)) return String(year);
  const start = date.slice(5) >= "04-06" ? year : year - 1;
  return ukYear(start);
}

const ukYear = (start: number) => `${start}-${String(start + 1).slice(2)}`;

/** First and last day of a tax year, e.g. UK "2027-28" runs 2027-04-06 to 2028-04-05. */
export function taxYearRange(jurisdiction: Jurisdiction, taxYear: string): { from: IsoDate; to: IsoDate } {
  const start = Number(taxYear.slice(0, 4));
  if (calendar(jurisdiction)) return { from: `${start}-01-01`, to: `${start}-12-31` };
  return { from: `${start}-04-06`, to: `${start + 1}-04-05` };
}

export function nextTaxYear(jurisdiction: Jurisdiction, taxYear: string): string {
  const start = Number(taxYear.slice(0, 4)) + 1;
  return calendar(jurisdiction) ? String(start) : ukYear(start);
}

/** Tax years are written "2027" (IE, US) or "2027-28" (UK). */
export function isTaxYear(jurisdiction: Jurisdiction, taxYear: string): boolean {
  if (calendar(jurisdiction)) return /^\d{4}$/.test(taxYear);
  const m = /^(\d{4})-(\d{2})$/.exec(taxYear);
  return m !== null && ukYear(Number(m[1])) === taxYear;
}
