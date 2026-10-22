import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../migrations");

export function migrationFiles(): { name: string; sql: string }[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS_DIR, name), "utf8") }));
}

/** Applies pending SQL migrations in order. `exec` runs a multi-statement script; `query` returns rows. */
export async function migrate(runner: {
  exec: (sql: string) => Promise<unknown>;
  query: (sql: string, params?: unknown[]) => Promise<{ name: string }[]>;
}): Promise<string[]> {
  await runner.exec("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  const done = new Set((await runner.query("SELECT name FROM schema_migrations")).map((r) => r.name));
  const applied: string[] = [];
  for (const m of migrationFiles()) {
    if (done.has(m.name)) continue;
    await runner.exec(`BEGIN;\n${m.sql}\nINSERT INTO schema_migrations (name) VALUES ('${m.name.replace(/'/g, "''")}');\nCOMMIT;`);
    applied.push(m.name);
  }
  return applied;
}
