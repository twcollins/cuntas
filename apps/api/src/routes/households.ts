import { CURRENCIES, type Currency } from "@cuntas/rules";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { connections, withTenant } from "@cuntas/db";
import { exportJson } from "@cuntas/ledger";
import { requireRecentAuth } from "../auth";
import type { Env } from "../deps";
import { audit } from "../services/audit";
import {
  ConflictError,
  acceptInvite,
  createHousehold,
  createInvite,
  deleteHousehold,
  getDocument,
  isMember,
  listHouseholds,
  putDocument,
} from "../services/households";
import { listProviderTransactions, revokeConnection, startConnection, syncConnection } from "../services/bankSync";
import { householdStatus, listMembers, MembershipError, removeMember, setMemberRole } from "../services/admin";

const json = <T extends z.ZodTypeAny>(schema: T, description = "OK") => ({ description, content: { "application/json": { schema } } });
const Household = z.object({ id: z.string().uuid(), name: z.string(), baseCurrency: z.enum(CURRENCIES) }).openapi("Household");
const HouseholdParam = z.object({ householdId: z.string().uuid() });
const ConnParam = HouseholdParam.extend({ connectionId: z.string().uuid() });
const Ok = z.object({ ok: z.boolean() });
// The dataset is validated by @cuntas/ledger's zod schema inside the service.
const DatasetBody = z.record(z.unknown()).openapi("Dataset");

/**
 * Checks membership (and ownership when asked). A suspended household is read-only: members can
 * still load and export their data, but not change it.
 */
async function member(c: { var: Env["Variables"] }, householdId: string, opts: { owner?: boolean; write?: boolean } = {}) {
  const user = c.var.user;
  if (!user) throw new HTTPException(401, { message: "Sign in required" });
  const m = await isMember(c.var.deps.db, user.id, householdId);
  if (!m || (opts.owner && m.role !== "owner")) throw new HTTPException(404, { message: "Household not found" });
  const ctx = { householdId, userId: user.id };
  if (opts.write !== false && (await householdStatus(c.var.deps.db, ctx))?.suspended) {
    throw new HTTPException(423, { message: "This household is suspended by the administrator and is read-only" });
  }
  return ctx;
}

export const householdRoutes = new OpenAPIHono<Env>();

householdRoutes.openapi(
  createRoute({ method: "get", path: "/me", responses: { 200: json(z.object({ user: z.object({ id: z.string(), displayName: z.string(), isAdmin: z.boolean() }), households: z.array(Household.extend({ role: z.string(), suspended: z.boolean() })) })) } }),
  async (c) => {
    const user = c.var.user;
    if (!user) throw new HTTPException(401, { message: "Sign in required" });
    const households = await listHouseholds(c.var.deps.db, user.id);
    return c.json(
      {
        user: { id: user.id, displayName: user.displayName, isAdmin: user.isAdmin },
        households: households.map(({ suspendedAt, ...h }) => ({ ...h, baseCurrency: h.baseCurrency as Currency, suspended: suspendedAt !== null })),
      },
      200,
    );
  },
);

householdRoutes.openapi(
  createRoute({
    method: "post",
    path: "/households",
    request: { body: { content: { "application/json": { schema: z.object({ name: z.string().min(1).max(80), baseCurrency: z.enum(CURRENCIES) }) } } } },
    responses: { 201: json(Household, "Created") },
  }),
  async (c) => {
    const user = c.var.user;
    if (!user) throw new HTTPException(401, { message: "Sign in required" });
    const h = await createHousehold(c.var.deps.db, c.var.deps.kek, user.id, c.req.valid("json"));
    return c.json(h, 201);
  },
);

householdRoutes.openapi(
  createRoute({
    method: "get",
    path: "/households/{householdId}/document",
    request: { params: HouseholdParam },
    responses: { 200: json(z.object({ version: z.number().int(), dataset: DatasetBody.nullable() })) },
  }),
  async (c) => {
    const ctx = await member(c, c.req.valid("param").householdId, { write: false });
    const doc = await getDocument(c.var.deps.db, c.var.deps.kek, ctx);
    return c.json(doc as never, 200);
  },
);

householdRoutes.openapi(
  createRoute({
    method: "put",
    path: "/households/{householdId}/document",
    request: { params: HouseholdParam, body: { content: { "application/json": { schema: z.object({ baseVersion: z.number().int().min(0), dataset: DatasetBody }) } } } },
    responses: { 200: json(z.object({ version: z.number().int() })), 409: json(z.object({ error: z.string(), currentVersion: z.number().int() }), "Version conflict") },
  }),
  async (c) => {
    const ctx = await member(c, c.req.valid("param").householdId);
    const { baseVersion, dataset } = c.req.valid("json");
    try {
      return c.json(await putDocument(c.var.deps.db, c.var.deps.kek, ctx, baseVersion, dataset as never), 200);
    } catch (e) {
      if (e instanceof ConflictError) return c.json({ error: "conflict", currentVersion: e.currentVersion }, 409);
      throw e;
    }
  },
);

