import type { FxRate } from "@cuntas/ledger";

/**
 * ECB reference rates via the Frankfurter mirror, which allows browser requests.
 * The self-hosted API serves the same ECB data from /fx.
 */
export async function fetchEcbRates(from: string, to: string): Promise<FxRate[]> {
  const res = await fetch(`https://api.frankfurter.app/${from}..${to}?from=EUR&to=GBP`);
  if (!res.ok) throw new Error(`FX fetch failed (${res.status})`);
  const body = (await res.json()) as { rates: Record<string, { GBP: number }> };
  return Object.entries(body.rates).map(([date, r]) => ({ date, base: "EUR", quote: "GBP", rate: r.GBP, source: "ECB via frankfurter.app" }));
}

export function mergeRates(existing: FxRate[], incoming: FxRate[]): FxRate[] {
  const byDate = new Map(existing.map((r) => [r.date, r]));
  for (const r of incoming) byDate.set(r.date, r);
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
