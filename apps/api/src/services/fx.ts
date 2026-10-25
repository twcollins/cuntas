import { and, gte, lte, sql } from "drizzle-orm";
import { fxRates, type Db } from "@cuntas/db";
import { parseEcbXml, type FxRate } from "@cuntas/ledger";
import { isCurrency } from "@cuntas/rules";

export const ECB_DAILY = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
export const ECB_90D = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml";

/** Fetches ECB reference rates and stores those for the supported currencies. Returns how many rates were stored. */
export async function refreshEcbRates(db: Db, url = ECB_90D, http: typeof fetch = fetch): Promise<number> {
  const res = await http(url);
  if (!res.ok) throw new Error(`ECB fetch failed: ${res.status}`);
  const rates = parseEcbXml(await res.text());
  if (rates.length === 0) return 0;
  await db
    .insert(fxRates)
    .values(rates.map((r) => ({ date: r.date, base: r.base, quote: r.quote, rate: String(r.rate), source: r.source })))
    .onConflictDoUpdate({ target: [fxRates.date, fxRates.base, fxRates.quote], set: { rate: sql`excluded.rate`, source: sql`excluded.source` } });
  return rates.length;
}

export async function getRates(db: Db, from: string, to: string): Promise<FxRate[]> {
  const rows = await db.select().from(fxRates).where(and(gte(fxRates.date, from), lte(fxRates.date, to))).orderBy(fxRates.date);
  return rows.flatMap((r) => {
    const quote = r.quote.trim();
    return isCurrency(quote) && quote !== "EUR" ? [{ date: r.date, base: "EUR" as const, quote, rate: Number(r.rate), source: r.source }] : [];
  });
}
