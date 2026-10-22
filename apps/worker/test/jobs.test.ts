import { describe, expect, it } from "vitest";
import { fxRates, notifications } from "@cuntas/db";
import { testApp } from "../../api/test/helpers";
import { fxRefresh, nightlySync, queueReminders } from "../src/jobs";

describe("worker jobs", () => {
  it("syncs active connections and queues reminders", async () => {
    const t = await testApp();
    const alice = await t.user("Alice");
    const { id: hh } = (await (await alice.call("/households", { method: "POST", body: JSON.stringify({ name: "H", baseCurrency: "EUR" }) })).json()) as { id: string };
    const start = (await (await alice.call(`/households/${hh}/connections`, { method: "POST", body: JSON.stringify({ institutionId: "mock:aib", institutionName: "Mock AIB", country: "IE" }) })).json()) as { url: string };
    await alice.call(`/bank/callback${new URL(start.url).search}`);

    const results = await nightlySync(t.deps, "2026-10-22");
    expect(results).toHaveLength(1);
    expect(results[0]!.fetched).toBeGreaterThan(0);

    expect(await queueReminders(t.db, "2026-10-22")).toBeGreaterThan(0);
    const kinds = (await t.db.select().from(notifications)).map((n) => n.kind);
    expect(kinds.some((k) => k.startsWith("reconsent:"))).toBe(true);
    expect(kinds).toContain("cgt:2026:11");
    expect(kinds).toContain("uk-sa:2026-27");
  });

  it("stores ECB rates", async () => {
    const t = await testApp();
    const xml = `<gesmes:Envelope><Cube><Cube time="2026-10-21"><Cube currency="GBP" rate="0.8612"/></Cube><Cube time="2026-10-20"><Cube currency="GBP" rate="0.8601"/></Cube></Cube></gesmes:Envelope>`;
    const n = await fxRefresh(t.db, (async () => new Response(xml)) as unknown as typeof fetch);
    expect(n).toBe(2);
    expect((await t.db.select().from(fxRates)).map((r) => Number(r.rate))).toEqual([0.8612, 0.8601]);
  });
});
