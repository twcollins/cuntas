import { bigint, bigserial, boolean, char, customType, date, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "string" });

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  displayName: text("display_name").notNull(),
  email: text("email").unique(),
  /** Set only by the admin CLI as the table owner; the API role cannot write it. */
  isAdmin: boolean("is_admin").notNull().default(false),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const passkeyCredentials = pgTable("passkey_credentials", {
  id: text("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  publicKey: bytea("public_key").notNull(),
  counter: bigint("counter", { mode: "number" }).notNull().default(0),
  transports: text("transports").array().notNull().default([]),
  createdAt: ts("created_at").notNull().defaultNow(),
  lastUsedAt: ts("last_used_at"),
});

export const totpSecrets = pgTable("totp_secrets", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  secretEncrypted: text("secret_encrypted").notNull(),
  confirmed: boolean("confirmed").notNull().default(false),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: ts("created_at").notNull().defaultNow(),
  expiresAt: ts("expires_at").notNull(),
  reauthAt: ts("reauth_at").notNull().defaultNow(),
  userAgentHash: text("user_agent_hash"),
});

export const households = pgTable("households", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  baseCurrency: char("base_currency", { length: 3 }).notNull(),
  dekEncrypted: text("dek_encrypted").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  suspendedAt: ts("suspended_at"),
});

export const memberships = pgTable(
  "memberships",
  {
    householdId: uuid("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.userId] })],
);

export const invites = pgTable("invites", {
  tokenHash: text("token_hash").primaryKey(),
  householdId: uuid("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
  usedBy: uuid("used_by").references(() => users.id),
  role: text("role").notNull().default("member"),
});

export const householdDocuments = pgTable("household_documents", {
  householdId: uuid("household_id").primaryKey().references(() => households.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  ciphertext: text("ciphertext").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  updatedBy: uuid("updated_by").references(() => users.id),
});

export const connections = pgTable("connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  institutionName: text("institution_name").notNull(),
  institutionCountry: char("institution_country", { length: 2 }).notNull(),
  sessionRefEncrypted: text("session_ref_encrypted"),
  consentState: text("consent_state"),
  consentExpiresAt: ts("consent_expires_at"),
  status: text("status").notNull(),
  accounts: jsonb("accounts").notNull().default([]).$type<{ ref: string; name: string; currency: string; iban?: string }[]>(),
  lastSyncedAt: ts("last_synced_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const providerTransactions = pgTable(
  "provider_transactions",
  {
    householdId: uuid("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id").notNull().references(() => connections.id, { onDelete: "cascade" }),
    accountRef: text("account_ref").notNull(),
    externalId: text("external_id").notNull(),
    bookedAt: date("booked_at", { mode: "string" }).notNull(),
    payloadEncrypted: text("payload_encrypted").notNull(),
    fetchedAt: ts("fetched_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.connectionId, t.accountRef, t.externalId] })],
);

export const auditEvents = pgTable("audit_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  householdId: uuid("household_id").references(() => households.id, { onDelete: "cascade" }),
  actor: uuid("actor"),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  at: ts("at").notNull().defaultNow(),
});

export const fxRates = pgTable(
  "fx_rates",
  {
    date: date("date", { mode: "string" }).notNull(),
    base: char("base", { length: 3 }).notNull().default("EUR"),
    quote: char("quote", { length: 3 }).notNull(),
    rate: numeric("rate", { precision: 12, scale: 6 }).notNull(),
    source: text("source").notNull(),
  },
  (t) => [primaryKey({ columns: [t.date, t.base, t.quote] })],
);

export const notifications = pgTable("notifications", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  householdId: uuid("household_id").notNull().references(() => households.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  dueOn: date("due_on", { mode: "string" }).notNull(),
  payload: jsonb("payload").notNull().default({}),
  sentAt: ts("sent_at"),
});
