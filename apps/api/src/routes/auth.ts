import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";

type Transports = NonNullable<Parameters<typeof verifyAuthenticationResponse>[0]["credential"]["transports"]>;
import { authenticator } from "otplib";
import { z } from "zod";
import { decrypt, encrypt, passkeyCredentials, randomToken, sessions, totpSecrets, users } from "@cuntas/db";
import { clearSessionCookie, cookiePolicy, createSession, requireUser, setSessionCookie } from "../auth";
import type { Env } from "../deps";
import { audit } from "../services/audit";
import { withTenant } from "@cuntas/db";

const CHALLENGE_COOKIE = "cuntas_challenge";
const CHALLENGE_TTL_MS = 5 * 60_000;

/** Pending WebAuthn challenges, keyed by an opaque cookie. Single-instance store; use Redis or Postgres when scaling out. */
const challenges = new Map<string, { challenge: string; expires: number; userId?: string; displayName?: string }>();

function putChallenge(c: Parameters<typeof setCookie>[0], value: { challenge: string; userId?: string; displayName?: string }, secure: boolean) {
  const key = randomToken(16);
  challenges.set(key, { ...value, expires: Date.now() + CHALLENGE_TTL_MS });
  setCookie(c, CHALLENGE_COOKIE, key, { httpOnly: true, ...cookiePolicy(c, secure, "Strict"), path: "/auth", maxAge: CHALLENGE_TTL_MS / 1000 });
}

function takeChallenge(c: Parameters<typeof getCookie>[0]) {
  const key = getCookie(c, CHALLENGE_COOKIE);
  const value = key ? challenges.get(key) : undefined;
  if (key) challenges.delete(key);
  if (!value || value.expires < Date.now()) throw new HTTPException(400, { message: "Challenge expired; start again" });
  return value;
}

async function withAudit(c: { var: Env["Variables"] }, userId: string, action: string) {
  await withTenant(c.var.deps.db, { householdId: null, userId }, (tx) => audit(tx, { householdId: null, actor: userId, action, entity: "user" }));
}