householdRoutes.openapi(
  createRoute({
    method: "post",
    path: "/households/{householdId}/invites",
    request: { params: HouseholdParam, query: z.object({ role: z.enum(["owner", "member"]).optional() }) },
    responses: { 201: json(z.object({ url: z.string() }), "Invite link") },
  }),
  async (c) => {
    const ctx = await member(c, c.req.valid("param").householdId, { owner: true });
    const token = await createInvite(c.var.deps.db, ctx, { role: c.req.valid("query").role ?? "member" });
    return c.json({ url: `${c.var.deps.webOrigin}/join#${token}` }, 201);
  },
);

// Members: everyone can see who shares the household; owners change roles and remove people;
// anyone can leave.

const MemberParam = HouseholdParam.extend({ userId: z.string().uuid() });
const MemberRow = z.object({ userId: z.string(), displayName: z.string(), role: z.string(), joinedAt: z.string() }).openapi("HouseholdMember");

householdRoutes.openapi(
  createRoute({ method: "get", path: "/households/{householdId}/members", request: { params: HouseholdParam }, responses: { 200: json(z.array(MemberRow)) } }),
  async (c) => {
    const ctx = await member(c, c.req.valid("param").householdId, { write: false });
    return c.json(await listMembers(c.var.deps.db, ctx), 200);
  },
);

householdRoutes.openapi(
  createRoute({
    method: "patch",
    path: "/households/{householdId}/members/{userId}",
    request: { params: MemberParam, body: { content: { "application/json": { schema: z.object({ role: z.enum(["owner", "member"]) }) } } } },
    responses: { 200: json(Ok), 409: json(z.object({ error: z.string() }), "Would leave no owner") },
  }),
  async (c) => {
    const p = c.req.valid("param");
    const ctx = await member(c, p.householdId, { owner: true });
    try {
      await setMemberRole(c.var.deps.db, ctx, p.userId, c.req.valid("json").role);
      return c.json({ ok: true }, 200);
    } catch (e) {
      if (e instanceof MembershipError) return c.json({ error: e.message }, 409);
      throw e;
    }
  },
);

householdRoutes.openapi(
  createRoute({ method: "delete", path: "/households/{householdId}/members/{userId}", request: { params: MemberParam }, responses: { 200: json(Ok), 409: json(z.object({ error: z.string() }), "Would leave no owner") } }),
  async (c) => {
    const p = c.req.valid("param");
    const self = c.var.user?.id === p.userId;
    const ctx = await member(c, p.householdId, { owner: !self, write: false });
    try {
      await removeMember(c.var.deps.db, ctx, p.userId);
      return c.json({ ok: true }, 200);
    } catch (e) {
      if (e instanceof MembershipError) return c.json({ error: e.message }, 409);
      throw e;
    }
  },
);

householdRoutes.openapi(
  createRoute({
    method: "post",
    path: "/invites/accept",
    request: { body: { content: { "application/json": { schema: z.object({ token: z.string().min(16) }) } } } },
    responses: { 200: json(z.object({ householdId: z.string().uuid() })) },
  }),
  async (c) => {
    const user = c.var.user;
    if (!user) throw new HTTPException(401, { message: "Sign in required" });
    try {
      return c.json({ householdId: await acceptInvite(c.var.deps.db, user.id, c.req.valid("json").token) }, 200);
    } catch {
      throw new HTTPException(400, { message: "Invite link is invalid or has expired" });
    }
  },
);

householdRoutes.openapi(
  createRoute({ method: "get", path: "/households/{householdId}/export", request: { params: HouseholdParam }, responses: { 200: json(DatasetBody, "Full JSON export") } }),
  async (c) => {
    const ctx = await member(c, c.req.valid("param").householdId, { write: false });
    requireRecentAuth(c.var.user!);
    const doc = await getDocument(c.var.deps.db, c.var.deps.kek, ctx);
    await withTenant(c.var.deps.db, ctx, (tx) => audit(tx, { householdId: ctx.householdId, actor: ctx.userId, action: "export", entity: "household" }));
    c.header("Content-Disposition", `attachment; filename="cuntas-export.json"`);
    return c.body(doc.dataset ? exportJson(doc.dataset) : "{}", 200, { "Content-Type": "application/json" }) as never;
  },
);

