import { useState } from "react";
import { apiClient } from "../lib/api";
import { cleanUrl, DEFAULT_API_URL, openServerHousehold, signInToServer, type ServerHousehold } from "../lib/server";
import { findSynced, replaceDataset, switchHousehold, useStore } from "../lib/store";
import { Badge, Button, Field, Input } from "./ui";

// Sign-in and the list of server households. Used inside and outside the router (onboarding),
// so nothing here links to a route.

export function ServerSignIn({ onSignedIn }: { onSignedIn: (households: ServerHousehold[]) => void }) {
  const { account } = useStore();
  const [url, setUrl] = useState(account?.apiUrl ?? DEFAULT_API_URL);
  const [editingUrl, setEditingUrl] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function go(mode: { register: string } | "signIn") {
    try {
      setMsg(null);
      const r = await signInToServer(url, mode);
      onSignedIn(r.households);
    } catch (e) {
      setMsg(`${mode === "signIn" ? "Sign-in" : "Creating your sign-in"} failed: ${(e as Error).message}`);
    }
  }

  return (
    <div className="space-y-3">
      <div className="text-sm text-stone-600 dark:text-stone-400">
        {editingUrl ? (
          <Field label="Server address">{(id) => <Input id={id} value={url} onChange={(e) => setUrl(e.target.value)} onBlur={() => setUrl(cleanUrl(url))} />}</Field>
        ) : (
          <p>
            Server <span className="font-mono text-xs">{cleanUrl(url)}</span>{" "}
            <button type="button" className="text-brand-700 hover:underline dark:text-brand-500" onClick={() => setEditingUrl(true)}>Change server</button>
          </p>
        )}
      </div>
      {creating ? (
        <>
          <Field label="Your name" hint="Shown to people you share a household with.">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />}</Field>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={!name.trim()} onClick={() => go({ register: name.trim() })}>Create sign-in with passkey</Button>
            <Button variant="ghost" onClick={() => setCreating(false)}>I already have one</Button>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => go("signIn")}>Sign in with passkey</Button>
          <Button variant="ghost" onClick={() => setCreating(true)}>Create a sign-in</Button>
        </div>
      )}
      {msg && <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">{msg}</p>}
    </div>
  );
}

/** Server households, each opened on this device as its own household. */
export function ServerHouseholdList({ apiUrl, households, onOpened }: { apiUrl: string; households: ServerHousehold[]; onOpened?: (result: "switched" | "added") => void }) {
  useStore(); // re-render when households on this device change
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function run(id: string, fn: () => Promise<void>) {
    setBusy(id);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function replaceLocal(hh: ServerHousehold) {
    const local = findSynced(apiUrl, hh.id);
    if (!local) return;
    if (!window.confirm(`Replace the copy of “${local.name}” on this device with the server copy? Changes on this device that haven't synced will be lost.`)) return;
    const remote = await apiClient(apiUrl).getDocument(hh.id);
    if (!remote.dataset) throw new Error("The server has no data for this household yet.");
    await switchHousehold(local.id);
    replaceDataset(remote.dataset, { apiUrl, householdId: hh.id, version: remote.version, dirty: false, lastSyncedAt: new Date().toISOString() });
    setMsg(`Replaced “${local.name}” with the server copy.`);
  }

  if (households.length === 0) return <p className="text-sm text-stone-500">No households on this server yet.</p>;
  return (
    <div>
      <ul className="divide-y divide-stone-100 text-sm dark:divide-stone-800">
        {households.map((hh) => {
          const local = findSynced(apiUrl, hh.id);
          return (
            <li key={hh.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="flex flex-wrap items-center gap-1">
                <span className="font-medium">{hh.name}</span>
                <Badge tone={hh.role === "owner" ? "info" : "neutral"}>{hh.role}</Badge>
                {hh.suspended && <Badge tone="warn">Suspended</Badge>}
                {local && <Badge tone="good">On this device</Badge>}
              </span>
              <span className="flex gap-1">
                <Button disabled={busy === hh.id} onClick={() => run(hh.id, async () => {
                  const result = await openServerHousehold(apiUrl, hh);
                  onOpened?.(result);
                })}>{local ? "Switch to it" : "Open on this device"}</Button>
                {local && <Button variant="ghost" disabled={busy === hh.id} onClick={() => run(hh.id, () => replaceLocal(hh))}>Replace with server copy</Button>}
              </span>
            </li>
          );
        })}
      </ul>
      {msg && <p className="mt-2 text-sm">{msg}</p>}
    </div>
  );
}
