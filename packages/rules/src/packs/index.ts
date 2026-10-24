import { MANIFEST, RAW_PACKS } from "./generated";
import type { ChartDefaults, Dated, IePack, Jurisdiction, RulePack, TreatyPack, UkPack, UkRegion, UkRegionPack } from "./types";
import type { IsoDate } from "../dates";

export * from "./types";
export { MANIFEST };

function isPack(value: unknown): value is RulePack {
  return typeof value === "object" && value !== null && "jurisdiction" in value && "taxYear" in value;
}

const allPacks: RulePack[] = Object.values(RAW_PACKS).filter(isPack);

export function listPacks(jurisdiction: "IE"): IePack[];
export function listPacks(jurisdiction: "UK"): UkPack[];
export function listPacks(jurisdiction?: Jurisdiction): RulePack[];
export function listPacks(jurisdiction?: Jurisdiction): RulePack[] {
  return allPacks
    .filter((p) => !jurisdiction || p.jurisdiction === jurisdiction)
    .sort((a, b) => a.effective.from.localeCompare(b.effective.from));
}

export function getPack(jurisdiction: "IE", taxYear: string): IePack;
export function getPack(jurisdiction: "UK", taxYear: string): UkPack;
export function getPack(jurisdiction: Jurisdiction, taxYear: string): RulePack {
  const pack = allPacks.find((p) => p.jurisdiction === jurisdiction && p.taxYear === taxYear);
  if (!pack) throw new Error(`No ${jurisdiction} rule pack for tax year ${taxYear}`);
  return pack;
}

/** The pack whose effective range contains the date. Falls back to the latest earlier pack. */
export function packOn(jurisdiction: "IE", date: IsoDate): IePack;
export function packOn(jurisdiction: "UK", date: IsoDate): UkPack;
export function packOn(jurisdiction: Jurisdiction, date: IsoDate): RulePack {
  const packs = listPacks(jurisdiction);
  const exact = packs.find((p) => p.effective.from <= date && date <= p.effective.to);
  const fallback = [...packs].reverse().find((p) => p.effective.from <= date) ?? packs[0];
  const pack = exact ?? fallback;
  if (!pack) throw new Error(`No ${jurisdiction} rule packs loaded`);
  return pack;
}

/** IE tax year is the calendar year; UK runs 6 April to 5 April. */
export function taxYearOf(jurisdiction: Jurisdiction, date: IsoDate): string {
  const year = Number(date.slice(0, 4));
  if (jurisdiction === "IE") return String(year);
  const start = date.slice(5) >= "04-06" ? year : year - 1;
  return `${start}-${String(start + 1).slice(2)}`;
}

function isRegionPack(value: unknown): value is UkRegionPack {
  return typeof value === "object" && value !== null && (value as { kind?: unknown }).kind === "ukRegion";
}

const regionPacks: UkRegionPack[] = Object.values(RAW_PACKS)
  .filter(isRegionPack)
  .sort((a, b) => a.effective.from.localeCompare(b.effective.from));

export function listRegionPacks(region?: UkRegion): UkRegionPack[] {
  return regionPacks.filter((p) => !region || p.region === region);
}

/**
 * The regional sub-pack for a UK tax year. When the year has none yet it falls back to the latest
 * earlier one and says so, because Scottish rates are set later than the UK Budget.
 */
export function regionPackFor(region: Exclude<UkRegion, "rUK">, taxYear: string): { pack: UkRegionPack; exact: boolean } {
  const packs = listRegionPacks(region);
  const exact = packs.find((p) => p.taxYear === taxYear);
  if (exact) return { pack: exact, exact: true };
  const earlier = [...packs].reverse().find((p) => p.taxYear < taxYear) ?? packs[0];
  if (!earlier) throw new Error(`No ${region} rule pack loaded`);
  return { pack: earlier, exact: false };
}

/** The latest pack on or before a date that defines an optional section. */
export function latestWith<K extends keyof IePack>(jurisdiction: "IE", key: K, date: IsoDate): IePack | undefined;
export function latestWith<K extends keyof UkPack>(jurisdiction: "UK", key: K, date: IsoDate): UkPack | undefined;
export function latestWith(jurisdiction: Jurisdiction, key: string, date: IsoDate): RulePack | undefined {
  return [...listPacks(jurisdiction)].reverse().find((p) => p.effective.from <= date && (p as unknown as Record<string, unknown>)[key] !== undefined)
    ?? listPacks(jurisdiction).find((p) => (p as unknown as Record<string, unknown>)[key] !== undefined);
}

export function chartDefaults(): ChartDefaults {
  return RAW_PACKS["ie/flowchart"] as ChartDefaults;
}

export function treaty(): TreatyPack {
  return RAW_PACKS["xb/ie-uk"] as TreatyPack;
}

/** Picks the value in effect on a date from a list of dated entries. */
export function onDate<T>(entries: readonly Dated<T>[], date: IsoDate): Dated<T> {
  const sorted = [...entries].sort((a, b) => a.from.localeCompare(b.from));
  const found = [...sorted].reverse().find((e) => e.from <= date);
  if (!found) throw new Error(`No rule value in effect on ${date}`);
  return found;
}

/** Rule-pack figures are major units; this is the single place they cross into minor units. */
export { toMinor as ruleMinor } from "../money";
