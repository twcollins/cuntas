import { sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Runs `fn` in a transaction scoped to one household. Row-level security only lets the
 * transaction see that household's rows. SET LOCAL ROLE drops to the non-owner app role
 * even if the connection itself has more privilege.
 */
export async function withTenant<T>(db: Db, ctx: { householdId: string | null; userId: string | null }, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE cuntas_app`);
    await tx.execute(sql`SELECT set_config('app.household_id', ${ctx.householdId ?? ""}, true), set_config('app.user_id', ${ctx.userId ?? ""}, true)`);
    return fn(tx);
  });
}

export async function createPostgresDb(url: string): Promise<{ db: Db; close: () => Promise<void> }> {
  const { default: postgres } = await import("postgres");
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const client = postgres(url, { max: 10 });
  return { db: drizzle(client, { schema }) as unknown as Db, close: () => client.end() };
}
