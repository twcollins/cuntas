import type { KeyValueStore } from "./types";

// The apps keep data in SQLite. Anyone who ran a build that stored it in the web view's
// IndexedDB gets it copied across once, on first launch: copy, read back, compare, then delete.

const INDEX_KEY = "cuntas:households:v2";
export const isOurs = (key: string) => key.startsWith("cuntas:");

export type MigrateResult = { moved: number } | { error: string };

export interface MigrateSource {
  entries(): Promise<[string, unknown][]>;
  del(keys: string[]): Promise<void>;
}

export async function migrateFromWebStorage(from: MigrateSource, to: KeyValueStore): Promise<MigrateResult> {
  try {
    if ((await to.get(INDEX_KEY)) !== undefined) return { moved: 0 };
    const ours = (await from.entries()).filter(([k]) => isOurs(k));
    if (!ours.some(([k]) => k === INDEX_KEY)) return { moved: 0 };
    await to.write(ours);
    for (const [k, v] of ours) {
      if (JSON.stringify(await to.get(k)) !== JSON.stringify(v)) throw new Error(`${k} did not read back the same`);
    }
    await from.del(ours.map(([k]) => k));
    return { moved: ours.length };
  } catch (e) {
    // Leave the source as it was, and take the half-written copy back out so the next launch tries again.
    try {
      const keys = (await to.keys()).filter(isOurs);
      await to.write([], keys);
    } catch {
      // Nothing more to do; the source is untouched.
    }
    return { error: (e as Error).message };
  }
}
