import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate, schema, users, type Db } from "@cuntas/db";
import { MockProvider } from "@cuntas/providers";
import { createApp, createSession } from "../src";

export async function testApp(overrides: Partial<Parameters<typeof createApp>[0]> = {}) {
  const pg = new PGlite();
  await migrate({ exec: (s) => pg.exec(s), query: async (s) => (await pg.query<{ name: string }>(s)).rows });
  const db = drizzle(pg, { schema }) as unknown as Db;
  const deps = {
    db,
    kek: randomBytes(32),
    provider: new MockProvider(),
    rp: { id: "localhost", name: "Cúntas", origin: "http://localhost:5173" },
    webOrigin: "http://localhost:5173",
    apiOrigin: "http://localhost:8787",
    secureCookies: false,
    ...overrides,
  };
  const app = createApp(deps);

  async function user(name: string) {
    const [u] = await db.insert(users).values({ displayName: name }).returning();
    const token = await createSession(db, u!.id);
    const cookie = `cuntas_session=${token}`;
    const call = (path: string, init: RequestInit = {}) =>
      app.request(path, { ...init, headers: { cookie, "content-type": "application/json", ...(init.headers ?? {}) } });
    return { id: u!.id, cookie, call };
  }
  return { app, db, deps, user };
}
