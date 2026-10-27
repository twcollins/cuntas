import { useSyncExternalStore } from "react";
import { createDemoDataset, createEmptyDataset, datasetSchema, newId, withAudit, type Dataset } from "@cuntas/ledger";
import { today, type Currency, type Jurisdiction } from "@cuntas/rules";
import { platform } from "./platform";

// Local-first: every household lives on this device (IndexedDB on the web, SQLite in the apps), one key each, with an index
// of households and the active one. Server sync is optional and set per household.

const INDEX_KEY = "cuntas:households:v2";
const ACCOUNT_KEY = "cuntas:account:v2";
const datasetKey = (id: string) => `cuntas:household:${id}`;

export interface SyncMeta {
  apiUrl: string;
  householdId: string;
  version: number;
  dirty: boolean;
  lastSyncedAt: string | null;
}

/** The person signed in to a self-hosted server on this device. */
export interface ServerAccount {
  apiUrl: string;
  userId: string;
  displayName: string;
  /** The signed-in user is an instance admin on this server. */
  isAdmin: boolean;
}

export interface HouseholdEntry {
  /** Local id; independent of the dataset's own id, so two copies of the demo can coexist. */
  id: string;
  name: string;
  sync: SyncMeta | null;
  /** When it was added to this device, last changed, and last saved as a backup or JSON export (ISO times). */
  addedAt?: string;
  changedAt?: string;
  backedUpAt?: string;
  /** "Back up this household" stays hidden until then. */
  backupHiddenUntil?: string;
}

interface State {
  status: "loading" | "empty" | "ready";
  dataset: Dataset | null;
  sync: SyncMeta | null;
  households: HouseholdEntry[];
  activeId: string | null;
  account: ServerAccount | null;
}

let state: State = { status: "loading", dataset: null, sync: null, households: [], activeId: null, account: null };
const listeners = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let pendingSave: (() => Promise<void>) | null = null;

function emit(next: Partial<State>) {
  const merged = { ...state, ...next };
  const active = merged.households.find((h) => h.id === merged.activeId) ?? null;
  state = { ...merged, sync: active?.sync ?? null };
  for (const l of listeners) l();
}

function snapshot() {
  const { dataset, activeId, households, account } = state;
  return () => {
    // One write, so the household and the index stay in step (one transaction in the apps).
    const set: [string, unknown][] = [[INDEX_KEY, { activeId, households }]];
    if (dataset && activeId) set.push([datasetKey(activeId), dataset]);
    if (account) set.push([ACCOUNT_KEY, account]);
    return platform().kv.write(set, account ? [] : [ACCOUNT_KEY]);
  };
}

function persist() {
  clearTimeout(saveTimer);
  pendingSave = snapshot();
  saveTimer = setTimeout(() => void flush(), 150);
}

// Leaving the page (closing the tab, reloading, the app going to the background) within the save
// delay would drop the last change; write it now. The OS may end a backgrounded app without warning.
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => void flush());
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && void flush());
}

/** Write any pending change now; called before switching households so nothing is lost. */
export async function flush() {
  clearTimeout(saveTimer);
  const save = pendingSave;
  pendingSave = null;
  if (save) await save();
}

async function readDataset(id: string): Promise<Dataset | null> {
  const raw = await platform().kv.get(datasetKey(id));
  const parsed = raw ? datasetSchema.safeParse(raw) : null;
  return parsed?.success ? parsed.data : null;
}

export async function loadStore() {
  try {
    const [index, account] = await Promise.all([platform().kv.get(INDEX_KEY), platform().kv.get(ACCOUNT_KEY)]);
    const now = new Date().toISOString();
    // Households from before the backup reminder count from today.
    const households: HouseholdEntry[] = ((index as { households?: HouseholdEntry[] } | undefined)?.households ?? []).map((h) => ({ ...h, addedAt: h.addedAt ?? now }));
    let activeId: string | null = (index as { activeId?: string } | undefined)?.activeId ?? households[0]?.id ?? null;
    if (activeId && !households.some((h) => h.id === activeId)) activeId = households[0]?.id ?? null;
    const dataset = activeId ? await readDataset(activeId) : null;
    emit({ status: dataset ? "ready" : "empty", dataset, households, activeId: dataset ? activeId : null, account: (account as ServerAccount) ?? null });
  } catch {
    emit({ status: "empty", dataset: null, households: [], activeId: null, account: null });
  }
}

