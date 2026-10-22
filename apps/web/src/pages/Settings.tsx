import { useState } from "react";
import { exportCsv, exportJson, importJson } from "@cuntas/ledger";
import { addDays, MANIFEST } from "@cuntas/rules";
import { Badge, Button, Card, Field, Input, PageHeader } from "../components/ui";
import { apiClient, ApiError } from "../lib/api";
import { decryptBackup, encryptBackup } from "../lib/backup";
import { download, formatDate } from "../lib/format";
import { fetchEcbRates, mergeRates } from "../lib/fx";
import { replaceDataset, setSync, update, useDataset, useStore, wipeAll } from "../lib/store";

export function SettingsPage() {
  const ds = useDataset();
  const [msg, setMsg] = useState<string | null>(null);
  const [pass, setPass] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const lastRate = ds.fxRates.at(-1);

  async function restore(file: File, encrypted: boolean) {
    try {
      const text = await file.text();
      const json = encrypted ? await decryptBackup(text, pass) : text;
      replaceDataset(importJson(json));
      setMsg("Data restored.");
    } catch (e) {
      setMsg(`Could not restore: ${(e as Error).message}`);
    }
  }

  return (
    <div>
      <PageHeader title="Data & sync" subtitle="Your data lives on this device. Export it, back it up, sync it to your own server, or delete it all." />
      {msg && <p role="status" className="mb-4 rounded-lg bg-brand-50 p-3 text-sm text-brand-800 dark:bg-brand-900/30 dark:text-brand-100">{msg}</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Export">
          <p className="mb-3 text-sm text-stone-600 dark:text-stone-400">Full export of every record. JSON restores exactly; CSV gives one file per entity.</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => download(`cuntas-${new Date().toISOString().slice(0, 10)}.json`, exportJson(ds))}>Export JSON</Button>
            <Button onClick={() => { for (const [name, body] of Object.entries(exportCsv(ds))) download(name, body, "text/csv"); }}>Export CSV files</Button>
          </div>
          <div className="mt-4">
            <Field label="Restore from JSON export">{(id) => <input id={id} type="file" accept=".json" className="text-sm" onChange={(e) => e.target.files?.[0] && restore(e.target.files[0], false)} />}</Field>
          </div>
        </Card>

        <Card title="Encrypted backup">
          <p className="mb-3 text-sm text-stone-600 dark:text-stone-400">AES-256-GCM, with a key derived from your passphrase in this browser. Without the passphrase the backup cannot be opened.</p>
          <Field label="Passphrase">{(id) => <Input id={id} type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" />}</Field>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="primary" disabled={pass.length < 8} onClick={async () => download(`cuntas-${new Date().toISOString().slice(0, 10)}.cuntas`, await encryptBackup(exportJson(ds), pass))}>Download backup</Button>
            <label className="text-sm">Restore: <input type="file" accept=".cuntas" disabled={pass.length < 8} onChange={(e) => e.target.files?.[0] && restore(e.target.files[0], true)} /></label>
          </div>
          {pass.length > 0 && pass.length < 8 && <p className="mt-1 text-xs text-stone-500">Use at least 8 characters.</p>}
        </Card>

        <Card title="Exchange rates">
          <p className="text-sm text-stone-600 dark:text-stone-400">
            {ds.fxRates.length} EUR/GBP rates stored{lastRate && <>, latest {formatDate(lastRate.date)} ({lastRate.rate}, {lastRate.source})</>}.
          </p>
          <Button className="mt-3" onClick={async () => {
            try {
              const from = lastRate ? addDays(lastRate.date, 1) : addDays(new Date().toISOString().slice(0, 10), -400);
              const rates = await fetchEcbRates(from, new Date().toISOString().slice(0, 10));
              update((d) => ({ ...d, fxRates: mergeRates(d.fxRates, rates) }));
              setMsg(`Fetched ${rates.length} ECB reference rates.`);
            } catch (e) {
              setMsg(`FX update failed: ${(e as Error).message}`);
            }
          }}>Update ECB rates</Button>
        </Card>

        <ServerSync />

        <Card title="Rule packs">
          <ul className="space-y-1 text-sm">
            {MANIFEST.map((m) => <li key={m.key} className="flex justify-between"><code>{m.version}</code><span className="font-mono text-xs text-stone-500">{m.sha256.slice(0, 12)}…</span></li>)}
          </ul>
          <p className="mt-2 text-xs text-stone-500">Provisional packs reflect Budget announcements not yet in a Finance Act. Verify figures with Revenue and HMRC before relying on them.</p>
        </Card>

        <Card title="Delete everything" className="border-rose-200 dark:border-rose-900">
          <p className="mb-3 text-sm text-stone-600 dark:text-stone-400">Removes all household data from this device. Export first if you want to keep it. Type DELETE to confirm.</p>
          <div className="flex gap-2">
            <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} aria-label="Type DELETE to confirm" placeholder="DELETE" />
            <Button variant="danger" disabled={confirmText !== "DELETE"} onClick={() => void wipeAll()}>Delete all data</Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

function ServerSync() {
  const ds = useDataset();
  const { sync } = useStore();
  const [url, setUrl] = useState(sync?.apiUrl ?? "http://localhost:8787");
  const [name, setName] = useState(ds.members[0]?.name ?? "");
  const [status, setStatus] = useState<string | null>(null);
  const [invite, setInvite] = useState<string | null>(null);
  const api = apiClient(url.replace(/\/$/, ""));

  async function signedIn(fn: () => Promise<unknown>) {
    try {
      await fn();
      const me = await api.me();
      let hh = me.households.find((h) => h.id === sync?.householdId) ?? me.households[0];
      if (!hh) {
        const created = await api.createHousehold(ds.household.name, ds.household.baseCurrency);
        hh = { ...created, name: ds.household.name, baseCurrency: ds.household.baseCurrency, role: "owner" };
      }
      const remote = await api.getDocument(hh.id);
      if (remote.dataset) {
        replaceDataset(remote.dataset, { apiUrl: url, householdId: hh.id, version: remote.version, dirty: false, lastSyncedAt: new Date().toISOString() });
        setStatus(`Signed in as ${me.user.displayName}; loaded “${hh.name}” from the server.`);
      } else {
        const r = await api.putDocument(hh.id, 0, ds);
        setSync({ apiUrl: url, householdId: hh.id, version: r.version, dirty: false, lastSyncedAt: new Date().toISOString() });
        setStatus(`Signed in as ${me.user.displayName}; uploaded this household.`);
      }
    } catch (e) {
      setStatus(`Failed: ${(e as Error).message}`);
    }
  }

  async function syncNow() {
    if (!sync) return;
    try {
      const r = await api.putDocument(sync.householdId, sync.version, ds);
      setSync({ ...sync, version: r.version, dirty: false, lastSyncedAt: new Date().toISOString() });
      setStatus("Synced.");
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const remote = await api.getDocument(sync.householdId);
        setStatus(`Someone else changed the household (server version ${remote.version}). Choose which copy to keep.`);
        setConflict(remote);
      } else setStatus(`Sync failed: ${(e as Error).message}`);
    }
  }
  const [conflict, setConflict] = useState<{ version: number; dataset: typeof ds | null } | null>(null);

  return (
    <Card title="Self-hosted server" actions={sync ? <Badge tone={sync.dirty ? "warn" : "good"}>{sync.dirty ? "Unsynced changes" : "Synced"}</Badge> : <Badge>Off</Badge>}>
      <p className="mb-3 text-sm text-stone-600 dark:text-stone-400">Optional. Syncs an encrypted copy to your own Cúntas server for household sharing and bank sync. Sign in with a passkey.</p>
      {!sync ? (
        <div className="space-y-3">
          <Field label="Server URL">{(id) => <Input id={id} value={url} onChange={(e) => setUrl(e.target.value)} />}</Field>
          <Field label="Your name (for a new account)">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => signedIn(() => api.signIn())}>Sign in with passkey</Button>
            <Button disabled={!name.trim()} onClick={() => signedIn(() => api.register(name.trim()))}>Create account with passkey</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm">Server {sync.apiUrl} · version {sync.version}{sync.lastSyncedAt && ` · last sync ${formatDate(sync.lastSyncedAt.slice(0, 10))}`}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={syncNow}>Sync now</Button>
            <Button onClick={async () => setInvite((await api.invite(sync.householdId)).url)}>Invite a member</Button>
            <Button variant="ghost" onClick={async () => { await api.logout().catch(() => undefined); setSync(null); setStatus("Disconnected. Data stays on this device."); }}>Disconnect</Button>
          </div>
          {invite && <p className="break-all rounded bg-stone-50 p-2 text-xs dark:bg-stone-800">Share this link (valid 72 hours): {invite}</p>}
          {conflict && (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => { if (conflict.dataset) replaceDataset(conflict.dataset, { ...sync, version: conflict.version, dirty: false, lastSyncedAt: new Date().toISOString() }); setConflict(null); }}>Keep server copy</Button>
              <Button variant="danger" onClick={async () => { const r = await api.putDocument(sync.householdId, conflict.version, ds); setSync({ ...sync, version: r.version, dirty: false, lastSyncedAt: new Date().toISOString() }); setConflict(null); setStatus("Overwrote the server copy."); }}>Keep this device's copy</Button>
            </div>
          )}
        </div>
      )}
      {status && <p className="mt-3 text-sm">{status}</p>}
    </Card>
  );
}
