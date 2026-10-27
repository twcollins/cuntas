import { useEffect, useState } from "react";
import { exportCsv, exportJson, importJson } from "@cuntas/ledger";
import { Link } from "@tanstack/react-router";
import { addDays, CURRENCIES, today } from "@cuntas/rules";
import { ThemeSwitch } from "../components/Layout";
import { Badge, Button, Card, Field, Input, PageHeader } from "../components/ui";
import { decryptBackup, encryptBackup } from "../lib/backup";
import { download, formatDate } from "../lib/format";
import { onOpened, takeOpened } from "../lib/opened";
import { platform } from "../lib/platform";
import { fetchEcbRates, mergeRates } from "../lib/fx";
import { clearRulePacks, restoreRulePacks, rulePackData, useRulePacks, useRulePrompts, type RulePackData } from "../lib/rulepacks";
import { markBackedUp, replaceDataset, update, useActiveEntry, useDataset, wipeAll } from "../lib/store";

const PAYLOAD = "cuntas-backup-payload";

/** The encrypted backup carries the household and this device's tax rule files. */
function backupJson(ds: ReturnType<typeof useDataset>): string {
  return JSON.stringify({ format: PAYLOAD, v: 1, dataset: JSON.parse(exportJson(ds)), rules: rulePackData() });
}

