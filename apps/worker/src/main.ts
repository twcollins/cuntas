import PgBoss from "pg-boss";
import { createPostgresDb, parseKek } from "@cuntas/db";
import { providerFromEnv } from "@cuntas/providers";
import { today } from "@cuntas/rules";
import { fxRefresh, nightlySync, queueReminders } from "./jobs";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const { db } = await createPostgresDb(url);
const deps = { db, kek: parseKek(process.env.CUNTAS_KEK), provider: providerFromEnv(process.env) };

const boss = new PgBoss({ connectionString: process.env.DATABASE_ADMIN_URL ?? url });
boss.on("error", (e) => console.error(`[worker] ${e.message}`));
await boss.start();

const jobs: [string, string, () => Promise<unknown>][] = [
  ["fx-refresh", "30 16 * * 1-5", () => fxRefresh(db)], // ECB publishes around 16:00 CET
  ["bank-sync", "0 3 * * *", () => nightlySync(deps, today())],
  ["reminders", "0 6 * * *", () => queueReminders(db, today())],
];
for (const [name, cron, run] of jobs) {
  await boss.createQueue(name);
  await boss.schedule(name, cron, {}, { tz: "Europe/Dublin" });
  await boss.work(name, async () => {
    const result = await run();
    console.log(`[worker] ${name}: ${JSON.stringify(result)}`);
  });
}
// Fill FX on first boot.
await boss.send("fx-refresh", {});
console.log("Cúntas worker running");
