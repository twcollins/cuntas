// Grants or revokes instance admin. Runs as the database owner (DATABASE_ADMIN_URL), because the
// API's own role is not allowed to change admin status.
// Usage: pnpm --filter @cuntas/api admin list | grant <user> | revoke <user>
// <user> is a user id, an email, or a display name that matches exactly one user.
import { eq, or, sql } from "drizzle-orm";
import { createPostgresDb, users } from "@cuntas/db";

const [command, ...rest] = process.argv.slice(2);
const who = rest.join(" ").trim();
const url = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL is required");
const { db, close } = await createPostgresDb(url);

try {
  if (command === "list") {
    const rows = await db.select({ id: users.id, name: users.displayName, isAdmin: users.isAdmin }).from(users).orderBy(users.createdAt);
    for (const r of rows) console.log(`${r.isAdmin ? "admin " : "      "} ${r.id}  ${r.name}`);
  } else if ((command === "grant" || command === "revoke") && who) {
    const isUuid = /^[0-9a-f-]{36}$/i.test(who);
    const matches = await db
      .select({ id: users.id, name: users.displayName })
      .from(users)
      .where(isUuid ? eq(users.id, who) : or(eq(users.email, who.toLowerCase()), eq(users.displayName, who)));
    if (matches.length !== 1) {
      console.error(matches.length === 0 ? "No user matches." : `${matches.length} users match; use the user id (see: admin list).`);
      process.exitCode = 1;
    } else {
      const u = matches[0]!;
      await db.update(users).set({ isAdmin: command === "grant" }).where(eq(users.id, u.id));
      await db.execute(sql`INSERT INTO audit_events (household_id, actor, action, entity) VALUES (NULL, NULL, ${`admin.${command}`}, 'user')`);
      console.log(`${command === "grant" ? "Granted" : "Revoked"} admin for ${u.name} (${u.id}).`);
    }
  } else {
    console.error("Usage: admin list | grant <user id, email or name> | revoke <user>");
    process.exitCode = 1;
  }
} finally {
  await close();
}
