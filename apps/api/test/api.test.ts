import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createDemoDataset } from "@cuntas/ledger";
import { testApp } from "./helpers";

type T = Awaited<ReturnType<typeof testApp>>;
let t: T;
let alice: Awaited<ReturnType<T["user"]>>;
let bob: Awaited<ReturnType<T["user"]>>;
let hh: string;

beforeAll(async () => {
  t = await testApp();
  alice = await t.user("Alice");
  bob = await t.user("Bob");
  const r = await alice.call("/households", { method: "POST", body: JSON.stringify({ name: "Alice HH", baseCurrency: "EUR" }) });
  expect(r.status).toBe(201);
  hh = ((await r.json()) as { id: string }).id;
});

describe("api", () => {
  it("health, openapi and signed-out rejection", async () => {
    expect((await t.app.request("/health")).status).toBe(200);
    const doc = (await (await t.app.request("/openapi.json")).json()) as { paths: Record<string, unknown> };
    expect(Object.keys(doc.paths)).toContain("/households/{householdId}/document");
    expect((await t.app.request("/me")).status).toBe(401);
  });

  it("passkey registration options are generated for the configured RP", async () => {
    const r = await t.app.request("/auth/passkey/register/options", { method: "POST", body: JSON.stringify({ displayName: "Carol" }), headers: { "content-type": "application/json" } });
    const body = (await r.json()) as { rp: { id: string }; challenge: string; authenticatorSelection: { residentKey: string } };
    expect(body.rp.id).toBe("localhost");
    expect(body.authenticatorSelection.residentKey).toBe("required");
    expect(r.headers.get("set-cookie")).toContain("cuntas_challenge");
  });

  it("saves and loads the encrypted household document with optimistic concurrency", async () => {
    const ds = createDemoDataset("2026-10-22");
    let r = await alice.call(`/households/${hh}/document`, { method: "PUT", body: JSON.stringify({ baseVersion: 0, dataset: ds }) });
    expect(await r.json()).toEqual({ version: 1 });
    r = await alice.call(`/households/${hh}/document`, { method: "PUT", body: JSON.stringify({ baseVersion: 0, dataset: ds }) });
    expect(r.status).toBe(409);
    const got = (await (await alice.call(`/households/${hh}/document`)).json()) as { version: number; dataset: unknown };
    expect(got.version).toBe(1);
    expect(got.dataset).toEqual(ds);
    // Stored ciphertext contains no plaintext.
    const raw = await t.db.execute(sql`SELECT ciphertext FROM household_documents`);
    expect(JSON.stringify(raw)).not.toContain("Aoife");
  });

  it("another user cannot read, write, or invite into the household", async () => {
    expect((await bob.call(`/households/${hh}/document`)).status).toBe(404);
    expect((await bob.call(`/households/${hh}/document`, { method: "PUT", body: JSON.stringify({ baseVersion: 1, dataset: createDemoDataset("2026-10-22") }) })).status).toBe(404);
    expect((await bob.call(`/households/${hh}/invites`, { method: "POST" })).status).toBe(404);
  });

  it("invite links add a member", async () => {
    const r = await alice.call(`/households/${hh}/invites`, { method: "POST" });
    const { url } = (await r.json()) as { url: string };
    const token = url.split("#")[1]!;
    expect((await bob.call("/invites/accept", { method: "POST", body: JSON.stringify({ token }) })).status).toBe(200);
    expect((await bob.call(`/households/${hh}/document`)).status).toBe(200);
    const me = (await (await bob.call("/me")).json()) as { households: { id: string; role: string }[] };
    expect(me.households).toEqual([expect.objectContaining({ id: hh, role: "member" })]);
    expect((await bob.call("/invites/accept", { method: "POST", body: JSON.stringify({ token }) })).status).toBe(400);
  });

  it("bank connection: consent, callback, sync and fetch through the mock provider", async () => {
    const inst = (await (await alice.call(`/households/${hh}/institutions?country=IE`)).json()) as { id: string; name: string }[];
    const start = await alice.call(`/households/${hh}/connections`, { method: "POST", body: JSON.stringify({ institutionId: inst[0]!.id, institutionName: inst[0]!.name, country: "IE" }) });
    const { url, connectionId } = (await start.json()) as { url: string; connectionId: string };
    const cb = new URL(url);
    const redirect = await alice.call(`/bank/callback${cb.search}`);
    expect(redirect.headers.get("location")).toBe("http://localhost:5173/accounts?bank=connected");
    const conns = (await (await alice.call(`/households/${hh}/connections`)).json()) as { status: string; consentExpiresAt: string }[];
    expect(conns[0]!.status).toBe("active");
    const sync = (await (await alice.call(`/households/${hh}/connections/${connectionId}/sync`, { method: "POST" })).json()) as { fetched: number };
    expect(sync.fetched).toBeGreaterThan(0);
    const again = (await (await alice.call(`/households/${hh}/connections/${connectionId}/sync`, { method: "POST" })).json()) as { fetched: number };
    const list = (await (await alice.call(`/households/${hh}/connections/${connectionId}/transactions?since=2000-01-01`)).json()) as unknown[];
    // The second sync re-fetches an overlap window; stored rows stay unique.
    expect(again.fetched).toBeGreaterThan(0);
    expect(list.length).toBe(sync.fetched);
    expect((await alice.call(`/households/${hh}/connections/${connectionId}`, { method: "DELETE" })).status).toBe(200);
  });

  it("export needs recent authentication", async () => {
    await t.db.execute(sql`UPDATE sessions SET reauth_at = now() - interval '1 hour'`);
    expect((await alice.call(`/households/${hh}/export`)).status).toBe(403);
    await t.db.execute(sql`UPDATE sessions SET reauth_at = now()`);
    const r = await alice.call(`/households/${hh}/export`);
    expect(r.status).toBe(200);
    expect(((await r.json()) as { schemaVersion: number }).schemaVersion).toBe(1);
  });

  it("native apps: extra CORS origins and SameSite=None cookies when configured", async () => {
    const native = await testApp({ extraOrigins: ["capacitor://localhost"], crossSiteCookies: true });
    const r = await native.app.request("/auth/passkey/register/options", { method: "POST", body: JSON.stringify({ displayName: "Dee" }), headers: { "content-type": "application/json", origin: "capacitor://localhost" } });
    expect(r.headers.get("access-control-allow-origin")).toBe("capacitor://localhost");
    expect(r.headers.get("set-cookie")).toMatch(/SameSite=None/);
    expect(r.headers.get("set-cookie")).toMatch(/Secure/);
    const web = await t.app.request("/health", { headers: { origin: "capacitor://localhost" } });
    expect(web.headers.get("access-control-allow-origin")).not.toBe("capacitor://localhost");
  });

  it("serves the rule-pack manifest", async () => {
    const r = (await (await t.app.request("/rule-packs/manifest")).json()) as { manifest: { key: string }[] };
    expect(r.manifest.map((m) => m.key)).toContain("ie/2027");
  });

  it("delete-all removes the household", async () => {
    const r = await alice.call(`/households/${hh}`, { method: "DELETE" });
    expect(r.status).toBe(200);
    expect((await alice.call(`/households/${hh}/document`)).status).toBe(404);
  });
});
