import { sql } from "drizzle-orm";
import { notifications, withTenant, connections, type Db } from "@cuntas/db";
import { refreshEcbRates, syncConnection, type SyncDeps } from "@cuntas/api/services";
import { consentReminderDate } from "@cuntas/providers";
import { chartDefaults, deadlineFor, listPacks } from "@cuntas/rules";

type Row = { id: string; household_id: string };
const rowsOf = (r: unknown) => (Array.isArray(r) ? r : (r as { rows: unknown[] }).rows) as Row[];

async function activeConnections(db: Db): Promise<Row[]> {
  return rowsOf(await db.execute(sql`SELECT id, household_id FROM connections_due_for_sync()`));
}

/** Nightly: sync every active connection, one household transaction at a time. */
export async function nightlySync(deps: SyncDeps, today: string) {
  const results = [];
  for (const c of await activeConnections(deps.db)) {
    try {
      results.push({ id: c.id, ...(await syncConnection(deps, { householdId: c.household_id, userId: null }, c.id, today)) });
    } catch (e) {
      results.push({ id: c.id, fetched: 0, status: `error: ${(e as Error).message}` });
    }
  }
  return results;
}

export async function fxRefresh(db: Db, http?: typeof fetch) {
  return refreshEcbRates(db, undefined, http);
}

/** Queues re-consent reminders (7 days ahead by default) and tax-deadline reminders per household. */
export async function queueReminders(db: Db, today: string) {
  const days = chartDefaults().reminders.consentDaysAhead;
  let queued = 0;
  const year = Number(today.slice(0, 4));
  const deadlines: { kind: string; due: string }[] = [];
  for (const p of listPacks("IE")) {
    if (Number(p.taxYear) === year - 1) deadlines.push({ kind: `form11:${p.taxYear}`, due: deadlineFor(Number(p.taxYear), p.deadlines.form11) });
    if (Number(p.taxYear) === year) {
      for (const pay of p.cgt.payment) deadlines.push({ kind: `cgt:${p.taxYear}:${pay.disposalsThroughMonth}`, due: deadlineFor(year, { monthDay: pay.dueMonthDay, yearOffset: pay.yearOffset }) });
    }
  }
  const uk = listPacks("UK").find((p) => p.effective.from <= today && today <= p.effective.to);
  if (uk) deadlines.push({ kind: `uk-sa:${uk.taxYear}`, due: deadlineFor(Number(uk.taxYear.slice(0, 4)), uk.deadlines.selfAssessmentOnline) });

  const households = new Set((await activeConnections(db)).map((c) => c.household_id));
  for (const hh of households) {
    await withTenant(db, { householdId: hh, userId: null }, async (tx) => {
      for (const conn of await tx.select().from(connections)) {
        if (conn.status !== "active" || !conn.consentExpiresAt) continue;
        const due = consentReminderDate(conn.consentExpiresAt, days);
        const r = await tx.insert(notifications).values({ householdId: hh, kind: `reconsent:${conn.id}`, dueOn: due, payload: { institution: conn.institutionName, expiresAt: conn.consentExpiresAt } }).onConflictDoNothing().returning();
        queued += r.length;
      }
      for (const d of deadlines.filter((x) => x.due >= today)) {
        const r = await tx.insert(notifications).values({ householdId: hh, kind: d.kind, dueOn: d.due }).onConflictDoNothing().returning();
        queued += r.length;
      }
    });
  }
  return queued;
}