export const authRoutes = new Hono<Env>()
  .post("/passkey/register/options", async (c) => {
    const body = z.object({ displayName: z.string().min(1).max(80) }).parse(await c.req.json());
    const { rp, secureCookies } = c.var.deps;
    // A signed-in user adding a second passkey keeps their id; otherwise this creates a new account.
    const userId = c.var.user?.id ?? globalThis.crypto.randomUUID();
    const options = await generateRegistrationOptions({
      rpName: rp.name,
      rpID: rp.id,
      userName: body.displayName,
      userDisplayName: body.displayName,
      userID: new TextEncoder().encode(userId),
      attestationType: "none",
      authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
    });
    putChallenge(c, { challenge: options.challenge, userId, displayName: body.displayName }, secureCookies);
    return c.json(options);
  })
  .post("/passkey/register/verify", async (c) => {
    const { db, rp, secureCookies } = c.var.deps;
    const pending = takeChallenge(c);
    const verification = await verifyRegistrationResponse({
      response: await c.req.json(),
      expectedChallenge: pending.challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
    });
    if (!verification.verified || !verification.registrationInfo) throw new HTTPException(400, { message: "Passkey not verified" });
    const { credential } = verification.registrationInfo;
    const userId = pending.userId!;
    const [existing] = await db.select().from(users).where(eq(users.id, userId));
    if (!existing) await db.insert(users).values({ id: userId, displayName: pending.displayName ?? "Member" });
    await db.insert(passkeyCredentials).values({
      id: credential.id,
      userId,
      publicKey: Buffer.from(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports ?? [],
    });
    await withAudit(c, userId, existing ? "passkey.add" : "user.signup");
    if (!c.var.user) setSessionCookie(c, await createSession(db, userId, c.req.header("user-agent")), secureCookies);
    return c.json({ ok: true, userId });
  })
  .post("/passkey/login/options", async (c) => {
    const { rp, secureCookies } = c.var.deps;
    const options = await generateAuthenticationOptions({ rpID: rp.id, userVerification: "preferred" });
    putChallenge(c, { challenge: options.challenge }, secureCookies);
    return c.json(options);
  })
  .post("/passkey/login/verify", async (c) => {
    const { db, rp, secureCookies } = c.var.deps;
    const pending = takeChallenge(c);
    const response = await c.req.json();
    const [cred] = await db.select().from(passkeyCredentials).where(eq(passkeyCredentials.id, String(response.id)));
    if (!cred) throw new HTTPException(401, { message: "Unknown passkey" });
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: pending.challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      credential: { id: cred.id, publicKey: new Uint8Array(cred.publicKey), counter: cred.counter, transports: cred.transports as Transports },
    });
    if (!verification.verified) throw new HTTPException(401, { message: "Passkey not verified" });
    await db.update(passkeyCredentials).set({ counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date().toISOString() }).where(eq(passkeyCredentials.id, cred.id));
    await withAudit(c, cred.userId, "auth.signin.passkey");
    if (c.var.user?.id === cred.userId) {
      await db.update(sessions).set({ reauthAt: new Date().toISOString() }).where(eq(sessions.id, c.var.user.sessionId));
    } else {
      setSessionCookie(c, await createSession(db, cred.userId, c.req.header("user-agent")), secureCookies);
    }
    return c.json({ ok: true, userId: cred.userId });
  })
  .post("/totp/setup", requireUser, async (c) => {
    const { db, kek } = c.var.deps;
    const user = c.var.user!;
    const { email } = z.object({ email: z.string().email() }).parse(await c.req.json());
    await db.update(users).set({ email: email.toLowerCase() }).where(eq(users.id, user.id));
    const secret = authenticator.generateSecret();
    await db
      .insert(totpSecrets)
      .values({ userId: user.id, secretEncrypted: encrypt(kek, secret), confirmed: false })
      .onConflictDoUpdate({ target: totpSecrets.userId, set: { secretEncrypted: encrypt(kek, secret), confirmed: false } });
    return c.json({ secret, otpauthUrl: authenticator.keyuri(user.displayName, "Cúntas", secret) });
  })
  .post("/totp/confirm", requireUser, async (c) => {
    const { db, kek } = c.var.deps;
    const { code } = z.object({ code: z.string().regex(/^\d{6}$/) }).parse(await c.req.json());
    const [row] = await db.select().from(totpSecrets).where(eq(totpSecrets.userId, c.var.user!.id));
    if (!row || !authenticator.verify({ token: code, secret: decrypt(kek, row.secretEncrypted) })) throw new HTTPException(400, { message: "Code not accepted" });
    await db.update(totpSecrets).set({ confirmed: true }).where(eq(totpSecrets.userId, row.userId));
    return c.json({ ok: true });
  })
  .post("/totp/login", async (c) => {
    const { db, kek, secureCookies } = c.var.deps;
    const { email, code } = z.object({ email: z.string().email(), code: z.string().regex(/^\d{6}$/) }).parse(await c.req.json());
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, email.toLowerCase()));
    const userId = u?.id ?? "";
    const [row] = u ? await db.select().from(totpSecrets).where(and(eq(totpSecrets.userId, u.id), eq(totpSecrets.confirmed, true))) : [];
    if (!row || !authenticator.verify({ token: code, secret: decrypt(kek, row.secretEncrypted) })) throw new HTTPException(401, { message: "Code not accepted" });
    await withAudit(c, userId, "auth.signin.totp");
    if (c.var.user?.id === userId) {
      await db.update(sessions).set({ reauthAt: new Date().toISOString() }).where(eq(sessions.id, c.var.user.sessionId));
    } else {
      setSessionCookie(c, await createSession(db, userId, c.req.header("user-agent")), secureCookies);
    }
    return c.json({ ok: true });
  })
  .post("/logout", async (c) => {
    if (c.var.user) await c.var.deps.db.delete(sessions).where(eq(sessions.id, c.var.user.sessionId));
    clearSessionCookie(c);
    return c.json({ ok: true });
  });
