import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { depsFromEnv } from "./config";

const deps = await depsFromEnv();
const port = Number(process.env.PORT ?? 8787);
serve({ fetch: createApp(deps).fetch, port }, () => console.log(`Cúntas API on :${port} (provider: ${deps.provider.id})`));
