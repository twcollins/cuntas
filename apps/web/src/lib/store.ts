import { del, get, set } from "idb-keyval";
import { useSyncExternalStore } from "react";
import { createDemoDataset, createEmptyDataset, datasetSchema, withAudit, type Dataset } from "@cuntas/ledger";
import { today, type Currency } from "@cuntas/rules";

// Local-first: the household dataset lives in IndexedDB on this device. Server sync is optional.

const KEY = "cuntas:dataset:v1";
const SYNC_KEY = "cuntas:sync:v1";

export interface SyncMeta {
  apiUrl: string;
  householdId: string;
  version: number;
  dirty: boolean;
  lastSyncedAt: string | null;
}

interface State {
  status: "loading" | "empty" | "ready";
  dataset: Dataset | null;
  sync: SyncMeta | null;
}

let state: State = { status: "loading", dataset: null, sync: null };
const listeners = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function emit(next: State) {
  state = next;
  for (const l of listeners) l();
}

function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (state.dataset) void set(KEY, state.dataset);
    void (state.sync ? set(SYNC_KEY, state.sync) : del(SYNC_KEY));
  }, 150);
}

export async function loadStore() {
  try {
    const [raw, sync] = await Promise.all([get(KEY), get(SYNC_KEY)]);
    const parsed = raw ? datasetSchema.safeParse(raw) : null;
    emit({ status: parsed?.success ? "ready" : "empty", dataset: parsed?.success ? parsed.data : null, sync: (sync as SyncMeta) ?? null });
  } catch {
    emit({ status: "empty", dataset: null, sync: null });
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

export function update(fn: (ds: Dataset) => Dataset, auditAction?: string) {
  if (!state.dataset) return;
  let next = fn(state.dataset);
  if (auditAction) next = withAudit(next, "user", auditAction, "household");
  emit({ ...state, dataset: next, sync: state.sync ? { ...state.sync, dirty: true } : null });
  persist();
}

export function replaceDataset(ds: Dataset, sync: SyncMeta | null = state.sync) {
  emit({ status: "ready", dataset: ds, sync });
  persist();
}

export function setSync(sync: SyncMeta | null) {
  emit({ ...state, sync });
  persist();
}

export function startDemo() {
  replaceDataset(createDemoDataset(today()), null);
}

export function startEmpty(name: string, baseCurrency: Currency) {
  replaceDataset(createEmptyDataset(name, baseCurrency), null);
}

/** Delete everything on this device. */
export async function wipeAll() {
  clearTimeout(saveTimer);
  await Promise.all([del(KEY), del(SYNC_KEY)]);
  emit({ status: "empty", dataset: null, sync: null });
}
