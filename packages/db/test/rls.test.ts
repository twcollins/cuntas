import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { connections, householdDocuments, households, invites, memberships, migrate, users, withTenant, schema, type Db, sha256 } from "../src";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
let db: Db;
let alice: string;
let bob: string;

beforeAll(async () => {
  const pg = new PGlite({ extensions: {} });
  await migrate({ exec: (s) => pg.exec(s), query: async (s) => (await pg.query<{ name: string }>(s)).rows });
  db = drizzle(pg, { schema }) as unknown as Db;
  alice = (await db.insert(users).values({ displayName: "Alice" }).returning())[0]!.id;
  bob = (await db.insert(users).values({ displayName: "Bob" }).returning())[0]!.id;
  for (const [hh, user] of [[A, alice], [B, bob]] as const) {
    await withTenant(db, { householdId: hh, userId: user }, async (tx) => {
      await tx.insert(households).values({ id: hh, name: `HH ${hh.slice(-1)}`, baseCurrency: "EUR", dekEncrypted: "x" });
      await tx.insert(memberships).values({ householdId: hh, userId: user, role: "owner" });
      await tx.insert(householdDocuments).values({ householdId: hh, version: 1, ciphertext: `doc-${hh.slice(-1)}` });
      await tx.insert(connections).values({ householdId: hh, provider: "mock", institutionName: "Bank", institutionCountry: "IE", status: "active" });
    });
  }
});

describe("row-level security: cross-household isolation", () => {
  it("each household sees only its own rows", async () => {
    for (const [hh, user, other] of [[A, alice, B], [B, bob, A]] as const) {
      await withTenant(db, { householdId: hh, userId: user }, async (tx) => {
        expect((await tx.select().from(households)).map((h) => h.id)).toEqual([hh]);
        expect((await tx.select().from(householdDocuments)).map((d) => d.ciphertext)).toEqual([`doc-${hh.slice(-1)}`]);
        expect(await tx.select().from(connections).where(eq(connections.householdId, other))).toEqual([]);
      });
    }
  });

  it("cannot write into another household", async () => {
    await expect(
      withTenant(db, { householdId: A, userId: alice }, (tx) => tx.insert(householdDocuments).values({ householdId: B, version: 2, ciphertext: "evil" })),
    ).rejects.toThrow();
    await withTenant(db, { householdId: A, userId: alice }, async (tx) => {
      const r = await tx.update(householdDocuments).set({ ciphertext: "evil" }).where(eq(householdDocuments.householdId, B)).returning();
      expect(r).toEqual([]);
    });
    await withTenant(db, { householdId: B, userId: bob }, async (tx) => {
      expect((await tx.select().from(householdDocuments))[0]!.ciphertext).toBe("doc-b");
    });
  });

  it("with no household set, nothing is visible", async () => {
    await withTenant(db, { householdId: null, userId: null }, async (tx) => {
      expect(await tx.select().from(households)).toEqual([]);
      expect(await tx.select().from(connections)).toEqual([]);
    });
  });

  it("a user can list their own memberships but not other people's", async () => {
    await withTenant(db, { householdId: null, userId: alice }, async (tx) => {
      expect((await tx.select().from(memberships)).map((m) => m.householdId)).toEqual([A]);
    });
  });

  it("invites add a member through the definer function only", async () => {
    const token = "invite-token";
    await withTenant(db, { householdId: A, userId: alice }, (tx) =>
      tx.insert(invites).values({ tokenHash: sha256(token), householdId: A, createdBy: alice, expiresAt: new Date(Date.now() + 86_400_000).toISOString() }),
    );
    // Bob cannot see A's invite directly...
    await withTenant(db, { householdId: B, userId: bob }, async (tx) => {
      expect(await tx.select().from(invites)).toEqual([]);
    });
    // ...but can accept it with the token.
    const joined = await withTenant(db, { householdId: null, userId: bob }, async (tx) => {
      const r = await tx.execute(sql`SELECT accept_invite(${sha256(token)}, ${bob}::uuid) AS hh`);
      return (r as unknown as { rows: { hh: string }[] }).rows[0]!.hh;
    });
    expect(joined).toBe(A);
    await withTenant(db, { householdId: A, userId: bob }, async (tx) => {
      expect((await tx.select().from(householdDocuments))[0]!.ciphertext).toBe("doc-a");
    });
    await expect(
      withTenant(db, { householdId: null, userId: bob }, (tx) => tx.execute(sql`SELECT accept_invite(${sha256(token)}, ${bob}::uuid)`)),
    ).rejects.toThrow();
  });
});

describe("instance administration", () => {
  it("the app role can create users and change names but cannot make anyone an admin", async () => {
    const carol = await withTenant(db, { householdId: null, userId: null }, async (tx) => (await tx.insert(users).values({ displayName: "Carol" }).returning())[0]!.id);
    await withTenant(db, { householdId: null, userId: carol }, (tx) => tx.update(users).set({ displayName: "Carol B" }).where(eq(users.id, carol)));
    await expect(withTenant(db, { householdId: null, userId: carol }, (tx) => tx.update(users).set({ isAdmin: true }).where(eq(users.id, carol)))).rejects.toThrow();
    await expect(withTenant(db, { householdId: null, userId: null }, (tx) => tx.insert(users).values({ displayName: "Mallory", isAdmin: true }))).rejects.toThrow();
  });

  it("admin_households lists every household for an admin and nothing for anyone else", async () => {
    const list = (who: string) =>
      withTenant(db, { householdId: null, userId: who }, async (tx) => {
        const r = await tx.execute(sql`SELECT id, member_count, owner_names FROM admin_households()`);
        return (r as unknown as { rows: { id: string; member_count: number; owner_names: string[] }[] }).rows;
      });
    expect(await list(alice)).toEqual([]);
    await db.update(users).set({ isAdmin: true }).where(eq(users.id, alice)); // as the table owner, like the admin CLI
    const rows = await list(alice);
    expect(rows.map((r) => r.id).sort()).toEqual([A, B]);
    expect(rows.find((r) => r.id === B)!.owner_names).toEqual(["Bob"]);
    expect(await list(bob)).toEqual([]);
  });

  it("an owner invite grants the owner role", async () => {
    const token = "owner-invite";
    await withTenant(db, { householdId: B, userId: bob }, (tx) =>
      tx.insert(invites).values({ tokenHash: sha256(token), householdId: B, createdBy: bob, role: "owner", expiresAt: new Date(Date.now() + 86_400_000).toISOString() }),
    );
    await withTenant(db, { householdId: null, userId: alice }, (tx) => tx.execute(sql`SELECT accept_invite(${sha256(token)}, ${alice}::uuid)`));
    const [m] = await withTenant(db, { householdId: B, userId: alice }, (tx) => tx.select().from(memberships).where(eq(memberships.userId, alice)));
    expect(m!.role).toBe("owner");
  });
});
