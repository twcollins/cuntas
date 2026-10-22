import postgres from "postgres";
import { migrate } from "./migrate";

const url = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL or DATABASE_URL is required");
const sql = postgres(url, { max: 1, onnotice: () => {} });
const applied = await migrate({
  exec: (s) => sql.unsafe(s),
  query: async (s) => (await sql.unsafe(s)) as unknown as { name: string }[],
});
console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Database up to date.");
await sql.end();
