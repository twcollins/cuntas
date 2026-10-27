import type { KeyValueStore, OutgoingFile, Platform } from "./types";

// In memory, for tests. Values are copied in and out, as a real store serialises them.

export function memoryStore(initial: Record<string, unknown> = {}): KeyValueStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial).map(([k, v]) => [k, JSON.stringify(v)]));
  return {
    data,
    async get(key) {
      const raw = data.get(key);
      return raw === undefined ? undefined : JSON.parse(raw);
    },
    async write(set, del = []) {
      for (const [k, v] of set) data.set(k, JSON.stringify(v));
      for (const k of del) data.delete(k);
    },
    async keys() {
      return [...data.keys()];
    },
  };
}

export function fakePlatform(kv: KeyValueStore = memoryStore()): Platform & { saved: OutgoingFile[]; open(files: File[]): void } {
  const saved: OutgoingFile[] = [];
  const listeners = new Set<(files: File[]) => void>();
  return {
    name: "fake",
    kv,
    saved,
    files: {
      async save(list) {
        saved.push(...list);
      },
      onOpen(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    open(files) {
      for (const l of listeners) l(files);
    },
  };
}
