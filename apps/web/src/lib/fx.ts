import { FX_QUOTES, type FxRate } from "@cuntas/ledger";

/**
 * ECB reference rates via the Frankfurter mirror, which allows browser requests.
 * The self-hosted API serves the same ECB data from /fx.
 */
export async function fetchEcbRates(from: string, to: string): Promise<FxRate[]> {
  const res = await fetch(`https://api.frankfurter.app/${from}..${to}?from=EUR&to=${FX_QUOTES.join(",")}`);
  if (!res.ok) throw new Error(`FX fetch failed (${res.status})`);
  const body = (await res.json()) as { rates: Record<string, Partial<Record<(typeof FX_QUOTES)[number], number>>> };
  return Object.entries(body.rates).flatMap(([date, r]) =>
    FX_QUOTES.flatMap((quote) => (r[quote] ? [{ date, base: "EUR" as const, quote, rate: r[quote]!, source: "ECB via frankfurter.app" }] : [])),
  );
}

/** Adds new rates, replacing any stored for the same date and currency. */
export function mergeRates(existing: FxRate[], incoming: FxRate[]): FxRate[] {
  const byKey = new Map(existing.map((r) => [`${r.date}:${r.quote}`, r]));
  for (const r of incoming) byKey.set(`${r.date}:${r.quote}`, r);
  return [...byKey.values()].sort((a, b) => a.date.localeCompare(b.date) || a.quote.localeCompare(b.quote));
}
