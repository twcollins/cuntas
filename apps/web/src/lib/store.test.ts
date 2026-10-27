import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakePlatform, memoryStore } from "./platform/fake";
import { backupDue, type HouseholdEntry } from "./store";

// The store against an in-memory platform: what it writes is what the next launch reads.

const disk = memoryStore();

async function launch() {
  vi.resetModules();
  const { setPlatform } = await import("./platform");
  setPlatform(fakePlatform(disk));
  const store = await import("./store");
  await store.loadStore();
  return store;
}

describe("store on the platform's key-value store", () => {
  beforeEach(() => disk.data.clear());

  it("a change survives the app being closed and opened again", async () => {
    const a = await launch();
    await a.startEmpty("Home", "EUR", { name: "Aoife", home: "IE" });
    a.update((d) => ({ ...d, household: { ...d.household, name: "Our home" } }), "rename");
    await a.flush();

    const b = await launch();
    let seen = "";
    b.update((d) => ((seen = d.household.name), d));
    expect(seen).toBe("Our home");
    expect([...disk.data.keys()].sort()).toEqual(["cuntas:household:" + JSON.parse(disk.data.get("cuntas:households:v2")!).activeId, "cuntas:households:v2"].sort());
  });

  it("removing a household deletes its record; wiping deletes everything", async () => {
    const a = await launch();
    const first = await a.startEmpty("One", "EUR");
    await a.startEmpty("Two", "GBP");
    await a.removeHousehold(first);
    expect(disk.data.has(`cuntas:household:${first}`)).toBe(false);
    expect(JSON.parse(disk.data.get("cuntas:households:v2")!).households.map((h: { name: string }) => h.name)).toEqual(["Two"]);
    await a.wipeAll();
    expect(disk.data.size).toBe(0);
  });
});

describe("the backup reminder", () => {
  const entry = (h: Partial<HouseholdEntry>): HouseholdEntry => ({ id: "local_1", name: "Home", sync: null, addedAt: "2026-09-01T09:00:00.000Z", ...h });
  const on = (iso: string) => new Date(iso);

  it("asks once the last backup is 30 days old and the household has changed since", () => {
    const h = entry({ backedUpAt: "2026-09-10T09:00:00.000Z", changedAt: "2026-09-20T09:00:00.000Z" });
    expect(backupDue(h, on("2026-10-09T09:00:00.000Z"))).toBe(false);
    expect(backupDue(h, on("2026-10-10T09:00:00.000Z"))).toBe(true);
  });

  it("counts from when the household was added if it was never backed up", () => {
    expect(backupDue(entry({ changedAt: "2026-09-02T09:00:00.000Z" }), on("2026-10-01T09:00:00.000Z"))).toBe(true);
  });

  it("doesn't ask when nothing changed since the last backup, or while hidden", () => {
    expect(backupDue(entry({ backedUpAt: "2026-09-10T09:00:00.000Z", changedAt: "2026-09-05T09:00:00.000Z" }), on("2026-12-01T00:00:00.000Z"))).toBe(false);
    expect(backupDue(entry({ changedAt: "2026-09-02T09:00:00.000Z" }), on("2026-12-01T00:00:00.000Z"))).toBe(true);
    expect(backupDue(entry({ changedAt: "2026-09-02T09:00:00.000Z", backupHiddenUntil: "2026-12-15T00:00:00.000Z" }), on("2026-12-01T00:00:00.000Z"))).toBe(false);
  });
});
