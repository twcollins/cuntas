import { CURRENCIES } from "@cuntas/rules";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { connections, withTenant } from "@cuntas/db";
import { requireAdmin, requireRecentAuth } from "../auth";
import type { Env } from "../deps";
import { audit } from "../services/audit";
import {
  adminCreateHousehold,
  householdStatus,
  listAllHouseholds,
  listMembers,
  listUsers,
  MembershipError,
  removeMember,
  setMemberRole,
  updateHousehold,
} from "../services/admin";
import { revokeConnection } from "../services/bankSync";
import { createInvite, deleteHousehold } from "../services/households";

// Instance administration. Admins see household metadata and manage memberships; they never get
// a household's ledger, which is only served to its members.

const json = <T extends z.ZodTypeAny>(schema: T, description = "OK") => ({ description, content: { "application/json": { schema } } });
const Ok = z.object({ ok: z.boolean() });
const Err = z.object({ error: z.string() });
const HouseholdParam = z.object({ householdId: z.string().uuid() });
const MemberParam = HouseholdParam.extend({ userId: z.string().uuid() });
const AdminHousehold = z
  .object({
    id: z.string(),
    name: z.string(),
    baseCurrency: z.string(),
    createdAt: z.string(),
    suspendedAt: z.string().nullable(),
    memberCount: z.number(),
    ownerNames: z.array(z.string()),
    documentVersion: z.number().nullable(),
    documentUpdatedAt: z.string().nullable(),
    connectionCount: z.number(),
  })
  .openapi("AdminHousehold");

/** Admin context for one household; 404 if it doesn't exist. */
async function target(c: { var: Env["Variables"] }, householdId: string) {
  const admin = requireAdmin(c.var.user);
  const ctx = { householdId, userId: admin.id };
  if (!(await householdStatus(c.var.deps.db, ctx))) throw new HTTPException(404, { message: "Household not found" });
  return ctx;
}

export const adminRoutes = new OpenAPIHono<Env>();

adminRoutes.openapi(
  createRoute({ method: "get", path: "/admin/households", responses: { 200: json(z.array(AdminHousehold)) } }),
  async (c) => {
    const admin = requireAdmin(c.var.user);
    return c.json(await listAllHouseholds(c.var.deps.db, admin.id), 200);
  },
);

adminRoutes.openapi(
  createRoute({
    method: "post",
    path: "/admin/households",
    request: {
      body: { content: { "application/json": { schema: z.object({ name: z.string().min(1).max(80), baseCurrency: z.enum(CURRENCIES), joinAsOwner: z.boolean().default(false) }) } } },
    },
    responses: { 201: json(z.object({ id: z.string(), name: z.string(), baseCurrency: z.string(), ownerInviteUrl: z.string().nullable() }), "Created") },
  }),
  async (c) => {
    const admin = requireAdmin(c.var.user);
    const h = await adminCreateHousehold(c.var.deps.db, c.var.deps.kek, admin.id, c.req.valid("json"));
    return c.json({ id: h.id, name: h.name, baseCurrency: h.baseCurrency, ownerInviteUrl: h.inviteToken ? `${c.var.deps.webOrigin}/join#${h.inviteToken}` : null }, 201);
  },
);

adminRoutes.openapi(
  createRoute({
    method: "patch",
    path: "/admin/households/{householdId}",
    request: { params: HouseholdParam, body: { content: { "application/json": { schema: z.object({ name: z.string().min(1).max(80).optional(), suspended: z.boolean().optional() }) } } } },
    responses: { 200: json(Ok) },
  }),
  async (c) => {
    const ctx = await target(c, c.req.valid("param").householdId);
    await updateHousehold(c.var.deps.db, ctx, c.req.valid("json"));
    return c.json({ ok: true }, 200);
  },
);

adminRoutes.openapi(
  createRoute({ method: "delete", path: "/admin/households/{householdId}", request: { params: HouseholdParam }, responses: { 200: json(Ok, "Deleted") } }),
  async (c) => {
    const ctx = await target(c, c.req.valid("param").householdId);
    requireRecentAuth(c.var.user!);
    const { db } = c.var.deps;
    const list = await withTenant(db, ctx, (tx) => tx.select({ id: connections.id }).from(connections));
    for (const conn of list) await revokeConnection(c.var.deps, ctx, conn.id);
    await deleteHousehold(db, ctx);
    await withTenant(db, { householdId: null, userId: ctx.userId }, (tx) => audit(tx, { householdId: null, actor: ctx.userId, action: "admin.household.delete", entity: "household" }));
    return c.json({ ok: true }, 200);
  },
);

adminRoutes.openapi(
  createRoute({
    method: "get",
    path: "/admin/households/{householdId}/members",
    request: { params: HouseholdParam },
    responses: { 200: json(z.array(z.object({ userId: z.string(), displayName: z.string(), role: z.string(), joinedAt: z.string() }))) },
  }),
  async (c) => {
    const ctx = await target(c, c.req.valid("param").householdId);
    return c.json(await listMembers(c.var.deps.db, ctx), 200);
  },
);

adminRoutes.openapi(
  createRoute({
    method: "patch",
    path: "/admin/households/{householdId}/members/{userId}",
    request: { params: MemberParam, body: { content: { "application/json": { schema: z.object({ role: z.enum(["owner", "member"]) }) } } } },
    responses: { 200: json(Ok), 409: json(Err, "Would leave no owner") },
  }),
  async (c) => {
    const p = c.req.valid("param");
    const ctx = await target(c, p.householdId);
    try {
      await setMemberRole(c.var.deps.db, ctx, p.userId, c.req.valid("json").role);
      return c.json({ ok: true }, 200);
    } catch (e) {
      if (e instanceof MembershipError) return c.json({ error: e.message }, 409);
      throw e;
    }
  },
);

adminRoutes.openapi(
  createRoute({ method: "delete", path: "/admin/households/{householdId}/members/{userId}", request: { params: MemberParam }, responses: { 200: json(Ok), 409: json(Err, "Would leave no owner") } }),
  async (c) => {
    const p = c.req.valid("param");
    const ctx = await target(c, p.householdId);
    requireRecentAuth(c.var.user!);
    try {
      await removeMember(c.var.deps.db, ctx, p.userId);
      return c.json({ ok: true }, 200);
    } catch (e) {
      if (e instanceof MembershipError) return c.json({ error: e.message }, 409);
      throw e;
    }
  },
);

adminRoutes.openapi(
  createRoute({
    method: "post",
    path: "/admin/households/{householdId}/invites",
    request: { params: HouseholdParam, body: { content: { "application/json": { schema: z.object({ role: z.enum(["owner", "member"]).default("member") }) } } } },
    responses: { 201: json(z.object({ url: z.string() }), "Invite link") },
  }),
  async (c) => {
    const ctx = await target(c, c.req.valid("param").householdId);
    const token = await createInvite(c.var.deps.db, ctx, { role: c.req.valid("json").role });
    return c.json({ url: `${c.var.deps.webOrigin}/join#${token}` }, 201);
  },
);

adminRoutes.openapi(
  createRoute({
    method: "get",
    path: "/admin/users",
    responses: { 200: json(z.array(z.object({ id: z.string(), displayName: z.string(), isAdmin: z.boolean(), createdAt: z.string() }))) },
  }),
  async (c) => {
    requireAdmin(c.var.user);
    return c.json(await listUsers(c.var.deps.db), 200);
  },
);
