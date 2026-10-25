import { CURRENCIES, type Currency, type IsoDate } from "@cuntas/rules";
import type { FxRate } from "./schema";

type Quote = Exclude<Currency, "EUR">;

/**
 * ECB reference rates (EUR base). Uses the latest rate on or before a date, like the ECB's own
 * convention. Any pair converts through EUR, since the ECB quotes every currency against it.
 */
export class FxTable {
  private readonly series = new Map<Quote, { dates: string[]; rates: number[]; all: FxRate[] }>();

  constructor(rates: readonly FxRate[]) {
    const sorted = [...rates].sort((a, b) => a.date.localeCompare(b.date));
    for (const r of sorted) {
      const s = this.series.get(r.quote) ?? { dates: [], rates: [], all: [] };
      s.dates.push(r.date);
      s.rates.push(r.rate);
      s.all.push(r);
      this.series.set(r.quote, s);
    }
  }

  get isEmpty(): boolean {
    return this.series.size === 0;
  }

  has(currency: Currency): boolean {
    return currency === "EUR" || this.series.has(currency);
  }

  /** The stored rates for one currency, oldest first. */
  rates(quote: Quote): FxRate[] {
    return [...(this.series.get(quote)?.all ?? [])];
  }

  /** Units of `quote` per EUR on the date, or undefined if none are loaded. */
  perEur(quote: Currency, date: IsoDate): number | undefined {
    if (quote === "EUR") return 1;
    const s = this.series.get(quote);
    if (!s) return undefined;
    if (date < s.dates[0]!) return s.rates[0];
    let lo = 0;
    let hi = s.dates.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (s.dates[mid]! <= date) lo = mid;
      else hi = mid - 1;
    }
    return s.rates[lo];
  }

  /** GBP per EUR on the date, or undefined if no rates are loaded. */
  eurGbp(date: IsoDate): number | undefined {
    return this.perEur("GBP", date);
  }

  /** Rate to multiply an amount in `from` to get `to`. */
  rate(from: Currency, to: Currency, date: IsoDate): number | undefined {
    if (from === to) return 1;
    const fromPerEur = this.perEur(from, date);
    const toPerEur = this.perEur(to, date);
    if (fromPerEur === undefined || toPerEur === undefined) return undefined;
    // Same arithmetic as before for EUR/GBP: EUR->GBP is r, GBP->EUR is 1/r.
    if (from === "EUR") return toPerEur;
    if (to === "EUR") return 1 / fromPerEur;
    return toPerEur / fromPerEur;
  }

  tryConvert(amountMinor: number, from: Currency, to: Currency, date: IsoDate): number | null {
    const r = this.rate(from, to, date);
    return r === undefined ? null : Math.round(amountMinor * r);
  }

  convert(amountMinor: number, from: Currency, to: Currency, date: IsoDate): number {
    const v = this.tryConvert(amountMinor, from, to, date);
    if (v === null) throw new Error(`No FX rate for ${from}->${to} on ${date}`);
    return v;
  }
}

/** Currencies the ECB quotes against EUR that the app supports. */
export const FX_QUOTES = CURRENCIES.filter((c): c is Quote => c !== "EUR");

/** Parses the ECB daily or historical reference-rate XML into rates for the supported currencies. */
export function parseEcbXml(xml: string): FxRate[] {
  const out: FxRate[] = [];
  const re = /<Cube time=['"](\d{4}-\d{2}-\d{2})['"]>([\s\S]*?)<\/Cube>/g;
  for (const m of xml.matchAll(re)) {
    for (const quote of FX_QUOTES) {
      const hit = m[2]!.match(new RegExp(`currency=['"]${quote}['"] rate=['"]([\\d.]+)['"]`));
      if (hit) out.push({ date: m[1]!, base: "EUR", quote, rate: Number(hit[1]), source: "ECB" });
    }
  }
  return out;
}