householdRoutes.openapi(
  createRoute({ method: "delete", path: "/households/{householdId}", request: { params: HouseholdParam }, responses: { 200: json(Ok, "Deleted everything") } }),
  async (c) => {
    // Deleting everything stays possible while suspended: people can always take their data away.
    const ctx = await member(c, c.req.valid("param").householdId, { owner: true, write: false });
    requireRecentAuth(c.var.user!);
    const { db } = c.var.deps;
    const list = await withTenant(db, ctx, (tx) => tx.select({ id: connections.id }).from(connections));
    for (const conn of list) await revokeConnection(c.var.deps, ctx, conn.id);
    await deleteHousehold(db, ctx);
    await withTenant(db, { householdId: null, userId: ctx.userId }, (tx) => audit(tx, { householdId: null, actor: ctx.userId, action: "household.delete", entity: "household" }));
    return c.json({ ok: true }, 200);
  },
);

// Bank connections (read-only AIS through the configured provider).

householdRoutes.openapi(
  createRoute({
    method: "get",
    path: "/households/{householdId}/institutions",
    request: { params: HouseholdParam, query: z.object({ country: z.enum(["IE", "UK"]) }) },
    responses: { 200: json(z.array(z.object({ id: z.string(), name: z.string(), country: z.string() }))) },
  }),
  async (c) => {
    await member(c, c.req.valid("param").householdId, { write: false });
    return c.json(await c.var.deps.provider.listInstitutions(c.req.valid("query").country), 200);
  },
);

householdRoutes.openapi(
  createRoute({
    method: "post",
    path: "/households/{householdId}/connections",
    request: {
      params: HouseholdParam,
      body: { content: { "application/json": { schema: z.object({ institutionId: z.string(), institutionName: z.string(), country: z.enum(["IE", "UK"]) }) } } },
    },
    responses: { 201: json(z.object({ connectionId: z.string(), url: z.string().url() }), "Redirect the user to url") },
  }),
  async (c) => {
    const ctx = await member(c, c.req.valid("param").householdId);
    const r = await startConnection(c.var.deps, ctx, { ...c.req.valid("json"), redirectUrl: `${c.var.deps.apiOrigin}/bank/callback` });
    return c.json(r, 201);
  },
);

householdRoutes.openapi(
  createRoute({
    method: "get",
    path: "/households/{householdId}/connections",
    request: { params: HouseholdParam },
    responses: {
      200: json(z.array(z.object({ id: z.string(), institutionName: z.string(), status: z.string(), consentExpiresAt: z.string().nullable(), lastSyncedAt: z.string().nullable(), accounts: z.array(z.object({ ref: z.string(), name: z.string(), currency: z.string() })) }))),
    },
  }),
  async (c) => {
    const ctx = await member(c, c.req.valid("param").householdId, { write: false });
    const rows = await withTenant(c.var.deps.db, ctx, (tx) => tx.select().from(connections).where(eq(connections.householdId, ctx.householdId)));
    return c.json(rows.map((r) => ({ id: r.id, institutionName: r.institutionName, status: r.status, consentExpiresAt: r.consentExpiresAt, lastSyncedAt: r.lastSyncedAt, accounts: r.accounts })), 200);
  },
);

householdRoutes.openapi(
  createRoute({ method: "post", path: "/households/{householdId}/connections/{connectionId}/sync", request: { params: ConnParam }, responses: { 200: json(z.object({ fetched: z.number(), status: z.string() })) } }),
  async (c) => {
    const p = c.req.valid("param");
    const ctx = await member(c, p.householdId);
    return c.json(await syncConnection(c.var.deps, ctx, p.connectionId, new Date().toISOString().slice(0, 10)), 200);
  },
);

householdRoutes.openapi(
  createRoute({
    method: "get",
    path: "/households/{householdId}/connections/{connectionId}/transactions",
    request: { params: ConnParam, query: z.object({ since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }) },
    responses: { 200: json(z.array(z.object({ accountRef: z.string(), transaction: z.record(z.unknown()) }))) },
  }),
  async (c) => {
    const p = c.req.valid("param");
    const ctx = await member(c, p.householdId, { write: false });
    return c.json((await listProviderTransactions(c.var.deps, ctx, p.connectionId, c.req.valid("query").since)) as never, 200);
  },
);

householdRoutes.openapi(
  createRoute({ method: "delete", path: "/households/{householdId}/connections/{connectionId}", request: { params: ConnParam }, responses: { 200: json(Ok) } }),
  async (c) => {
    const p = c.req.valid("param");
    const ctx = await member(c, p.householdId);
    await revokeConnection(c.var.deps, ctx, p.connectionId);
    return c.json({ ok: true }, 200);
  },
);
