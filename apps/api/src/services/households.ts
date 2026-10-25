import type { Currency } from "@cuntas/rules";
import { and, eq } from "drizzle-orm";
import {
  decrypt,
  encrypt,
  householdDocuments,
  households,
  invites,
  memberships,
  newDataKey,
  randomToken,
  sha256,
  unwrapDataKey,
  withTenant,
  type Db,
  type Tx,
} from "@cuntas/db";
import { datasetSchema, type Dataset } from "@cuntas/ledger";
import { audit } from "./audit";

export class ConflictError extends Error {
  constructor(readonly currentVersion: number) {
    super("Document changed on the server");
  }
}

export async function householdKey(tx: Tx, kek: Buffer, householdId: string): Promise<Buffer> {
  const [h] = await tx.select({ dek: households.dekEncrypted }).from(households).where(eq(households.id, householdId));
  if (!h) throw new Error("Household not found");
  return unwrapDataKey(kek, h.dek);
}

export async function createHousehold(db: Db, kek: Buffer, userId: string, input: { name: string; baseCurrency: Currency }) {
  const id = globalThis.crypto.randomUUID();
  const { dekEncrypted } = newDataKey(kek);
  await withTenant(db, { householdId: id, userId }, async (tx) => {
    await tx.insert(households).values({ id, name: input.name, baseCurrency: input.baseCurrency, dekEncrypted });
    await tx.insert(memberships).values({ householdId: id, userId, role: "owner" });
    await audit(tx, { householdId: id, actor: userId, action: "household.create", entity: "household" });
  });
  return { id, name: input.name, baseCurrency: input.baseCurrency };
}

export async function isMember(db: Db, userId: string, householdId: string): Promise<{ role: string } | null> {
  return withTenant(db, { householdId, userId }, async (tx) => {
    const [m] = await tx.select({ role: memberships.role }).from(memberships).where(and(eq(memberships.householdId, householdId), eq(memberships.userId, userId)));
    return m ?? null;
  });
}

export async function listHouseholds(db: Db, userId: string) {
  const mine = await withTenant(db, { householdId: null, userId }, (tx) => tx.select().from(memberships).where(eq(memberships.userId, userId)));
  const out = [];
  for (const m of mine) {
    const [h] = await withTenant(db, { householdId: m.householdId, userId }, (tx) =>
      tx.select({ id: households.id, name: households.name, baseCurrency: households.baseCurrency, suspendedAt: households.suspendedAt }).from(households),
    );
    if (h) out.push({ ...h, role: m.role });
  }
  return out;
}

export async function getDocument(db: Db, kek: Buffer, ctx: { householdId: string; userId: string }): Promise<{ version: number; dataset: Dataset | null }> {
  return withTenant(db, ctx, async (tx) => {
    const [doc] = await tx.select().from(householdDocuments);
    if (!doc) return { version: 0, dataset: null };
    const key = await householdKey(tx, kek, ctx.householdId);
    return { version: doc.version, dataset: datasetSchema.parse(JSON.parse(decrypt(key, doc.ciphertext))) };
  });
}

/** Saves the household document with optimistic concurrency: baseVersion must match the stored version. */
export async function putDocument(db: Db, kek: Buffer, ctx: { householdId: string; userId: string }, baseVersion: number, dataset: Dataset) {
  const parsed = datasetSchema.parse(dataset);
  return withTenant(db, ctx, async (tx) => {
    const [doc] = await tx.select({ version: householdDocuments.version }).from(householdDocuments).for("update");
    const current = doc?.version ?? 0;
    if (current !== baseVersion) throw new ConflictError(current);
    const key = await householdKey(tx, kek, ctx.householdId);
    const ciphertext = encrypt(key, JSON.stringify(parsed));
    const version = current + 1;
    if (doc) await tx.update(householdDocuments).set({ version, ciphertext, updatedAt: new Date().toISOString(), updatedBy: ctx.userId });
    else await tx.insert(householdDocuments).values({ householdId: ctx.householdId, version, ciphertext, updatedBy: ctx.userId });
    return { version };
  });
}

export async function createInvite(db: Db, ctx: { householdId: string; userId: string }, opts: { role?: "owner" | "member"; ttlHours?: number } = {}) {
  const token = randomToken();
  const role = opts.role ?? "member";
  await withTenant(db, ctx, async (tx) => {
    await tx.insert(invites).values({
      tokenHash: sha256(token),
      householdId: ctx.householdId,
      createdBy: ctx.userId,
      role,
      expiresAt: new Date(Date.now() + (opts.ttlHours ?? 72) * 3_600_000).toISOString(),
    });
    await audit(tx, { householdId: ctx.householdId, actor: ctx.userId, action: `invite.create.${role}`, entity: "invite" });
  });
  return token;
}

export async function acceptInvite(db: Db, userId: string, token: string): Promise<string> {
  const { sql } = await import("drizzle-orm");
  return withTenant(db, { householdId: null, userId }, async (tx) => {
    // postgres.js returns an array of rows; PGlite returns { rows }.
    const r: unknown = await tx.execute(sql`SELECT accept_invite(${sha256(token)}, ${userId}::uuid) AS hh`);
    const rows = (Array.isArray(r) ? r : (r as { rows: unknown[] }).rows) as { hh: string }[];
    return rows[0]!.hh;
  });
}

export async function deleteHousehold(db: Db, ctx: { householdId: string; userId: string }) {
  await withTenant(db, ctx, async (tx) => {
    await tx.delete(households).where(eq(households.id, ctx.householdId));
  });
}
