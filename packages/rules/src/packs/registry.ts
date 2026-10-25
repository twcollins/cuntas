import { MANIFEST, RAW_PACKS } from "./generated";
import type { AnyPack, ChartDefaults, Dated, IePack, Jurisdiction, RulePack, TreatyPack, UkPack, UkRegion, UkRegionPack, UsPack, UsStatePack } from "./types";
import type { UsState } from "../usStates";
import type { Country } from "../countries";
import type { IsoDate } from "../dates";
import { taxYearOf } from "./years";

export { MANIFEST };

/** A rule pack read from a file the user loaded on this device. It replaces the built-in pack with the same key. */
export interface LoadedPack {
  /** "ie/2027", "uk/2027-28", "uk/scotland/2027-28", "us/ca/2027": the same keys as the built-in packs. */
  key: string;
  pack: AnyPack;
  /** SHA-256 of the file text, hex. */
  fingerprint: string;
}

let loaded: LoadedPack[] = [];
let cache: { packs: RulePack[]; regions: UkRegionPack[]; states: UsStatePack[]; byKey: Map<string, unknown> } | null = null;

/** Replaces the set of loaded rule files. Pass [] to use built-in packs only. */
export function setLoadedPacks(packs: readonly LoadedPack[]) {
  loaded = [...packs];
  cache = null;
}

export function loadedPacks(): readonly LoadedPack[] {
  return loaded;
}

function isPack(value: unknown): value is RulePack {
  return typeof value === "object" && value !== null && "jurisdiction" in value && "taxYear" in value;
}

function isRegionPack(value: unknown): value is UkRegionPack {
  return typeof value === "object" && value !== null && (value as { kind?: unknown }).kind === "ukRegion";
}

function isStatePack(value: unknown): value is UsStatePack {
  return typeof value === "object" && value !== null && (value as { kind?: unknown }).kind === "usState";
}

function registry() {
  if (!cache) {
    const byKey = new Map<string, unknown>(Object.entries(RAW_PACKS));
    for (const l of loaded) byKey.set(l.key, l.pack);
    const byStart = (a: { effective: { from: string } }, b: { effective: { from: string } }) => a.effective.from.localeCompare(b.effective.from);
    cache = {
      byKey,
      packs: [...byKey.values()].filter(isPack).sort(byStart),
      regions: [...byKey.values()].filter(isRegionPack).sort(byStart),
      states: [...byKey.values()].filter(isStatePack).sort(byStart),
    };
  }
  return cache;
}

/** The registry key for a pack: "ie/2027", "uk/2027-28", "uk/scotland/2027-28" or "us/ca/2027". */
export function packKey(pack: AnyPack): string {
  if (!("kind" in pack)) return `${pack.jurisdiction.toLowerCase()}/${pack.taxYear}`;
  return pack.kind === "ukRegion" ? `uk/${pack.region}/${pack.taxYear}` : `us/${pack.state.toLowerCase()}/${pack.taxYear}`;
}

/** A tax pack (national or regional) by key, built-in or loaded. */
export function packByKey(key: string): AnyPack | undefined {
  const p = registry().byKey.get(key);
  return isPack(p) || isRegionPack(p) || isStatePack(p) ? p : undefined;
}

/** Where the pack in use for a key came from. */
export function packOrigin(key: string): "builtin" | "file" | undefined {
  if (loaded.some((l) => l.key === key)) return "file";
  return key in RAW_PACKS ? "builtin" : undefined;
}

/** SHA-256 of the pack in use: the loaded file's, or the built-in YAML's from the manifest. */
export function packFingerprint(key: string): string | undefined {
  return loaded.find((l) => l.key === key)?.fingerprint ?? MANIFEST.find((m) => m.key === key)?.sha256;
}

export function listPacks(jurisdiction: "IE"): IePack[];
export function listPacks(jurisdiction: "UK"): UkPack[];
export function listPacks(jurisdiction: "US"): UsPack[];
export function listPacks(jurisdiction?: Jurisdiction): RulePack[];
export function listPacks(jurisdiction?: Jurisdiction): RulePack[] {
  return registry().packs.filter((p) => !jurisdiction || p.jurisdiction === jurisdiction);
}

