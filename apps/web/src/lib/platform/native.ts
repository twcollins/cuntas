import { App } from "@capacitor/app";
import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection } from "@capacitor-community/sqlite";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { delMany } from "idb-keyval";
import { migrateFromWebStorage } from "./migrate";
import type { FileGateway, KeyValueStore, Platform } from "./types";
import { idbEntries, idbStore } from "./web";

// The iOS and Android apps: an encrypted SQLite database (SQLCipher) in place of the web view's
// IndexedDB, which the OS can clear under storage pressure. The plugin keeps the database key in
// the Keychain (iOS) or behind an Android Keystore key, made once on first launch.

const DB = "cuntas";

async function openDatabase(): Promise<SQLiteDBConnection> {
  const sqlite = new SQLiteConnection(CapacitorSQLite);
  if (!(await sqlite.isSecretStored()).result) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    await sqlite.setEncryptionSecret(btoa(String.fromCharCode(...bytes)));
  }
  const reuse = (await sqlite.checkConnectionsConsistency()).result && (await sqlite.isConnection(DB, false)).result;
  const db = reuse ? await sqlite.retrieveConnection(DB, false) : await sqlite.createConnection(DB, true, "secret", 1, false);
  await db.open();
  await db.execute("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, updated_at TEXT NOT NULL);", false);
  return db;
}

function sqliteStore(db: SQLiteDBConnection): KeyValueStore {
  return {
    async get(key) {
      const row = (await db.query("SELECT value FROM kv WHERE key = ?;", [key])).values?.[0] as { value: string } | undefined;
      return row ? JSON.parse(row.value) : undefined;
    },
    async write(set, del = []) {
      const at = new Date().toISOString();
      const statements = [
        ...set.map(([k, v]) => ({ statement: "INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, ?);", values: [k, JSON.stringify(v), at] })),
        ...del.map((k) => ({ statement: "DELETE FROM kv WHERE key = ?;", values: [k] })),
      ];
      if (statements.length) await db.executeSet(statements, true);
    },
    async keys() {
      return ((await db.query("SELECT key FROM kv;")).values ?? []).map((r) => (r as { key: string }).key);
    },
  };
}

const basename = (url: string) => decodeURIComponent(url.split(/[/?#]/).filter(Boolean).at(-1) ?? "file");

/** A file opened in Cúntas, read as bytes so statements in any encoding arrive as they are. */
async function readOpened(url: string): Promise<File> {
  const { data } = await Filesystem.readFile({ path: url });
  const bytes = typeof data === "string" ? Uint8Array.from(atob(data), (c) => c.charCodeAt(0)) : new Uint8Array(await data.arrayBuffer());
  return new File([bytes], basename(url));
}

const files: FileGateway = {
  async save(list) {
    const uris = await Promise.all(list.map(async (f) => (await Filesystem.writeFile({ path: f.name, data: f.data, directory: Directory.Cache, encoding: Encoding.UTF8 })).uri));
    try {
      await Share.share({ title: list.length === 1 ? list[0]!.name : "Cúntas export", files: uris });
    } catch (e) {
      // Closing the share sheet without choosing is not an error.
      if (!/cancel/i.test((e as Error).message)) throw e;
    }
  },
  onOpen(listener) {
    const open = async (url: string | undefined) => {
      // cuntas:// links are for server sign-in and invites, which the apps don't handle yet.
      if (!url || !/^(file|content):/.test(url)) return;
      try {
        listener([await readOpened(url)]);
      } catch {
        // A file the app can't read (moved, or permission withdrawn) is ignored.
      }
    };
    void App.getLaunchUrl().then((r) => open(r?.url));
    const handle = App.addListener("appUrlOpen", (e) => void open(e.url));
    return () => void handle.then((h) => h.remove());
  },
};

export async function native(name: "ios" | "android"): Promise<Platform> {
  const kv = sqliteStore(await openDatabase());
  const moved = await migrateFromWebStorage({ entries: idbEntries, del: (keys) => delMany(keys) }, kv);
  // If the copy failed, keep using the web view's store this time: the data is all still there.
  if ("error" in moved) return { name, kv: idbStore(), files, warning: `Your data couldn't be moved to the app's encrypted storage (${moved.error}). It's safe where it is; export a backup now.` };
  return { name, kv, files };
}
