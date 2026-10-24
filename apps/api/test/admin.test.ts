import { beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { users } from "@cuntas/db";
import { createDemoDataset } from "@cuntas/ledger";
import { testApp } from "./helpers";

type T = Awaited<ReturnType<typeof testApp>>;
type U = Awaited<ReturnType<T["user"]>>;
let t: T;
let admin: U;
let owner: U;
let partner: U;
let stranger: U;

const post = (u: U, path: string, body?: unknown) => u.call(path, { method: "POST", ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
const patch = (u: U, path: string, body: unknown) => u.call(path, { method: "PATCH", body: JSON.stringify(body) });
const del = (u: U, path: string) => u.call(path, { method: "DELETE" });
const tokenOf = async (r: Response, key = "url") => ((await r.json()) as Record<string, string>)[key]!.split("#")[1]!;

beforeAll(async () => {
  t = await testApp();
  admin = await t.user("Admin");
  owner = await t.user("Orla");
  partner = await t.user("Pat");
  stranger = await t.user("Stranger");
  // Admin status is granted by the database owner (the admin CLI); the API cannot set it.
  await t.db.update(users).set({ isAdmin: true }).where(eq(users.id, admin.id));
});

describe("instance admin", () => {
  let hh: string;

  it("non-admins get 403 on admin routes", async () => {
    expect((await owner.call("/admin/households")).status).toBe(403);
    expect((await post(owner, "/admin/households", { name: "X", baseCurrency: "EUR" })).status).toBe(403);
  });

  it("/me reports admin status", async () => {
    expect(((await (await admin.call("/me")).json()) as { user: { isAdmin: boolean } }).user.isAdmin).toBe(true);
    expect(((await (await owner.call("/me")).json()) as { user: { isAdmin: boolean } }).user.isAdmin).toBe(false);
  });

  it("creates a household for someone else and hands it over with an owner invite", async () => {
    const r = await post(admin, "/admin/households", { name: "Orla's household", baseCurrency: "EUR" });
    expect(r.status).toBe(201);
    const body = (await r.clone().json()) as { id: string; ownerInviteUrl: string };
    hh = body.id;
    expect(body.ownerInviteUrl).toContain("/join#");
    // The admin is not a member, so cannot read the ledger.
    expect((await admin.call(`/households/${hh}/document`)).status).toBe(404);
    const token = await tokenOf(r, "ownerInviteUrl");
    expect((await post(owner, "/invites/accept", { token })).status).toBe(200);
    const me = (await (await owner.call("/me")).json()) as { households: { id: string; role: string }[] };
    expect(me.households).toEqual([expect.objectContaining({ id: hh, role: "owner", suspended: false })]);
  });

  it("lists households with metadata, never the ledger", async () => {
    await owner.call(`/households/${hh}/document`, { method: "PUT", body: JSON.stringify({ baseVersion: 0, dataset: createDemoDataset("2026-10-22") }) });
    const list = (await (await admin.call("/admin/households")).json()) as Record<string, unknown>[];
    const row = list.find((h) => h.id === hh)!;
    expect(row).toMatchObject({ name: "Orla's household", memberCount: 1, ownerNames: ["Orla"], documentVersion: 1, suspendedAt: null });
    expect(JSON.stringify(list)).not.toContain("Aoife");
  });

  it("renames and suspends; a suspended household is read-only for its members", async () => {
    expect((await patch(admin, `/admin/households/${hh}`, { name: "Renamed", suspended: true })).status).toBe(200);
    expect((await owner.call(`/households/${hh}/document`)).status).toBe(200);
    const put = await owner.call(`/households/${hh}/document`, { method: "PUT", body: JSON.stringify({ baseVersion: 1, dataset: createDemoDataset("2026-10-22") }) });
    expect(put.status).toBe(423);
    expect((await post(owner, `/households/${hh}/invites`)).status).toBe(423);
    const me = (await (await owner.call("/me")).json()) as { households: { name: string; suspended: boolean }[] };
    expect(me.households[0]).toMatchObject({ name: "Renamed", suspended: true });
    expect((await patch(admin, `/admin/households/${hh}`, { suspended: false })).status).toBe(200);
    expect((await post(owner, `/households/${hh}/invites`)).status).toBe(201);
  });

  it("manages members and always keeps an owner", async () => {
    const invite = await post(admin, `/admin/households/${hh}/invites`, { role: "member" });
    expect((await post(partner, "/invites/accept", { token: await tokenOf(invite) })).status).toBe(200);
    const members = (await (await admin.call(`/admin/households/${hh}/members`)).json()) as { userId: string; role: string }[];
    expect(members.map((m) => m.role)).toEqual(["owner", "member"]);
    expect((await patch(admin, `/admin/households/${hh}/members/${owner.id}`, { role: "member" })).status).toBe(409);
    expect((await patch(admin, `/admin/households/${hh}/members/${partner.id}`, { role: "owner" })).status).toBe(200);
    expect((await patch(admin, `/admin/households/${hh}/members/${owner.id}`, { role: "member" })).status).toBe(200);
    expect((await del(admin, `/admin/households/${hh}/members/${partner.id}`)).status).toBe(409);
    expect((await del(admin, `/admin/households/${hh}/members/${owner.id}`)).status).toBe(200);
  });

  it("deleting a household needs recent authentication", async () => {
    await t.db.execute(sql`UPDATE sessions SET reauth_at = now() - interval '1 hour' WHERE user_id = ${admin.id}`);
    expect((await del(admin, `/admin/households/${hh}`)).status).toBe(403);
    await t.db.execute(sql`UPDATE sessions SET reauth_at = now() WHERE user_id = ${admin.id}`);
    expect((await del(admin, `/admin/households/${hh}`)).status).toBe(200);
    expect((await del(admin, `/admin/households/${hh}`)).status).toBe(404);
    expect((await partner.call(`/households/${hh}/document`)).status).toBe(404);
  });

  it("lists users for the admin only", async () => {
    const list = (await (await admin.call("/admin/users")).json()) as { displayName: string; isAdmin: boolean }[];
    expect(list.find((u) => u.displayName === "Admin")!.isAdmin).toBe(true);
    expect((await stranger.call("/admin/users")).status).toBe(403);
  });
});

describe("household owners manage their own members", () => {
  it("owners change roles and remove members; members can leave but not remove others", async () => {
    const r = await post(owner, "/households", { name: "Own", baseCurrency: "EUR" });
    const hh = ((await r.json()) as { id: string }).id;
    const invite = await post(owner, `/households/${hh}/invites?role=member`);
    await post(stranger, "/invites/accept", { token: await tokenOf(invite) });
    expect((await (await stranger.call(`/households/${hh}/members`)).json()) as unknown[]).toHaveLength(2);
    expect((await del(stranger, `/households/${hh}/members/${owner.id}`)).status).toBe(404);
    expect((await patch(stranger, `/households/${hh}/members/${stranger.id}`, { role: "owner" })).status).toBe(404);
    expect((await del(stranger, `/households/${hh}/members/${stranger.id}`)).status).toBe(200);
    expect((await stranger.call(`/households/${hh}/document`)).status).toBe(404);
    expect((await del(owner, `/households/${hh}/members/${owner.id}`)).status).toBe(409);
  });
});
