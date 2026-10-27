import { createStore, delMany, entries, get, keys, setMany } from "idb-keyval";
import type { FileGateway, KeyValueStore, Platform } from "./types";

// The browser: IndexedDB through idb-keyval (its default database, so existing data stays where it is).

export function idbStore(store?: ReturnType<typeof createStore>): KeyValueStore {
  return {
    get: (key) => get(key, store),
    async write(set, del = []) {
      if (set.length) await setMany(set, store);
      if (del.length) await delMany(del, store);
    },
    keys: async () => (await keys(store)).map(String),
  };
}

/** Every entry, for the one-off copy into the native store. */
export async function idbEntries(): Promise<[string, unknown][]> {
  return (await entries()).map(([k, v]) => [String(k), v]);
}

interface LaunchParams {
  files: { getFile(): Promise<File> }[];
}
declare global {
  interface Window {
    launchQueue?: { setConsumer(consumer: (params: LaunchParams) => void): void };
  }
}

const files: FileGateway = {
  async save(list) {
    for (const f of list) {
      const url = URL.createObjectURL(new Blob([f.data], { type: f.mime }));
      const a = document.createElement("a");
      a.href = url;
      a.download = f.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  },
  onOpen(listener) {
    // An installed web app opened from the file manager ("Open with Cúntas"), where the browser supports file handlers.
    let live = true;
    window.launchQueue?.setConsumer(async (params) => {
      const opened = await Promise.all(params.files.map((h) => h.getFile()));
      if (live && opened.length) listener(opened);
    });
    return () => {
      live = false;
    };
  },
};

export const web: Platform = { name: "web", kv: idbStore(), files };