export function getPack(jurisdiction: "IE", taxYear: string): IePack;
export function getPack(jurisdiction: "UK", taxYear: string): UkPack;
export function getPack(jurisdiction: "US", taxYear: string): UsPack;
export function getPack(jurisdiction: Jurisdiction, taxYear: string): RulePack {
  const pack = listPacks(jurisdiction).find((p) => p.taxYear === taxYear);
  if (!pack) throw new Error(`No ${jurisdiction} rule pack for tax year ${taxYear}`);
  return pack;
}

/** The pack whose effective range contains the date. Falls back to the latest earlier pack. */
export function packOn(jurisdiction: "IE", date: IsoDate): IePack;
export function packOn(jurisdiction: "UK", date: IsoDate): UkPack;
export function packOn(jurisdiction: "US", date: IsoDate): UsPack;
export function packOn(jurisdiction: Jurisdiction, date: IsoDate): RulePack;
export function packOn(jurisdiction: Jurisdiction, date: IsoDate): RulePack {
  const packs = listPacks(jurisdiction);
  const exact = packs.find((p) => p.effective.from <= date && date <= p.effective.to);
  const fallback = [...packs].reverse().find((p) => p.effective.from <= date) ?? packs[0];
  const pack = exact ?? fallback;
  if (!pack) throw new Error(`No ${jurisdiction} rule packs loaded`);
  return pack;
}

export { taxYearOf };

export function listStatePacks(state?: UsState): UsStatePack[] {
  return registry().states.filter((p) => !state || p.state === state);
}

/**
 * A state's pack for a tax year, falling back to its latest earlier pack (and saying so); null when
 * the state has no pack yet.
 */
export function statePackFor(state: UsState, taxYear: string): { pack: UsStatePack; exact: boolean } | null {
  const packs = listStatePacks(state);
  const exact = packs.find((p) => p.taxYear === taxYear);
  if (exact) return { pack: exact, exact: true };
  const earlier = [...packs].reverse().find((p) => p.taxYear < taxYear) ?? packs[0];
  return earlier ? { pack: earlier, exact: false } : null;
}

export function listRegionPacks(region?: UkRegion): UkRegionPack[] {
  return registry().regions.filter((p) => !region || p.region === region);
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

/** The pack for the tax year before this one, for side-by-side review. */
export function previousPack(key: string): AnyPack | undefined {
  const pack = packByKey(key);
  if (!pack) return undefined;
  const peers: AnyPack[] = !("kind" in pack) ? listPacks(pack.jurisdiction) : pack.kind === "ukRegion" ? listRegionPacks(pack.region) : listStatePacks(pack.state);
  return [...peers].reverse().find((p) => p.taxYear < pack.taxYear);
}

/** The latest pack on or before a date that defines an optional section. */
export function latestWith<K extends keyof IePack>(jurisdiction: "IE", key: K, date: IsoDate): IePack | undefined;
export function latestWith<K extends keyof UkPack>(jurisdiction: "UK", key: K, date: IsoDate): UkPack | undefined;
export function latestWith<K extends keyof UsPack>(jurisdiction: "US", key: K, date: IsoDate): UsPack | undefined;
export function latestWith(jurisdiction: Jurisdiction, key: string, date: IsoDate): RulePack | undefined {
  return [...listPacks(jurisdiction)].reverse().find((p) => p.effective.from <= date && (p as unknown as Record<string, unknown>)[key] !== undefined)
    ?? listPacks(jurisdiction).find((p) => (p as unknown as Record<string, unknown>)[key] !== undefined);
}

/** Next-step thresholds: the Irish flowchart, or the US one for a US household. */
export function chartDefaults(plan: "IE" | "US" = "IE"): ChartDefaults {
  return RAW_PACKS[plan === "US" ? "us/flowchart" : "ie/flowchart"] as ChartDefaults;
}

/** The Ireland-UK treaty. */
export function treaty(): TreatyPack {
  return treatyFor("IE", "UK");
}

/** The treaty between two countries, in either order. */
export function treatyFor(a: Country, b: Country): TreatyPack {
  const key = `xb/${[a, b].map((c) => c.toLowerCase()).sort().join("-")}`;
  const pack = RAW_PACKS[key] as TreatyPack | undefined;
  if (!pack) throw new Error(`No treaty pack for ${a}-${b}`);
  return pack;
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
