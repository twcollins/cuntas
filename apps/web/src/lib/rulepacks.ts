import { del, get, set } from "idb-keyval";
import { useMemo, useSyncExternalStore } from "react";
import { residenceOn, type Dataset } from "@cuntas/ledger";
import {
  addDays,
  fingerprint,
  packFingerprint,
  parseRuleFile,
  rulePrompts,
  setLoadedPacks,
  type IsoDate,
  type LoadedPack,
  type PackCheck,
  type RuleFileError,
  type RuleNeed,
} from "@cuntas/rules";

// Tax rule files the user loaded on this device, and their checks of each pack. Stored once per
// device (not per household), because tax figures are the same for every household here.

const KEY = "cuntas:rulepacks:v1";
/** How long the "next year's figures are usually out" banner stays hidden. */
export const DISMISS_DAYS = 30;

export interface RuleFile {
  key: string;
  /** The file as loaded, so it can be re-checked, exported and backed up exactly. */
  text: string;
  fingerprint: string;
  name: string;
  addedAt: string;
}

/** Rule files and checks, as stored and as carried in an encrypted backup. */
export interface RulePackData {
  files: RuleFile[];
  checks: PackCheck[];
  /** Prompt id -> last day it stays hidden. */
  dismissed: Record<string, IsoDate>;
}

interface State extends RulePackData {
  status: "loading" | "ready";
  /** Bumped whenever the loaded packs change, so results recompute. */
  revision: number;
}

let state: State = { status: "loading", files: [], checks: [], dismissed: {}, revision: 0 };
const listeners = new Set<() => void>();

function emit(next: Partial<State>, packsChanged = false) {
  state = { ...state, ...next, revision: state.revision + (packsChanged ? 1 : 0) };
  for (const l of listeners) l();
}

async function persist() {
  const { files, checks, dismissed } = state;
  await set(KEY, { files, checks, dismissed } satisfies RulePackData);
}

/** Registers every stored file that still passes the checks; a file that no longer does is skipped. */
function register(files: RuleFile[]): RuleFile[] {
  const ok: { file: RuleFile; loaded: LoadedPack }[] = [];
  for (const file of files) {
    const r = parseRuleFile(file.text);
    if (r.ok && r.key === file.key) ok.push({ file, loaded: { key: r.key, pack: r.pack, fingerprint: file.fingerprint } });
  }
  setLoadedPacks(ok.map((o) => o.loaded));
  return ok.map((o) => o.file);
}

export async function loadRulePacks() {
  try {
    const raw = (await get(KEY)) as Partial<RulePackData> | undefined;
    const files = register(raw?.files ?? []);
    emit({ status: "ready", files, checks: raw?.checks ?? [], dismissed: raw?.dismissed ?? {} }, true);
  } catch {
    emit({ status: "ready" });
  }
}

export function useRulePacks(): State {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

export type AddResult = { ok: true; key: string; replaced: boolean } | { ok: false; errors: RuleFileError[] };

/** Checks a rule file and, if it passes, uses it from now on. A file that fails changes nothing. */
export async function addRuleFile(text: string, name: string): Promise<AddResult> {
  const r = parseRuleFile(text);
  if (!r.ok) return r;
  const file: RuleFile = { key: r.key, text, fingerprint: await fingerprint(text), name, addedAt: new Date().toISOString() };
  const replaced = state.files.some((f) => f.key === r.key);
  const files = register([...state.files.filter((f) => f.key !== r.key), file]);
  emit({ files }, true);
  await persist();
  return { ok: true, key: r.key, replaced };
}

export async function removeRuleFile(key: string) {
  const files = register(state.files.filter((f) => f.key !== key));
  emit({ files }, true);
  await persist();
}

/** Records that the user checked these sections of the pack in use for `key` (by its fingerprint). */
export async function saveCheck(key: string, sections: string[], today: IsoDate) {
  const fp = packFingerprint(key);
  if (!fp) return;
  const others = state.checks.filter((c) => c.key !== key);
  emit({ checks: sections.length ? [...others, { key, fingerprint: fp, checkedAt: today, sections }] : others });
  await persist();
}

export async function dismissPrompt(id: string, today: IsoDate) {
  emit({ dismissed: { ...state.dismissed, [id]: addDays(today, DISMISS_DAYS) } });
  await persist();
}

export function rulePackData(): RulePackData {
  const { files, checks, dismissed } = state;
  return { files, checks, dismissed };
}

/** Restores rule files and checks from a backup, keeping any file here that the backup doesn't have. */
export async function restoreRulePacks(data: RulePackData) {
  // Fingerprints are recomputed, so a check only carries over to the exact file it was made on.
  const incoming = await Promise.all(data.files.map(async (f) => ({ ...f, fingerprint: await fingerprint(f.text) })));
  const keys = new Set(incoming.map((f) => f.key));
  const files = register([...state.files.filter((f) => !keys.has(f.key)), ...incoming]);
  const checkKeys = new Set(data.checks.map((c) => c.key));
  emit({ files, checks: [...state.checks.filter((c) => !checkKeys.has(c.key)), ...data.checks], dismissed: { ...state.dismissed, ...data.dismissed } }, true);
  await persist();
}

export async function clearRulePacks() {
  setLoadedPacks([]);
  emit({ files: [], checks: [], dismissed: {} }, true);
  await del(KEY);
}

/** The tax rules this household needs today: each member's country of residence, and Scotland or their US state where it applies. */
export function ruleNeeds(ds: Dataset, asOf: IsoDate): RuleNeed[] {
  const out = new Map<string, RuleNeed>();
  for (const m of ds.members) {
    const jurisdiction = residenceOn(ds, m.id, asOf);
    const need: RuleNeed =
      jurisdiction === "UK" && m.ukRegion === "scotland" ? { jurisdiction, region: "scotland" } : jurisdiction === "US" && m.usState ? { jurisdiction, region: m.usState } : { jurisdiction };
    out.set(`${need.jurisdiction}/${need.region ?? ""}`, need);
  }
  return [...out.values()];
}

/** Banners for the open household: figures to check, and next year's figures to add. */
export function useRulePrompts(ds: Dataset, asOf: IsoDate) {
  const rp = useRulePacks();
  return useMemo(
    () => rulePrompts({ needs: ruleNeeds(ds, asOf), today: asOf, checks: rp.checks, dismissed: rp.dismissed }),
    // rp.revision changes whenever the loaded packs do.
    [ds, asOf, rp.checks, rp.dismissed, rp.revision],
  );
}
