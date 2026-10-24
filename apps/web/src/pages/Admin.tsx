import { useEffect, useState } from "react";
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, Table } from "../components/ui";
import { apiClient, withReauth, type AdminHousehold, type Api, type HouseholdMember } from "../lib/api";
import { formatDate } from "../lib/format";
import { DEFAULT_API_URL, cleanUrl, refreshAccount, signInToServer } from "../lib/server";
import { useStore } from "../lib/store";

// Instance administration for a self-hosted server: create households for other people, suspend,
// rename or delete them, and manage who belongs to each. Admins never see a household's ledger.

export function AdminPage() {
  const { account } = useStore();
  const [url, setUrl] = useState(account?.apiUrl ?? DEFAULT_API_URL);
  const [me, setMe] = useState<{ displayName: string; isAdmin: boolean } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const api = apiClient(cleanUrl(url));

  async function connect(signIn: boolean) {
    try {
      const r = signIn ? await signInToServer(url, "signIn") : await refreshAccount(cleanUrl(url));
      setMe(r.account);
      setMsg(null);
    } catch (e) {
      setMe(null);
      if (signIn) setMsg(`Sign-in failed: ${(e as Error).message}`);
    }
  }

  // Only check the session automatically when this device is already signed in to a server.
  useEffect(() => {
    if (account) void connect(false);
  }, []);

  return (
    <div>
      <PageHeader title="Server admin" subtitle="Create and manage households on this self-hosted server. Admins see who belongs to a household, never its finances." />
      {!me ? (
        <Card title="Sign in to your server" className="max-w-lg">
          <div className="space-y-3">
            <Field label="Server URL">{(id) => <Input id={id} value={url} onChange={(e) => setUrl(e.target.value)} />}</Field>
            <Button variant="primary" onClick={() => connect(true)}>Sign in with passkey</Button>
            {msg && <p className="text-sm text-rose-600 dark:text-rose-400">{msg}</p>}
          </div>
        </Card>
      ) : !me.isAdmin ? (
        <Card title="Not an admin" className="max-w-xl">
          <p className="text-sm text-stone-600 dark:text-stone-400">
            You're signed in as {me.displayName}, who isn't an admin on this server. Whoever runs the server can grant it from the database owner's shell:
          </p>
          <pre className="mt-3 overflow-x-auto rounded-lg bg-stone-100 p-3 text-xs dark:bg-stone-800">docker compose run --rm migrate pnpm --filter @cuntas/api admin grant "{me.displayName}"</pre>
        </Card>
      ) : (
        <AdminConsole api={api} />
      )}
    </div>
  );
}

