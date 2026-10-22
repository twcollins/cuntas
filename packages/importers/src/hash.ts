/** FNV-1a 64-bit as hex. Deterministic in Node and the browser; used for content-hash ids, not security. */
export function fnv1a64(input: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (const byte of new TextEncoder().encode(input)) {
    hash ^= BigInt(byte);
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

/**
 * Assigns content-hash ids. Identical rows in the same file get an occurrence index,
 * so two identical coffees on one day both import, while re-importing the file adds nothing.
 */
export function assignContentIds<T extends { bookedAt: string; amountMinor: number; rawDescription: string; externalId?: string }>(
  rows: T[],
): (T & { externalId: string })[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    if (row.externalId) return row as T & { externalId: string };
    const key = `${row.bookedAt}|${row.amountMinor}|${row.rawDescription.trim().toLowerCase()}`;
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    return { ...row, externalId: `h:${fnv1a64(`${key}|${n}`)}` };
  });
}
