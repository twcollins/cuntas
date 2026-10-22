import type { Currency, IsoDate } from "@cuntas/rules";
import type { FxRate } from "./schema";

/** ECB reference rates (EUR base). Uses the latest rate on or before a date, like the ECB's own convention. */
export class FxTable {
  private readonly dates: string[];
  private readonly rates: number[];

  constructor(rates: readonly FxRate[]) {
    const sorted = [...rates].sort((a, b) => a.date.localeCompare(b.date));
    this.dates = sorted.map((r) => r.date);
    this.rates = sorted.map((r) => r.rate);
  }

  get isEmpty(): boolean {
    return this.dates.length === 0;
  }

  /** GBP per EUR on the date, or undefined if no rates are loaded. */
  eurGbp(date: IsoDate): number | undefined {
    if (this.isEmpty) return undefined;
    let lo = 0;
    let hi = this.dates.length - 1;
    if (date < this.dates[0]!) return this.rates[0];
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (this.dates[mid]! <= date) lo = mid;
      else hi = mid - 1;
    }
    return this.rates[lo];
  }

  /** Rate to multiply an amount in `from` to get `to`. */
  rate(from: Currency, to: Currency, date: IsoDate): number | undefined {
    if (from === to) return 1;
    const r = this.eurGbp(date);
    if (r === undefined) return undefined;
    return from === "EUR" ? r : 1 / r;
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

/** Parses the ECB daily or historical reference-rate XML into GBP rates. */
export function parseEcbXml(xml: string): FxRate[] {
  const out: FxRate[] = [];
  const re = /<Cube time=['"](\d{4}-\d{2}-\d{2})['"]>([\s\S]*?)<\/Cube>/g;
  for (const m of xml.matchAll(re)) {
    const gbp = m[2]!.match(/currency=['"]GBP['"] rate=['"]([\d.]+)['"]/);
    if (gbp) out.push({ date: m[1]!, base: "EUR", quote: "GBP", rate: Number(gbp[1]), source: "ECB" });
  }
  return out;
}
