import { createPostgresDb, parseKek } from "@cuntas/db";
import { providerFromEnv } from "@cuntas/providers";
import type { AppDeps } from "./deps";

export async function depsFromEnv(env = process.env): Promise<AppDeps & { close: () => Promise<void> }> {
  const url = env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const { db, close } = await createPostgresDb(url);
  const webOrigin = env.WEB_ORIGIN ?? "http://localhost:5173";
  const rpOrigin = env.RP_ORIGIN ?? webOrigin;
  return {
    db,
    close,
    kek: parseKek(env.CUNTAS_KEK),
    provider: providerFromEnv(env),
    rp: { id: env.RP_ID ?? new URL(rpOrigin).hostname, name: "Cúntas", origin: rpOrigin },
    webOrigin,
    apiOrigin: env.API_ORIGIN ?? "http://localhost:8787",
    secureCookies: env.NODE_ENV === "production",
    ...(env.RULES_SIGNING_KEY ? { rulesSigningKey: env.RULES_SIGNING_KEY.replace(/\\n/g, "\n") } : {}),
  };
}
