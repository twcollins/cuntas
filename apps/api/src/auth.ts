import { eq } from "drizzle-orm";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { randomToken, sessions, sha256, users, type Db } from "@cuntas/db";
import type { AppDeps, Env } from "./deps";

export const SESSION_COOKIE = "cuntas_session";
const SESSION_DAYS = 30;
/** Export and delete need a passkey or TOTP check within this window. */
export const REAUTH_WINDOW_MS = 5 * 60_000;

export async function createSession(db: Db, userId: string, userAgent?: string): Promise<string> {
  const token = randomToken();
  await db.insert(sessions).values({
    id: sha256(token),
    userId,
    expiresAt: new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString(),
    userAgentHash: userAgent ? sha256(userAgent) : null,
  });
  return token;
}

/** Cookie flags: Lax (or the given default) on the web, None and Secure when the app runs cross-site. */
export function cookiePolicy(c: Parameters<typeof setCookie>[0], secure: boolean, sameSite: "Lax" | "Strict") {
  const crossSite = (c.get("deps") as AppDeps | undefined)?.crossSiteCookies ?? false;
  return crossSite ? { secure: true, sameSite: "None" as const } : { secure, sameSite };
}

export function setSessionCookie(c: Parameters<typeof setCookie>[0], token: string, secure: boolean) {
  setCookie(c, SESSION_COOKIE, token, { httpOnly: true, ...cookiePolicy(c, secure, "Lax"), path: "/", maxAge: SESSION_DAYS * 86_400 });
}

export function clearSessionCookie(c: Parameters<typeof deleteCookie>[0]) {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

/** Loads the session user, binding the session to the user agent it was created with. */
export const sessionMiddleware = createMiddleware<Env>(async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  c.set("user", null);
  if (token) {
    const { db } = c.var.deps;
    const [row] = await db
      .select({ sid: sessions.id, userId: sessions.userId, expiresAt: sessions.expiresAt, reauthAt: sessions.reauthAt, ua: sessions.userAgentHash, name: users.displayName, isAdmin: users.isAdmin })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(eq(sessions.id, sha256(token)));
    const ua = c.req.header("user-agent");
    const bound = !row?.ua || !ua || row.ua === sha256(ua);
    if (row && bound && new Date(row.expiresAt) > new Date()) {
      c.set("user", { id: row.userId, displayName: row.name, sessionId: row.sid, reauthAt: row.reauthAt, isAdmin: row.isAdmin });
    }
  }
  await next();
});

export const requireUser = createMiddleware<Env>(async (c, next) => {
  if (!c.var.user) throw new HTTPException(401, { message: "Sign in required" });
  await next();
});

export function requireRecentAuth(user: NonNullable<Env["Variables"]["user"]>) {
  if (Date.now() - new Date(user.reauthAt).getTime() > REAUTH_WINDOW_MS) {
    throw new HTTPException(403, { message: "Re-authenticate to continue" });
  }
}

/** Instance admins manage households; they still can't read household ledgers. */
export function requireAdmin(user: Env["Variables"]["user"]) {
  if (!user) throw new HTTPException(401, { message: "Sign in required" });
  if (!user.isAdmin) throw new HTTPException(403, { message: "Admin only" });
  return user;
}
