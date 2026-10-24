import { useEffect, useState } from "react";
import { Badge, Button, Card, Select } from "../../components/ui";
import { apiClient, type HouseholdMember } from "../../lib/api";
import { useDataset, useStore } from "../../lib/store";

/** For a household synced to a server: who can open it, and (for owners) roles, removals and invites. */
export function PeopleWithAccess() {
  const { sync } = useStore();
  const ds = useDataset();
  const [list, setList] = useState<HouseholdMember[] | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const api = sync ? apiClient(sync.apiUrl.replace(/\/$/, "")) : null;
  const load = async () => {
    if (!api || !sync) return;
    try {
      const [members, who] = await Promise.all([api.members(sync.householdId), api.me()]);
      setList(members);
      setMe(who.user.id);
    } catch (e) {
      setNote(`Could not load members: ${(e as Error).message}`);
    }
  };
  useEffect(() => {
    void load();
  }, [sync?.householdId]);
  if (!sync || !api) return null;
  const owner = list?.some((m) => m.userId === me && m.role === "owner") ?? false;
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      setNote(null);
      await load();
    } catch (e) {
      setNote((e as Error).message);
    }
  };
  return (
    <Card title={`Who can open “${ds.household.name}”`} className="mt-4" actions={owner && <InviteButton onInvite={async (role) => setNote(`Invite link (one use, 72 hours, joins as ${role}): ${(await api.invite(sync.householdId, role)).url}`)} />}>
      <p className="mb-2 text-sm text-stone-600 dark:text-stone-400">Everyone here signs in with their own passkey and can open this household's data on {sync.apiUrl}. Owners can invite people and change roles. This is separate from the people in the plan on the Household page.</p>
      {list === null ? <p className="text-sm text-stone-500">Loading…</p> : (
        <ul className="divide-y divide-stone-100 text-sm dark:divide-stone-800">
          {list.map((m) => (
            <li key={m.userId} className="flex items-center justify-between gap-2 py-2">
              <span>{m.displayName} {m.userId === me && <Badge>you</Badge>}</span>
              <span className="flex items-center gap-1">
                {owner ? (
                  <Select aria-label={`Role for ${m.displayName}`} className="w-28" value={m.role} onChange={(e) => run(() => api.setMemberRole(sync.householdId, m.userId, e.target.value as "owner" | "member"))} options={[{ value: "owner", label: "Owner" }, { value: "member", label: "Member" }]} />
                ) : (
                  <Badge tone={m.role === "owner" ? "info" : "neutral"}>{m.role}</Badge>
                )}
                {(owner || m.userId === me) && <Button variant="ghost" className="text-xs text-rose-600 dark:text-rose-400" onClick={() => run(() => api.removeMember(sync.householdId, m.userId))}>{m.userId === me ? "Leave" : "Remove"}</Button>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {note && <p className="mt-2 break-all text-sm">{note}</p>}
    </Card>
  );
}

function InviteButton({ onInvite }: { onInvite: (role: "owner" | "member") => Promise<void> }) {
  const [role, setRole] = useState<"owner" | "member">("member");
  return (
    <span className="flex items-center gap-1">
      <Select aria-label="Invite as" className="w-28" value={role} onChange={(e) => setRole(e.target.value as "owner" | "member")} options={[{ value: "member", label: "Member" }, { value: "owner", label: "Owner" }]} />
      <Button onClick={() => void onInvite(role)}>Invite someone</Button>
    </span>
  );
}
