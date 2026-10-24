import { useState } from "react";
import { exportCsv, exportJson, importJson } from "@cuntas/ledger";
import { addDays, MANIFEST } from "@cuntas/rules";
import { ThemeSwitch } from "../components/Layout";
import { Button, Card, Field, Input, PageHeader } from "../components/ui";
import { decryptBackup, encryptBackup } from "../lib/backup";
import { download, formatDate } from "../lib/format";
import { fetchEcbRates, mergeRates } from "../lib/fx";
import { replaceDataset, update, useDataset, wipeAll } from "../lib/store";

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
      <PageHeader title="Settings" subtitle="Export and back up this household, update exchange rates, change the look, or delete everything on this device. Sign-in and sync are under Account & sync." />
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

        <Card title="Rule packs">
          <ul className="space-y-1 text-sm">
            {MANIFEST.map((m) => <li key={m.key} className="flex justify-between"><code>{m.version}</code><span className="font-mono text-xs text-stone-500">{m.sha256.slice(0, 12)}…</span></li>)}
          </ul>
          <p className="mt-2 text-xs text-stone-500">Provisional packs reflect Budget announcements not yet in a Finance Act. Verify figures with Revenue and HMRC before relying on them.</p>
        </Card>

        <Card title="Appearance">
          <p className="mb-3 text-sm text-stone-600 dark:text-stone-400">Light, dark, or follow your device. Saved on this device only.</p>
          <ThemeSwitch />
        </Card>

        <Card title="Delete everything" className="border-rose-200 dark:border-rose-900">
          <p className="mb-3 text-sm text-stone-600 dark:text-stone-400">Removes every household and your sign-in from this device. Export first if you want to keep it. Type DELETE to confirm.</p>
          <div className="flex gap-2">
            <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} aria-label="Type DELETE to confirm" placeholder="DELETE" />
            <Button variant="danger" disabled={confirmText !== "DELETE"} onClick={() => void wipeAll()}>Delete all data</Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
