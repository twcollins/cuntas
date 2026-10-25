import { Document, isScalar, isMap, type Scalar } from "yaml";
import type { IsoDate } from "../dates";
import { packByKey, packKey } from "./registry";
import { packSections } from "./schema";
import { parentOf, type AnyPack } from "./types";
import { nextTaxYear, taxYearRange } from "./years";

const HEAD = ["kind", "region", "state", "parent", "jurisdiction", "taxYear", "version", "status", "currency", "effective", "sources"];

type Dated = { from: string };
const isDatedList = (v: unknown): v is Dated[] =>
  Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "object" && x !== null && typeof (x as Dated).from === "string");

/** Dated entries collapse to the one in force at the end of last year, starting on the new year's first day. */
function carryForward(value: unknown, lastDay: IsoDate, firstDay: IsoDate): unknown {
  if (isDatedList(value)) {
    const sorted = [...value].sort((a, b) => a.from.localeCompare(b.from));
    const inForce = [...sorted].reverse().find((e) => e.from <= lastDay) ?? sorted[0]!;
    return [{ ...inForce, from: firstDay }];
  }
  if (Array.isArray(value)) return value.map((v) => carryForward(v, lastDay, firstDay));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, carryForward(v, lastDay, firstDay)]));
  }
  return value;
}

/**
 * A draft rule file for the tax year after a pack: last year's figures with the year and dates moved
 * on, status provisional, and every section marked to check against its source.
 */
export function nextYearDraft(key: string, today: IsoDate): { key: string; filename: string; text: string } {
  const pack = packByKey(key);
  if (!pack) throw new Error(`No rule pack ${key}`);
  const j = parentOf(pack);
  const next = nextTaxYear(j, pack.taxYear);
  const range = taxYearRange(j, next);
  const prefix = /^(.*?)-\d{4}/.exec(pack.version)?.[1] ?? j;
  const sections = packSections(pack);
  const raw = pack as unknown as Record<string, unknown>;
  const draft: Record<string, unknown> = {};
  for (const k of HEAD) if (k in raw) draft[k] = raw[k];
  Object.assign(draft, { taxYear: next, version: `${prefix}-${next}.0`, status: "provisional", effective: range });
  for (const s of sections) draft[s] = carryForward(raw[s], pack.effective.to, range.from);

  const doc = new Document(draft);
  doc.commentBefore = [
    ` Draft rule pack for ${next}, made by Cúntas on ${today} from ${pack.version}.`,
    ` Every figure below is last year's. Check each section against its source, change what's different,`,
    ` then load this file in Settings > Tax rules > Add rule file.`,
  ].join("\n");
  if (isMap(doc.contents)) {
    for (const pair of doc.contents.items) {
      const k = isScalar(pair.key) ? String(pair.key.value) : "";
      if (!sections.includes(k)) continue;
      const src = (raw[k] as { source: string }).source;
      (pair.key as Scalar).commentBefore = ` CHECK: every figure in ${k} against ${src}`;
      (pair.key as Scalar).spaceBefore = true;
    }
  }
  const nextKey = packKey({ ...pack, taxYear: next } as AnyPack);
  return { key: nextKey, filename: `${nextKey.replaceAll("/", "-")}.yaml`, text: doc.toString({ lineWidth: 0 }) };
}

export interface FigureRow {
  path: string;
  before?: number | string | null;
  after: number | string | null;
  changed: boolean;
}

export interface SectionComparison {
  key: string;
  source: string;
  status?: string;
  rows: FigureRow[];
}

function leaves(value: unknown, prefix: string, out: Map<string, number | string | null>) {
  if (Array.isArray(value)) value.forEach((v, i) => leaves(v, prefix ? `${prefix}.${i}` : String(i), out));
  else if (typeof value === "object" && value !== null) {
    for (const [k, v] of Object.entries(value)) leaves(v, prefix ? `${prefix}.${k}` : k, out);
  } else if (typeof value === "number" || typeof value === "string" || value === null) out.set(prefix, value);
}

/** Each figure of a pack next to last year's, section by section, for review before ticking. */
export function comparePacks(previous: unknown, next: unknown): SectionComparison[] {
  const prev = (previous ?? {}) as Record<string, unknown>;
  const cur = next as Record<string, unknown>;
  return packSections(cur).map((key) => {
    const { source, status } = cur[key] as { source: string; status?: string };
    const a = new Map<string, number | string | null>();
    const b = new Map<string, number | string | null>();
    leaves(cur[key], "", a);
    leaves(prev[key], "", b);
    for (const m of [a, b]) for (const k of ["source", "status"]) m.delete(k);
    const rows = [...a].map(([path, after]) => ({ path, before: b.get(path), after, changed: b.get(path) !== after }));
    return { key, source, ...(status ? { status } : {}), rows };
  });
}