export function useStore(): State {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

/** The dataset, for components rendered only once the store is ready. */
export function useDataset(): Dataset {
  const s = useStore();
  if (!s.dataset) throw new Error("Dataset not loaded");
  return s.dataset;
}

function withActive(fn: (h: HouseholdEntry) => HouseholdEntry): HouseholdEntry[] {
  return state.households.map((h) => (h.id === state.activeId ? fn(h) : h));
}

export function update(fn: (ds: Dataset) => Dataset, auditAction?: string) {
  if (!state.dataset) return;
  let next = fn(state.dataset);
  if (auditAction) next = withAudit(next, "user", auditAction, "household");
  emit({ dataset: next, households: withActive((h) => ({ ...h, name: next.household.name, sync: h.sync ? { ...h.sync, dirty: true } : null, changedAt: new Date().toISOString() })) });
  persist();
}

/** Replace the active household's data (an import, a bank sync, a restore, or a server copy). */
export function replaceDataset(ds: Dataset, sync: SyncMeta | null = state.sync) {
  emit({ status: "ready", dataset: ds, households: withActive((h) => ({ ...h, name: ds.household.name, sync, changedAt: new Date().toISOString() })) });
  persist();
}

/** Set or clear the active household's sync state. */
export function setSync(sync: SyncMeta | null) {
  emit({ households: withActive((h) => ({ ...h, sync })) });
  persist();
}

export function setAccount(account: ServerAccount | null) {
  emit({ account });
  persist();
}

/** Add a household to this device and make it the active one. Existing households are untouched. */
export async function addHousehold(ds: Dataset, sync: SyncMeta | null = null): Promise<string> {
  await flush();
  const id = newId("local");
  emit({ status: "ready", dataset: ds, households: [...state.households, { id, name: ds.household.name, sync, addedAt: new Date().toISOString() }], activeId: id });
  persist();
  await flush();
  return id;
}

export async function switchHousehold(id: string) {
  if (id === state.activeId) return;
  await flush();
  const dataset = await readDataset(id);
  if (!dataset) throw new Error("That household could not be read on this device.");
  emit({ status: "ready", dataset, activeId: id });
  persist();
}

/** Remove a household from this device only; a server copy, if any, is kept. */
export async function removeHousehold(id: string) {
  await flush();
  await platform().kv.write([], [datasetKey(id)]);
  const households = state.households.filter((h) => h.id !== id);
  if (id !== state.activeId) {
    emit({ households });
  } else {
    const nextId = households[0]?.id ?? null;
    const dataset = nextId ? await readDataset(nextId) : null;
    emit({ status: dataset ? "ready" : "empty", dataset, households, activeId: dataset ? nextId : null });
  }
  persist();
  await flush();
}

/** Set sync state on any household on this device (for example after deleting its server copy). */
export function setHouseholdSync(id: string, sync: SyncMeta | null) {
  emit({ households: state.households.map((h) => (h.id === id ? { ...h, sync } : h)) });
  persist();
}

/** The local household that syncs with a given server household, if there is one. */
export function findSynced(apiUrl: string, householdId: string): HouseholdEntry | undefined {
  return state.households.find((h) => h.sync?.apiUrl === apiUrl && h.sync.householdId === householdId);
}

/** Days without a backup, while the household changes, before Overview asks for one; also how long "Not now" hides it. */
export const BACKUP_DAYS = 30;
const DAY_MS = 86_400_000;

/** The phone or browser is the only copy for most people: ask for a backup once the last one is a month old and the household has changed since. */
export function backupDue(h: HouseholdEntry, now: Date): boolean {
  const since = h.backedUpAt ?? h.addedAt;
  if (!since || !h.changedAt || h.changedAt <= since) return false;
  if (h.backupHiddenUntil && now.toISOString() < h.backupHiddenUntil) return false;
  return now.getTime() - Date.parse(since) >= BACKUP_DAYS * DAY_MS;
}

/** The open household's entry on this device. */
export function useActiveEntry(): HouseholdEntry | undefined {
  const s = useStore();
  return s.households.find((h) => h.id === s.activeId);
}

export function markBackedUp() {
  emit({ households: withActive((h) => ({ ...h, backedUpAt: new Date().toISOString(), backupHiddenUntil: undefined })) });
  persist();
}

export function hideBackupReminder() {
  emit({ households: withActive((h) => ({ ...h, backupHiddenUntil: new Date(Date.now() + BACKUP_DAYS * DAY_MS).toISOString() })) });
  persist();
}

export function startDemo() {
  return addHousehold(createDemoDataset(today()));
}

export function startEmpty(name: string, baseCurrency: Currency, first?: { name: string; home: Jurisdiction }) {
  return addHousehold(createEmptyDataset(name, baseCurrency, undefined, first));
}

/** Delete every household and the sign-in from this device. */
export async function wipeAll() {
  clearTimeout(saveTimer);
  pendingSave = null;
  await platform().kv.write([], [...state.households.map((h) => datasetKey(h.id)), INDEX_KEY, ACCOUNT_KEY]);
  emit({ status: "empty", dataset: null, households: [], activeId: null, account: null });
}
