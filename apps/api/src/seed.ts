// Seeds a demo user and household so the stack has data on first boot.
import { eq } from "drizzle-orm";
import { users } from "@cuntas/db";
import { createDemoDataset } from "@cuntas/ledger";
import { today } from "@cuntas/rules";
import { depsFromEnv } from "./config";
import { createHousehold, listHouseholds, putDocument } from "./services/households";

const deps = await depsFromEnv();
const DEMO_USER = "00000000-0000-4000-8000-000000000001";
const [existing] = await deps.db.select().from(users).where(eq(users.id, DEMO_USER));
if (!existing) await deps.db.insert(users).values({ id: DEMO_USER, displayName: "Demo" });
if ((await listHouseholds(deps.db, DEMO_USER)).length === 0) {
  const h = await createHousehold(deps.db, deps.kek, DEMO_USER, { name: "Demo household", baseCurrency: "EUR" });
  const ds = createDemoDataset(today());
  ds.household.id = h.id;
  await putDocument(deps.db, deps.kek, { householdId: h.id, userId: DEMO_USER }, 0, ds);
  console.log(`Seeded demo household ${h.id}`);
} else {
  console.log("Demo household already present.");
}
await deps.close();
