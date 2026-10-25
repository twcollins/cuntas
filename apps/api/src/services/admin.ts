import type { Currency } from "@cuntas/rules";
import { and, asc, count, eq, sql } from "drizzle-orm";
import { households, memberships, newDataKey, users, withTenant, type Db, type Tx } from "@cuntas/db";
import { audit } from "./audit";
import { createHousehold, createInvite } from "./households";

export class MembershipError extends Error {}

type Ctx = { householdId: string; userId: string };

/** Rows from postgres.js arrive as an array; PGlite wraps them in { rows }. */
function rowsOf<T>(r: unknown): T[] {
  return (Array.isArray(r) ? r : (r as { rows: unknown[] }).rows) as T[];
}

export async function isAdmin(db: Db, userId: string): Promise<boolean> {
  const [u] = await db.select({ isAdmin: users.isAdmin }).from(users).where(eq(users.id, userId));
  return u?.isAdmin ?? false;
}

export interface AdminHousehold {
  id: string;
  name: string;
  baseCurrency: string;
  createdAt: string;
  suspendedAt: string | null;
  memberCount: number;
  ownerNames: string[];
  documentVersion: number | null;
  documentUpdatedAt: string | null;
  connectionCount: number;
}

/** Every household's metadata. The database function itself returns nothing unless the user is an admin. */
export async function listAllHouseholds(db: Db, adminId: string): Promise<AdminHousehold[]> {
  const r = await withTenant(db, { householdId: null, userId: adminId }, (tx) => tx.execute(sql`SELECT * FROM admin_households()`));
  const iso = (v: unknown) => (v === null || v === undefined ? null : new Date(v as string).toISOString());
  return rowsOf<Record<string, unknown>>(r).map((x) => ({
    id: x.id as string,
    name: x.name as string,
    baseCurrency: x.base_currency as string,
    createdAt: iso(x.created_at)!,
    suspendedAt: iso(x.suspended_at),
    memberCount: Number(x.member_count),
    ownerNames: (x.owner_names as string[]) ?? [],
    documentVersion: x.document_version === null ? null : Number(x.document_version),
    documentUpdatedAt: iso(x.document_updated_at),
    connectionCount: Number(x.connection_count),
  }));
}

/**
 * Creates a household for someone else. The admin either joins as owner, or gets a one-time
 * owner invite to hand over, so the admin never becomes a member of a household they don't use.
 */
export async function adminCreateHousehold(db: Db, kek: Buffer, adminId: string, input: { name: string; baseCurrency: Currency; joinAsOwner: boolean }) {
  if (input.joinAsOwner) {
    const h = await createHousehold(db, kek, adminId, input);
    return { ...h, inviteToken: null };
  }
  const id = globalThis.crypto.randomUUID();
  const { dekEncrypted } = newDataKey(kek);
  await withTenant(db, { householdId: id, userId: adminId }, async (tx) => {
    await tx.insert(households).values({ id, name: input.name, baseCurrency: input.baseCurrency, dekEncrypted });
    await audit(tx, { householdId: id, actor: adminId, action: "admin.household.create", entity: "household" });
  });
  const inviteToken = await createInvite(db, { householdId: id, userId: adminId }, { role: "owner" });
  return { id, name: input.name, baseCurrency: input.baseCurrency, inviteToken };
}

export async function updateHousehold(db: Db, ctx: Ctx, patch: { name?: string; suspended?: boolean }, actorAction = "admin.household.update") {
  return withTenant(db, ctx, async (tx) => {
    const set: Partial<typeof households.$inferInsert> = {};
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.suspended !== undefined) set.suspendedAt = patch.suspended ? new Date().toISOString() : null;
    const [h] = await tx.update(households).set(set).where(eq(households.id, ctx.householdId)).returning({ id: households.id });
    if (!h) return false;
    const action = patch.suspended === undefined ? actorAction : patch.suspended ? "admin.household.suspend" : "admin.household.reinstate";
    await audit(tx, { householdId: ctx.householdId, actor: ctx.userId, action, entity: "household" });
    return true;
  });
}

export async function householdStatus(db: Db, ctx: Ctx): Promise<{ suspended: boolean } | null> {
  return withTenant(db, ctx, async (tx) => {
    const [h] = await tx.select({ suspendedAt: households.suspendedAt }).from(households).where(eq(households.id, ctx.householdId));
    return h ? { suspended: h.suspendedAt !== null } : null;
  });
}

export async function listMembers(db: Db, ctx: Ctx) {
  return withTenant(db, ctx, (tx) =>
    tx
      .select({ userId: memberships.userId, displayName: users.displayName, role: memberships.role, joinedAt: memberships.createdAt })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.householdId, ctx.householdId))
      .orderBy(asc(memberships.createdAt)),
  );
}

async function ownerCount(tx: Tx, householdId: string): Promise<number> {
  const [r] = await tx.select({ n: count() }).from(memberships).where(and(eq(memberships.householdId, householdId), eq(memberships.role, "owner")));
  return Number(r?.n ?? 0);
}

/** Changes a member's role. A household always keeps at least one owner. */
export async function setMemberRole(db: Db, ctx: Ctx, memberId: string, role: "owner" | "member") {
  await withTenant(db, ctx, async (tx) => {
    const [m] = await tx.select().from(memberships).where(and(eq(memberships.householdId, ctx.householdId), eq(memberships.userId, memberId))).for("update");
    if (!m) throw new MembershipError("Not a member of this household");
    if (m.role === "owner" && role === "member" && (await ownerCount(tx, ctx.householdId)) <= 1) throw new MembershipError("A household needs at least one owner");
    await tx.update(memberships).set({ role }).where(and(eq(memberships.householdId, ctx.householdId), eq(memberships.userId, memberId)));
    await audit(tx, { householdId: ctx.householdId, actor: ctx.userId, action: `membership.role.${role}`, entity: "membership" });
  });
}

/** Removes a member. The last owner can't be removed; delete the household instead. */
export async function removeMember(db: Db, ctx: Ctx, memberId: string) {
  await withTenant(db, ctx, async (tx) => {
    const [m] = await tx.select().from(memberships).where(and(eq(memberships.householdId, ctx.householdId), eq(memberships.userId, memberId))).for("update");
    if (!m) throw new MembershipError("Not a member of this household");
    if (m.role === "owner" && (await ownerCount(tx, ctx.householdId)) <= 1) throw new MembershipError("The last owner can't be removed; delete the household instead");
    await tx.delete(memberships).where(and(eq(memberships.householdId, ctx.householdId), eq(memberships.userId, memberId)));
    await audit(tx, { householdId: ctx.householdId, actor: ctx.userId, action: "membership.remove", entity: "membership" });
  });
}

export async function listUsers(db: Db) {
  const rows = await db
    .select({ id: users.id, displayName: users.displayName, isAdmin: users.isAdmin, createdAt: users.createdAt })
    .from(users)
    .orderBy(asc(users.createdAt));
  return rows;
}
