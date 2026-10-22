import { auditEvents, type Tx } from "@cuntas/db";

/** Records security-relevant events: sign-ins, consent changes, exports and deletions. No personal data. */
export async function audit(tx: Tx, e: { householdId: string | null; actor: string | null; action: string; entity: string }) {
  await tx.insert(auditEvents).values({ householdId: e.householdId, actor: e.actor, action: e.action, entity: e.entity });
}
