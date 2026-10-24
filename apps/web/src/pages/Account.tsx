import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ServerHouseholdList, ServerSignIn } from "../components/ServerAccess";
import { Badge, Button, Card, PageHeader } from "../components/ui";
import { apiClient, ApiError } from "../lib/api";
import { formatDate } from "../lib/format";
import { refreshAccount, signOut, uploadActiveHousehold, type ServerHousehold } from "../lib/server";
import { replaceDataset, setSync, useDataset, useStore } from "../lib/store";

/** Signing in to an optional self-hosted server, and how the active household syncs with it. */
export function AccountPage() {
  const { account } = useStore();
  const [households, setHouseholds] = useState<ServerHousehold[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const reload = async () => {
    if (!account) return;
    try {
      setHouseholds((await refreshAccount(account.apiUrl)).households);
    } catch (e) {
      setMsg(e instanceof ApiError && e.status === 401 ? "Your session has ended. Sign in again." : `Could not reach the server: ${(e as Error).message}`);
    }
  };
  useEffect(() => {
    void reload();
  }, [account?.apiUrl, account?.userId]);

  return (
    <div>
      <PageHeader title="Account & sync" subtitle="Optional. Sign in to your own Cúntas server to share a household or use bank sync. Without it, everything stays on this device." />
      {msg && <p role="status" className="mb-4 rounded-lg bg-brand-50 p-3 text-sm text-brand-800 dark:bg-brand-900/30 dark:text-brand-100">{msg}</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        {!account ? (
          <Card title="Sign in" className="lg:col-span-2 max-w-xl">
            <ServerSignIn onSignedIn={(list) => { setHouseholds(list); setMsg(null); }} />
          </Card>
        ) : (
          <>
            <Card title="Signed in" actions={account.isAdmin && <Badge tone="info">Server admin</Badge>}>
              <p className="text-sm">{account.displayName} on <span className="font-mono text-xs">{account.apiUrl}</span></p>
              <div className="mt-3 flex flex-wrap gap-2">
                {account.isAdmin && <Link to="/admin" className="inline-flex items-center rounded-lg px-3 py-1.5 text-sm font-medium text-brand-700 hover:bg-stone-100 dark:text-brand-500 dark:hover:bg-stone-800">Server admin</Link>}
                <Button variant="ghost" onClick={async () => { await signOut(account.apiUrl); setHouseholds(null); setMsg("Signed out. Your households stay on this device."); }}>Sign out</Button>
              </div>
            </Card>
            <Card title="Your households on this server">
              {households === null ? <p className="text-sm text-stone-500">Loading…</p> : <ServerHouseholdList apiUrl={account.apiUrl} households={households} onOpened={(r) => setMsg(r === "added" ? "Opened on this device." : "Switched household.")} />}
            </Card>
          </>
        )}
        <ActiveSync onChanged={reload} />
      </div>
    </div>
  );
}

/** Sync for the household that is open now. */
function ActiveSync({ onChanged }: { onChanged: () => void }) {
  const ds = useDataset();
  const { account, sync } = useStore();
  const [status, setStatus] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ version: number; dataset: typeof ds | null } | null>(null);

  async function syncNow() {
    if (!sync) return;
    const api = apiClient(sync.apiUrl);
    try {
      const r = await api.putDocument(sync.householdId, sync.version, ds);
      setSync({ ...sync, version: r.version, dirty: false, lastSyncedAt: new Date().toISOString() });
      setStatus("Synced.");
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const remote = await api.getDocument(sync.householdId);
        setStatus(`Someone else changed this household (server version ${remote.version}). Choose which copy to keep.`);
        setConflict(remote);
      } else setStatus(`Sync failed: ${(e as Error).message}`);
    }
  }

  return (
    <Card title={`Syncing “${ds.household.name}”`} actions={sync ? <Badge tone={sync.dirty ? "warn" : "good"}>{sync.dirty ? "Unsynced changes" : "Synced"}</Badge> : <Badge>This device only</Badge>}>
      {!sync ? (
        <div className="space-y-3 text-sm text-stone-600 dark:text-stone-400">
          <p>This household is stored on this device only.</p>
          {account ? (
            <Button variant="primary" onClick={async () => { try { await uploadActiveHousehold(account.apiUrl, ds); setStatus("Uploaded. This household now syncs with the server."); onChanged(); } catch (e) { setStatus(`Upload failed: ${(e as Error).message}`); } }}>Sync it to {account.apiUrl}</Button>
          ) : (
            <p>Sign in to a server to sync it.</p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm">Server <span className="font-mono text-xs">{sync.apiUrl}</span> · version {sync.version}{sync.lastSyncedAt && ` · last sync ${formatDate(sync.lastSyncedAt.slice(0, 10))}`}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={syncNow}>Sync now</Button>
            <Button variant="ghost" onClick={() => { if (window.confirm("Stop syncing this household? It stays on this device and on the server, but changes will no longer be shared.")) { setSync(null); setStatus("Stopped syncing. The household stays on this device."); } }}>Stop syncing</Button>
          </div>
          {conflict && (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => { if (conflict.dataset && window.confirm("Replace this device's copy with the server copy?")) { replaceDataset(conflict.dataset, { ...sync, version: conflict.version, dirty: false, lastSyncedAt: new Date().toISOString() }); setConflict(null); setStatus("Kept the server copy."); } }}>Keep server copy</Button>
              <Button variant="danger" onClick={async () => { const r = await apiClient(sync.apiUrl).putDocument(sync.householdId, conflict.version, ds); setSync({ ...sync, version: r.version, dirty: false, lastSyncedAt: new Date().toISOString() }); setConflict(null); setStatus("Overwrote the server copy."); }}>Keep this device's copy</Button>
            </div>
          )}
        </div>
      )}
      {status && <p className="mt-3 text-sm">{status}</p>}
    </Card>
  );
}