function AdminConsole({ api }: { api: Api }) {
  const [rows, setRows] = useState<AdminHousehold[] | null>(null);
  const [users, setUsers] = useState<Awaited<ReturnType<Api["admin"]["users"]>>>([]);
  const [msg, setMsg] = useState<{ text: string; link?: string } | null>(null);
  const [members, setMembers] = useState<AdminHousehold | null>(null);
  const [renaming, setRenaming] = useState<AdminHousehold | null>(null);
  const [deleting, setDeleting] = useState<AdminHousehold | null>(null);

  async function reload() {
    try {
      const [h, u] = await Promise.all([api.admin.households(), api.admin.users()]);
      setRows(h);
      setUsers(u);
    } catch (e) {
      setMsg({ text: `Could not load: ${(e as Error).message}` });
    }
  }
  useEffect(() => {
    void reload();
  }, []);

  async function act(fn: () => Promise<unknown>, done: string) {
    try {
      await fn();
      setMsg({ text: done });
      await reload();
    } catch (e) {
      setMsg({ text: `Failed: ${(e as Error).message}` });
    }
  }

  return (
    <div className="space-y-4">
      {msg && (
        <div role="status" className="rounded-lg bg-brand-50 p-3 text-sm text-brand-800 dark:bg-brand-900/30 dark:text-brand-100">
          {msg.text}
          {msg.link && <div className="mt-1 break-all font-mono text-xs">{msg.link}</div>}
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <CreateHousehold api={api} onCreated={(name, link) => { setMsg({ text: link ? `Created “${name}”. Send this one-time owner link (valid 72 hours):` : `Created “${name}”; you are its owner.`, ...(link ? { link } : {}) }); void reload(); }} />
        <Card title="Server" className="lg:col-span-2">
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div><div className="text-xs text-stone-500">Households</div><div className="text-2xl font-semibold tabular-nums">{rows?.length ?? "–"}</div></div>
            <div><div className="text-xs text-stone-500">Suspended</div><div className="text-2xl font-semibold tabular-nums">{rows?.filter((r) => r.suspendedAt).length ?? "–"}</div></div>
            <div><div className="text-xs text-stone-500">Users</div><div className="text-2xl font-semibold tabular-nums">{users.length}</div></div>
          </div>
          <p className="mt-3 text-xs text-stone-500">Ledgers are encrypted per household and only served to members. Suspending makes a household read-only: members can still load, export and delete their data.</p>
        </Card>
      </div>

      <Card title="Households">
        {rows === null ? <p className="text-sm text-stone-500">Loading…</p> : rows.length === 0 ? <Empty title="No households yet">Create one above.</Empty> : (
          <Table head={["Household", "Members", "Last saved", "Banks", "Status", ""]}>
            {rows.map((h) => (
              <tr key={h.id}>
                <td className="px-2 py-2">
                  <div className="font-medium">{h.name}</div>
                  <div className="text-xs text-stone-500">{h.baseCurrency} · created {formatDate(h.createdAt.slice(0, 10))}{h.ownerNames.length > 0 && ` · owner ${h.ownerNames.join(", ")}`}</div>
                </td>
                <td className="px-2 py-2 tabular-nums">{h.memberCount}</td>
                <td className="px-2 py-2 text-xs">{h.documentUpdatedAt ? `${formatDate(h.documentUpdatedAt.slice(0, 10))} · v${h.documentVersion}` : "Never"}</td>
                <td className="px-2 py-2 tabular-nums">{h.connectionCount}</td>
                <td className="px-2 py-2">{h.suspendedAt ? <Badge tone="warn">Suspended</Badge> : h.memberCount === 0 ? <Badge tone="info">Awaiting owner</Badge> : <Badge tone="good">Active</Badge>}</td>
                <td className="px-2 py-2">
                  <div className="flex flex-wrap justify-end gap-1">
                    <Button variant="ghost" className="text-xs" onClick={() => setMembers(h)}>Members</Button>
                    <Button variant="ghost" className="text-xs" onClick={() => setRenaming(h)}>Rename</Button>
                    <Button variant="ghost" className="text-xs" onClick={() => act(() => api.admin.update(h.id, { suspended: !h.suspendedAt }), h.suspendedAt ? `Reinstated “${h.name}”.` : `Suspended “${h.name}”.`)}>{h.suspendedAt ? "Reinstate" : "Suspend"}</Button>
                    <Button variant="ghost" className="text-xs text-rose-600 dark:text-rose-400" onClick={() => setDeleting(h)}>Delete</Button>
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title="Users">
        <Table head={["Name", "Joined", "Role"]}>
          {users.map((u) => (
            <tr key={u.id}>
              <td className="px-2 py-1.5">{u.displayName}</td>
              <td className="px-2 py-1.5 text-xs">{formatDate(u.createdAt.slice(0, 10))}</td>
              <td className="px-2 py-1.5">{u.isAdmin ? <Badge tone="info">Admin</Badge> : <span className="text-xs text-stone-500">User</span>}</td>
            </tr>
          ))}
        </Table>
        <p className="mt-2 text-xs text-stone-500">Admin rights are granted from the server shell with <code>pnpm --filter @cuntas/api admin grant</code>, never from the app.</p>
      </Card>

      <Modal open={!!members} onClose={() => setMembers(null)} title={`Members of ${members?.name ?? ""}`}>
        {members && <Members api={api} household={members} onChanged={reload} />}
      </Modal>
      <Modal open={!!renaming} onClose={() => setRenaming(null)} title="Rename household">
        {renaming && <Rename initial={renaming.name} onSave={(name) => { void act(() => api.admin.update(renaming.id, { name }), `Renamed to “${name}”.`); setRenaming(null); }} />}
      </Modal>
      <Modal open={!!deleting} onClose={() => setDeleting(null)} title="Delete household">
        {deleting && (
          <ConfirmDelete
            name={deleting.name}
            onConfirm={() => { const h = deleting; setDeleting(null); void act(() => withReauth(api, () => api.admin.remove(h.id)), `Deleted “${h.name}” and revoked its bank connections.`); }}
          />
        )}
      </Modal>
    </div>
  );
}

function CreateHousehold({ api, onCreated }: { api: Api; onCreated: (name: string, ownerLink: string | null) => void }) {
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState<"EUR" | "GBP">("EUR");
  const [join, setJoin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Card title="New household">
      <div className="space-y-3">
        <Field label="Name">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Murphy household" />}</Field>
        <Field label="Base currency">{(id) => <Select id={id} value={currency} onChange={(e) => setCurrency(e.target.value as "EUR" | "GBP")} options={[{ value: "EUR", label: "EUR" }, { value: "GBP", label: "GBP" }]} />}</Field>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={join} onChange={(e) => setJoin(e.target.checked)} />Join it myself as owner (otherwise you get an owner invite link to send)</label>
        <Button
          variant="primary"
          disabled={!name.trim()}
          onClick={async () => {
            try {
              const r = await api.admin.create({ name: name.trim(), baseCurrency: currency, joinAsOwner: join });
              onCreated(r.name, r.ownerInviteUrl);
              setName("");
              setError(null);
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Create household
        </Button>
        {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
      </div>
    </Card>
  );
}

function Members({ api, household, onChanged }: { api: Api; household: AdminHousehold; onChanged: () => Promise<void> }) {
  const [list, setList] = useState<HouseholdMember[] | null>(null);
  const [note, setNote] = useState<{ text: string; link?: string } | null>(null);
  const load = async () => setList(await api.admin.members(household.id));
  useEffect(() => {
    void load();
  }, [household.id]);
  async function run(fn: () => Promise<unknown>) {
    try {
      await fn();
      setNote(null);
      await Promise.all([load(), onChanged()]);
    } catch (e) {
      setNote({ text: (e as Error).message });
    }
  }
  return (
    <div className="space-y-3">
      {list === null ? <p className="text-sm text-stone-500">Loading…</p> : list.length === 0 ? <p className="text-sm text-stone-500">No members yet. Send an owner invite.</p> : (
        <ul className="divide-y divide-stone-100 dark:divide-stone-800">
          {list.map((m) => (
            <li key={m.userId} className="flex items-center justify-between gap-2 py-2 text-sm">
              <div>
                <div className="font-medium">{m.displayName}</div>
                <div className="text-xs text-stone-500">Joined {formatDate(m.joinedAt.slice(0, 10))}</div>
              </div>
              <div className="flex items-center gap-1">
                <Select aria-label={`Role for ${m.displayName}`} className="w-28" value={m.role} onChange={(e) => run(() => api.admin.setRole(household.id, m.userId, e.target.value as "owner" | "member"))} options={[{ value: "owner", label: "Owner" }, { value: "member", label: "Member" }]} />
                <Button variant="ghost" className="text-xs text-rose-600 dark:text-rose-400" onClick={() => run(() => withReauth(api, () => api.admin.removeMember(household.id, m.userId)))}>Remove</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2 border-t border-stone-100 pt-3 dark:border-stone-800">
        <Button onClick={async () => setNote({ text: "Owner invite (one use, 72 hours):", link: (await api.admin.invite(household.id, "owner")).url })}>Owner invite link</Button>
        <Button variant="ghost" onClick={async () => setNote({ text: "Member invite (one use, 72 hours):", link: (await api.admin.invite(household.id, "member")).url })}>Member invite link</Button>
      </div>
      {note && <p className="text-sm">{note.text}{note.link && <span className="mt-1 block break-all font-mono text-xs">{note.link}</span>}</p>}
    </div>
  );
}

function Rename({ initial, onSave }: { initial: string; onSave: (name: string) => void }) {
  const [name, setName] = useState(initial);
  return (
    <div className="space-y-3">
      <Field label="Name">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
      <div className="flex justify-end"><Button variant="primary" disabled={!name.trim() || name === initial} onClick={() => onSave(name.trim())}>Save</Button></div>
    </div>
  );
}

function ConfirmDelete({ name, onConfirm }: { name: string; onConfirm: () => void }) {
  const [typed, setTyped] = useState("");
  return (
    <div className="space-y-3 text-sm">
      <p>This deletes “{name}”, its encrypted ledger and stored bank transactions for every member, and revokes its bank consents. It can't be undone. You may be asked to confirm with your passkey.</p>
      <Field label={`Type the household name to confirm`}>{(id) => <Input id={id} value={typed} onChange={(e) => setTyped(e.target.value)} />}</Field>
      <div className="flex justify-end"><Button variant="danger" disabled={typed !== name} onClick={onConfirm}>Delete household</Button></div>
    </div>
  );
}