export function SettingsPage() {
  const ds = useDataset();
  const [msg, setMsg] = useState<string | null>(null);
  const [pass, setPass] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const lastRate = ds.fxRates.at(-1);
  const rules = useRulePacks();
  const prompts = useRulePrompts(ds, today());
  const entry = useActiveEntry();
  const stamp = new Date().toISOString().slice(0, 10);
  // A backup or export opened in the app from elsewhere waits here for the user to confirm.
  const [opened, setOpened] = useState<File | null>(null);
  useEffect(() => {
    const take = () => {
      const files = takeOpened("backup");
      if (files.length) setOpened(files.at(-1)!);
    };
    take();
    return onOpened(take);
  }, []);

  async function restore(file: File, encrypted: boolean) {
    try {
      const text = await file.text();
      const json = encrypted ? await decryptBackup(text, pass) : text;
      const parsed = JSON.parse(json) as { format?: string; dataset?: unknown; rules?: RulePackData };
      if (parsed.format === PAYLOAD) {
        replaceDataset(importJson(JSON.stringify(parsed.dataset)));
        if (parsed.rules) await restoreRulePacks(parsed.rules);
      } else {
        replaceDataset(importJson(json));
      }
      setMsg("Data restored.");
      setOpened(null);
    } catch (e) {
      setMsg(`Could not restore: ${(e as Error).message}`);
    }
  }

  return (
    <div>
      <PageHeader title="Settings" subtitle="Export and back up this household, update exchange rates, change the look, or delete everything on this device. Sign-in and sync are under Account & sync." />
      {platform().warning && <p role="alert" className="mb-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-900/30 dark:text-rose-100">{platform().warning}</p>}
      {opened && (
        <Card title={`Restore ${opened.name}?`} className="mb-4 border-amber-300 dark:border-amber-800">
          <p className="mb-3 text-sm text-stone-600 dark:text-stone-400">This replaces {ds.household.name} on this device with the household in the file. Export it first if you want to keep it.</p>
          <div className="flex flex-wrap items-end gap-2">
            {opened.name.toLowerCase().endsWith(".cuntas") && <Field label="Passphrase for this backup">{(id) => <Input id={id} type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="current-password" />}</Field>}
            <Button variant="primary" disabled={opened.name.toLowerCase().endsWith(".cuntas") && pass.length < 8} onClick={() => void restore(opened, opened.name.toLowerCase().endsWith(".cuntas"))}>Restore</Button>
            <Button onClick={() => setOpened(null)}>Cancel</Button>
          </div>
        </Card>
      )}
      {msg && <p role="status" className="mb-4 rounded-lg bg-brand-50 p-3 text-sm text-brand-800 dark:bg-brand-900/30 dark:text-brand-100">{msg}</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Export">
          <p className="mb-3 text-sm text-stone-600 dark:text-stone-400">Full export of every record. JSON restores exactly; CSV gives one file per entity.</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={async () => { await download(`cuntas-${stamp}.json`, exportJson(ds)); markBackedUp(); }}>Export JSON</Button>
            <Button onClick={() => void platform().files.save(Object.entries(exportCsv(ds)).map(([name, data]) => ({ name, mime: "text/csv", data })))}>Export CSV files</Button>
          </div>
          <div className="mt-4">
            <Field label="Restore from JSON export">{(id) => <input id={id} type="file" accept=".json" className="text-sm" onChange={(e) => e.target.files?.[0] && restore(e.target.files[0], false)} />}</Field>
          </div>
        </Card>

        <div id="backup">
        <Card title="Encrypted backup">
          <p className="mb-3 text-sm text-stone-600 dark:text-stone-400">AES-256-GCM, with a key derived from your passphrase on this device. Without the passphrase the backup cannot be opened. It includes your tax rule files and checks.</p>
          <p className="mb-3 text-sm text-stone-500">{entry?.backedUpAt ? `Last backed up or exported ${formatDate(entry.backedUpAt.slice(0, 10))}.` : "Not backed up from this device yet."}</p>
          <Field label="Passphrase">{(id) => <Input id={id} type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" />}</Field>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="primary" disabled={pass.length < 8} onClick={async () => { await download(`cuntas-${stamp}.cuntas`, await encryptBackup(backupJson(ds), pass)); markBackedUp(); }}>{platform().name === "web" ? "Download backup" : "Save backup"}</Button>
            <label className="text-sm">Restore: <input type="file" accept=".cuntas" disabled={pass.length < 8} onChange={(e) => e.target.files?.[0] && restore(e.target.files[0], true)} /></label>
          </div>
          {pass.length > 0 && pass.length < 8 && <p className="mt-1 text-xs text-stone-500">Use at least 8 characters.</p>}
        </Card>
        </div>

        <Card title="Exchange rates">
          <p className="text-sm text-stone-600 dark:text-stone-400">
            {CURRENCIES.filter((c) => c !== "EUR").map((c) => `${ds.fxRates.filter((r) => r.quote === c).length} EUR/${c}`).join(", ")} rates stored{lastRate && <>, latest {formatDate(lastRate.date)} ({lastRate.source})</>}. Other pairs convert through EUR.
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

        <Card title="Tax rules" actions={prompts.length > 0 ? <Badge tone="warn">{prompts.length} to do</Badge> : undefined}>
          <p className="mb-3 text-sm text-stone-600 dark:text-stone-400">
            {rules.files.length === 0 ? "Using the packs that ship with the app." : `${rules.files.length} rule ${rules.files.length === 1 ? "file" : "files"} loaded on this device.`} Provisional packs reflect Budget announcements not yet in law; verify figures with Revenue and HMRC before relying on them.
          </p>
          <Link to="/tax-rules" className="text-sm font-medium text-brand-700 underline dark:text-brand-500">Open Tax rules</Link>
        </Card>

        <Card title="Appearance">
          <p className="mb-3 text-sm text-stone-600 dark:text-stone-400">Light, dark, or follow your device. Saved on this device only.</p>
          <ThemeSwitch />
        </Card>

        <Card title="Delete everything" className="border-rose-200 dark:border-rose-900">
          <p className="mb-3 text-sm text-stone-600 dark:text-stone-400">Removes every household, your tax rule files and your sign-in from this device. Export first if you want to keep it. Type DELETE to confirm.</p>
          <div className="flex gap-2">
            <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} aria-label="Type DELETE to confirm" placeholder="DELETE" />
            <Button variant="danger" disabled={confirmText !== "DELETE"} onClick={() => void Promise.all([wipeAll(), clearRulePacks()])}>Delete all data</Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
