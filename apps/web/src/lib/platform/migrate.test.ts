import { describe, expect, it } from "vitest";
import { memoryStore } from "./fake";
import { migrateFromWebStorage, type MigrateSource } from "./migrate";

function source(initial: Record<string, unknown>): MigrateSource & { data: Map<string, unknown> } {
  const data = new Map(Object.entries(initial));
  return { data, entries: async () => [...data.entries()], del: async (keys) => keys.forEach((k) => data.delete(k)) };
}

const earlier = {
  "cuntas:households:v2": { activeId: "local_1", households: [{ id: "local_1", name: "Home", sync: null }] },
  "cuntas:household:local_1": { household: { name: "Home" }, transactions: [{ id: "t1", amountMinor: -1250 }] },
  "cuntas:rulepacks:v1": { files: [], checks: [], dismissed: {} },
  "someone-else": 1,
};

describe("moving an earlier build's data into the app's database", () => {
  it("copies every cuntas key, checks it, then removes the originals", async () => {
    const from = source(earlier);
    const to = memoryStore();
    expect(await migrateFromWebStorage(from, to)).toEqual({ moved: 3 });
    expect(await to.get("cuntas:household:local_1")).toEqual(earlier["cuntas:household:local_1"]);
    expect(await to.keys()).not.toContain("someone-else");
    expect([...from.data.keys()]).toEqual(["someone-else"]);
  });

  it("does nothing once the database has households, or when there is nothing to move", async () => {
    const from = source(earlier);
    const to = memoryStore({ "cuntas:households:v2": { activeId: null, households: [] } });
    expect(await migrateFromWebStorage(from, to)).toEqual({ moved: 0 });
    expect(from.data.size).toBe(4);
    expect(await migrateFromWebStorage(source({ "cuntas:rulepacks:v1": {} }), memoryStore())).toEqual({ moved: 0 });
  });

  it("leaves the original untouched, and the database empty, when a copy doesn't read back the same", async () => {
    const from = source(earlier);
    const to = memoryStore();
    const real = to.get.bind(to);
    to.get = async (key) => (key === "cuntas:household:local_1" ? ({ truncated: true } as never) : real(key));
    const r = await migrateFromWebStorage(from, to);
    expect(r).toEqual({ error: "cuntas:household:local_1 did not read back the same" });
    expect(from.data.size).toBe(4);
    expect(await to.keys()).toEqual([]);
  });

  it("leaves the original untouched when the database can't be written", async () => {
    const from = source(earlier);
    const to = memoryStore();
    to.write = async () => {
      throw new Error("disk full");
    };
    expect(await migrateFromWebStorage(from, to)).toEqual({ error: "disk full" });
    expect(from.data.size).toBe(4);
  });
});
