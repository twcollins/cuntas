import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { PeopleWithAccess } from "./household/PeopleWithAccess";
import { Badge, Button, Card, Field, Input, PageHeader, Select } from "../components/ui";
import { createOnServer, deleteOnServer } from "../lib/server";
import { removeHousehold, setHouseholdSync, startDemo, startEmpty, switchHousehold, useStore, type HouseholdEntry } from "../lib/store";

/** Every household on this device: add, switch, remove, and (for synced ones) who can open it. */
export function HouseholdsPage() {
  const { households, activeId } = useStore();
  const [msg, setMsg] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>, done?: string) => {
    try {
      setMsg(null);
      await fn();
      if (done) setMsg(done);
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  return (
    <div>
      <PageHeader title="Households" subtitle="Keep several households on this device, each with its own accounts, budgets and plan. Switch between them from the menu at the top of the sidebar." />
      {msg && <p role="status" className="mb-4 rounded-lg bg-brand-50 p-3 text-sm text-brand-800 dark:bg-brand-900/30 dark:text-brand-100">{msg}</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="On this device">
          <ul className="divide-y divide-stone-100 text-sm dark:divide-stone-800">
            {households.map((h) => (
              <HouseholdRow key={h.id} h={h} active={h.id === activeId} run={run} />
            ))}
          </ul>
        </Card>
        <AddHousehold run={run} />
      </div>
      <PeopleWithAccess />
    </div>
  );
}

function HouseholdRow({ h, active, run }: { h: HouseholdEntry; active: boolean; run: (fn: () => Promise<unknown>, done?: string) => Promise<void> }) {
  const { account } = useStore();
  const canDeleteOnServer = !!h.sync && account?.apiUrl === h.sync.apiUrl;
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2">
      <span className="flex flex-wrap items-center gap-1">
        <span className="font-medium">{h.name}</span>
        {active && <Badge tone="good">Open now</Badge>}
        {h.sync ? <Badge tone="info">Synced</Badge> : <Badge>This device only</Badge>}
      </span>
      <span className="flex flex-wrap gap-1">
        {!active && <Button onClick={() => run(() => switchHousehold(h.id))}>Switch</Button>}
        <Button
          variant="ghost"
          onClick={() => {
            const warning = h.sync
              ? `Remove “${h.name}” from this device? The server copy is kept, so you can open it again by signing in.`
              : `Remove “${h.name}” from this device? It isn't synced anywhere, so its data will be gone for good. Export it first from Settings if you want to keep it.`;
            if (window.confirm(warning)) void run(() => removeHousehold(h.id), `Removed “${h.name}” from this device.`);
          }}
        >
          Remove from device
        </Button>
        {canDeleteOnServer && (
          <Button
            variant="ghost"
            className="text-rose-600 dark:text-rose-400"
            onClick={() => {
              if (!window.confirm(`Delete “${h.name}” on the server for everyone who shares it, and disconnect its banks? The copy on this device is kept. Only owners can do this.`)) return;
              void run(async () => {
                await deleteOnServer(h.sync!.apiUrl, h.sync!.householdId);
                setHouseholdSync(h.id, null);
              }, `Deleted “${h.name}” on the server. It stays on this device.`);
            }}
          >
            Delete on server
          </Button>
        )}
      </span>
    </li>
  );
}

function AddHousehold({ run }: { run: (fn: () => Promise<unknown>, done?: string) => Promise<void> }) {
  const { account } = useStore();
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState<"EUR" | "GBP">("EUR");
  const [onServer, setOnServer] = useState(false);
  const [invite, setInvite] = useState("");
  const token = invite.includes("#") ? invite.slice(invite.indexOf("#") + 1).trim() : invite.trim();
  const create = () => {
    const n = name.trim() || "My household";
    void run(() => (onServer && account ? createOnServer(account.apiUrl, n, currency) : startEmpty(n, currency)), `Created “${n}”.`);
    setName("");
  };
  return (
    <Card title="Add a household">
      <div className="space-y-4">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="My household" />}</Field>
            <Field label="Base currency">{(id) => <Select id={id} value={currency} onChange={(e) => setCurrency(e.target.value as "EUR" | "GBP")} options={[{ value: "EUR", label: "Euro (EUR)" }, { value: "GBP", label: "Sterling (GBP)" }]} />}</Field>
          </div>
          {account && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={onServer} onChange={(e) => setOnServer(e.target.checked)} />
              Also create it on {account.apiUrl} so it can be shared
            </label>
          )}
          <Button variant="primary" onClick={create}>Start a new household</Button>
        </div>
        <div className="border-t border-stone-100 pt-3 dark:border-stone-800">
          <p className="mb-2 text-sm text-stone-600 dark:text-stone-400">A couple in Dublin with six months of transactions, to try things out.</p>
          <Button onClick={() => run(startDemo, "Opened the demo household.")}>Open the demo</Button>
        </div>
        <div className="border-t border-stone-100 pt-3 dark:border-stone-800">
          <Field label="Join with an invite link" hint="Paste the link someone shared with you.">{(id) => <Input id={id} value={invite} onChange={(e) => setInvite(e.target.value)} placeholder="https://…/join#…" />}</Field>
          <Link to="/join" hash={token} disabled={!token} className={`mt-2 inline-flex items-center rounded-lg border border-stone-300 px-3 py-1.5 text-sm font-medium dark:border-stone-700 ${token ? "hover:bg-stone-50 dark:hover:bg-stone-800" : "pointer-events-none opacity-50"}`}>Continue</Link>
        </div>
      </div>
    </Card>
  );
}
