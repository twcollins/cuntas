import { createPrivateKey, sign } from "node:crypto";
import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { ZodError } from "zod";
import { MANIFEST } from "@cuntas/rules";
import { sessionMiddleware } from "./auth";
import type { AppDeps, Env } from "./deps";
import { authRoutes } from "./routes/auth";
import { householdRoutes } from "./routes/households";
import { completeConnection } from "./services/bankSync";
import { getRates } from "./services/fx";
import { isMember } from "./services/households";

export function createApp(deps: AppDeps) {
  const app = new OpenAPIHono<Env>();

  app.use("*", secureHeaders());
  app.use("*", cors({ origin: deps.webOrigin, credentials: true }));
  app.use("*", async (c, next) => {
    c.set("deps", deps);
    await next();
  });
  app.use("*", sessionMiddleware);

  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    if (err instanceof ZodError) return c.json({ error: "Invalid request", issues: err.issues }, 400);
    // No personal data in logs: log the error class and message only.
    console.error(`[api] ${err.name}: ${err.message}`);
    return c.json({ error: "Internal error" }, 500);
  });

  app.get("/health", (c) => c.json({ ok: true }));
  app.route("/auth", authRoutes);
  app.route("/", householdRoutes);

  app.get("/fx", async (c) => {
    const from = c.req.query("from") ?? "2000-01-01";
    const to = c.req.query("to") ?? "2999-12-31";
    return c.json(await getRates(deps.db, from, to));
  });

  /** Rule-pack manifest, signed with Ed25519 when a signing key is configured. */
  app.get("/rule-packs/manifest", (c) => {
    const body = JSON.stringify(MANIFEST);
    const signature = deps.rulesSigningKey ? sign(null, Buffer.from(body), createPrivateKey(deps.rulesSigningKey)).toString("base64") : null;
    return c.json({ manifest: MANIFEST, signature, algorithm: signature ? "ed25519" : null });
  });

  /** The bank redirects here after consent. State is "<householdId>.<token>". */
  app.get("/bank/callback", async (c) => {
    const user = c.var.user;
    const [householdId, state] = (c.req.query("state") ?? "").split(".");
    const code = c.req.query("code");
    if (!user || !householdId || !state || !code || !(await isMember(deps.db, user.id, householdId))) {
      return c.redirect(`${deps.webOrigin}/accounts?bank=error`);
    }
    try {
      await completeConnection(deps, { householdId, userId: user.id }, { state, code });
      return c.redirect(`${deps.webOrigin}/accounts?bank=connected`);
    } catch {
      return c.redirect(`${deps.webOrigin}/accounts?bank=error`);
    }
  });

  app.doc("/openapi.json", { openapi: "3.0.0", info: { title: "Cúntas API", version: "0.1.0" } });
  return app;
}
