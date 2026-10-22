import { and, eq, gte, sql } from "drizzle-orm";
import { connections, decrypt, encrypt, providerTransactions, randomToken, withTenant, type Db } from "@cuntas/db";
import type { ParsedTransaction } from "@cuntas/importers";
import { PSD2_CONSENT_DAYS, type BankDataProvider } from "@cuntas/providers";
import { addDays } from "@cuntas/rules";
import { audit } from "./audit";
import { householdKey } from "./households";

export interface SyncDeps {
  db: Db;
  kek: Buffer;
  provider: BankDataProvider;
}

/** Starts a read-only AIS consent. The state token ties the bank's redirect back to this connection. */
export async function startConnection(
  deps: SyncDeps,
  ctx: { householdId: string; userId: string },
  input: { institutionId: string; institutionName: string; country: "IE" | "UK"; redirectUrl: string },
) {
  const state = randomToken(24);
  const [conn] = await withTenant(deps.db, ctx, async (tx) => {
    const rows = await tx
      .insert(connections)
      .values({ householdId: ctx.householdId, provider: deps.provider.id, institutionName: input.institutionName, institutionCountry: input.country, status: "pending", consentState: state })
      .returning({ id: connections.id });
    await audit(tx, { householdId: ctx.householdId, actor: ctx.userId, action: "consent.start", entity: "connection" });
    return rows;
  });
  const { url } = await deps.provider.startConsent({
    institution: { id: input.institutionId, name: input.institutionName, country: input.country },
    redirectUrl: input.redirectUrl,
    state: `${ctx.householdId}.${state}`,
    validDays: PSD2_CONSENT_DAYS,
  });
  return { connectionId: conn!.id, url };
}

export async function completeConnection(deps: SyncDeps, ctx: { householdId: string; userId: string }, input: { state: string; code: string }) {
  const session = await deps.provider.completeConsent({ code: input.code });
  return withTenant(deps.db, ctx, async (tx) => {
    const [conn] = await tx.select().from(connections).where(and(eq(connections.consentState, input.state), eq(connections.status, "pending")));
    if (!conn) throw new Error("Unknown or used consent state");
    const key = await householdKey(tx, deps.kek, ctx.householdId);
    await tx
      .update(connections)
      .set({
        status: "active",
        consentState: null,
        sessionRefEncrypted: encrypt(key, session.sessionId),
        consentExpiresAt: session.consentExpiresAt,
        accounts: session.accounts,
      })
      .where(eq(connections.id, conn.id));
    await audit(tx, { householdId: ctx.householdId, actor: ctx.userId, action: "consent.granted", entity: "connection" });
    return conn.id;
  });
}

/** Pulls transactions for every account on a connection and stores them encrypted. Idempotent on external id. */
export async function syncConnection(deps: SyncDeps, ctx: { householdId: string; userId: string | null }, connectionId: string, today: string) {
  return withTenant(deps.db, ctx, async (tx) => {
    const [conn] = await tx.select().from(connections).where(eq(connections.id, connectionId));
    if (!conn || conn.status !== "active") return { fetched: 0, status: conn?.status ?? "missing" };
    if (conn.consentExpiresAt && conn.consentExpiresAt.slice(0, 10) <= today) {
      await tx.update(connections).set({ status: "expired" }).where(eq(connections.id, conn.id));
      await audit(tx, { householdId: ctx.householdId, actor: null, action: "consent.expired", entity: "connection" });
      return { fetched: 0, status: "expired" };
    }
    const key = await householdKey(tx, deps.kek, ctx.householdId);
    const from = conn.lastSyncedAt ? addDays(conn.lastSyncedAt.slice(0, 10), -7) : addDays(today, -PSD2_CONSENT_DAYS);
    let fetched = 0;
    for (const account of conn.accounts) {
      const txs = await deps.provider.fetchTransactions(account.ref, { from, to: today });
      if (txs.length === 0) continue;
      await tx
        .insert(providerTransactions)
        .values(txs.map((t) => ({ householdId: ctx.householdId, connectionId: conn.id, accountRef: account.ref, externalId: t.externalId, bookedAt: t.bookedAt, payloadEncrypted: encrypt(key, JSON.stringify(t)) })))
        .onConflictDoUpdate({
          target: [providerTransactions.connectionId, providerTransactions.accountRef, providerTransactions.externalId],
          set: { payloadEncrypted: sql`excluded.payload_encrypted`, fetchedAt: sql`now()` },
        });
      fetched += txs.length;
    }
    await tx.update(connections).set({ lastSyncedAt: new Date().toISOString() }).where(eq(connections.id, conn.id));
    return { fetched, status: "active" };
  });
}

export async function listProviderTransactions(deps: SyncDeps, ctx: { householdId: string; userId: string }, connectionId: string, since: string) {
  return withTenant(deps.db, ctx, async (tx) => {
    const key = await householdKey(tx, deps.kek, ctx.householdId);
    const rows = await tx
      .select()
      .from(providerTransactions)
      .where(and(eq(providerTransactions.connectionId, connectionId), gte(providerTransactions.bookedAt, since)))
      .orderBy(providerTransactions.bookedAt);
    return rows.map((r) => ({ accountRef: r.accountRef, transaction: JSON.parse(decrypt(key, r.payloadEncrypted)) as ParsedTransaction }));
  });
}

export async function revokeConnection(deps: SyncDeps, ctx: { householdId: string; userId: string }, connectionId: string) {
  await withTenant(deps.db, ctx, async (tx) => {
    const [conn] = await tx.select().from(connections).where(eq(connections.id, connectionId));
    if (!conn) return;
    if (conn.sessionRefEncrypted) {
      const key = await householdKey(tx, deps.kek, ctx.householdId);
      await deps.provider.revoke(decrypt(key, conn.sessionRefEncrypted)).catch(() => undefined);
    }
    await tx.update(connections).set({ status: "revoked", sessionRefEncrypted: null }).where(eq(connections.id, conn.id));
    await tx.delete(providerTransactions).where(eq(providerTransactions.connectionId, conn.id));
    await audit(tx, { householdId: ctx.householdId, actor: ctx.userId, action: "consent.revoked", entity: "connection" });
  });
}
