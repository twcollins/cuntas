import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { accountTypes, importStatement, isLiability, latestValuation, newId, wrappers, type Account } from "@cuntas/ledger";
import { consentStatusLabel } from "../lib/consent";
import { Badge, Button, Card, Empty, Field, Input, Modal, MoneyInput, PageHeader, Select, Table } from "../components/ui";
import { useAsOf, useBalances } from "../lib/derived";
import { currencyOptions, formatDate, money, moneyExact, taxCountryOptions } from "../lib/format";
import { apiClient } from "../lib/api";
import { replaceDataset, update, useDataset, useStore } from "../lib/store";
import { isCurrency, type Currency, type Jurisdiction } from "@cuntas/rules";
import { countryForCurrency, homeOf, termsFor, type Terms } from "../lib/region";

const TYPE_LABELS: Record<Account["type"], string> = {
  // "current" reads "Checking account" for a US household: see typeLabel.
  current: "Current account", savings: "Savings", creditCard: "Credit card", loan: "Loan", mortgage: "Mortgage", pension: "Pension",
  brokerage: "Investments", property: "Property", vehicle: "Vehicle", cash: "Cash", other: "Other asset",
};

const typeLabel = (t: Account["type"], terms: Terms) => (t === "current" ? terms.currentAccount : TYPE_LABELS[t]);

function blankAccount(ds: ReturnType<typeof useDataset>, asOf: string): Account {
  return { id: newId("acc"), name: "", memberIds: ds.members.map((m) => m.id), type: "current", currency: ds.household.baseCurrency, institutionId: null, wrapper: "none", jurisdiction: homeOf(ds), openingBalanceMinor: 0, openingDate: asOf, valuations: [], isEmergencyFund: false, archived: false };
}

export function AccountsPage() {
  const ds = useDataset();
  const terms = termsFor(ds);
  const asOf = useAsOf();
  const { native, base } = useBalances(ds);
  const [editing, setEditing] = useState<Account | null>(null);
  const [valuing, setValuing] = useState<{ account: Account; value: number } | null>(null);
  const baseCur = ds.household.baseCurrency;
  const groups = [
    { title: terms.cashGroup, types: ["current", "savings", "cash"] },
    { title: "Debts", types: ["creditCard", "loan", "mortgage"] },
    { title: "Investments and pensions", types: ["brokerage", "pension"] },
    { title: "Property and other assets", types: ["property", "vehicle", "other"] },
  ];

  return (
    <div>
      <PageHeader title="Accounts" subtitle="Bank accounts, credit union shares and loans, pensions, property and other assets, in any of the app's currencies." actions={<Button variant="primary" onClick={() => setEditing(blankAccount(ds, asOf))}>Add account</Button>} />
      <BankConnections />
      <div className="mt-4 space-y-4">
        {groups.map((g) => {
          const list = ds.accounts.filter((a) => g.types.includes(a.type) && !a.archived);
          if (list.length === 0) return null;
          const total = list.reduce((s, a) => s + (base.get(a.id) ?? 0), 0);
          return (
            <Card key={g.title} title={g.title} actions={<span className="text-sm font-semibold tabular-nums">{money(total, baseCur)}</span>}>
              <Table head={["Account", "Type", "Balance", baseCur, ""]}>
                {list.map((a) => {
                  const valued = latestValuation(a, asOf);
                  return (
                    <tr key={a.id}>
                      <td className="px-2 py-2">
                        <div className="font-medium">{a.name}</div>
                        <div className="flex gap-1">
                          <Badge>{a.jurisdiction}</Badge>
                          {a.wrapper !== "none" && <Badge tone="info">{a.wrapper}</Badge>}
                          {a.isEmergencyFund && <Badge tone="good">Emergency fund</Badge>}
                        </div>
                      </td>
                      <td className="px-2 py-2 text-stone-500">{typeLabel(a.type, terms)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {a.tracksBalance === false ? <span className="text-stone-500" title="Spending from this wallet counts; its balance isn't kept.">Not tracked</span> : moneyExact(native.get(a.id) ?? 0, a.currency)}
                        {valued && <div className="text-xs text-stone-500">valued {formatDate(valued.date)}</div>}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-stone-500">{base.get(a.id) === null ? "FX rate needed" : money(base.get(a.id)!, baseCur)}</td>
                      <td className="whitespace-nowrap px-2 py-2 text-right">
                        {["property", "vehicle", "pension", "brokerage", "other"].includes(a.type) && <Button variant="ghost" onClick={() => setValuing({ account: a, value: native.get(a.id) ?? 0 })}>Update value</Button>}
                        <Button variant="ghost" onClick={() => setEditing(a)}>Edit</Button>
                      </td>
                    </tr>
                  );
                })}
              </Table>
            </Card>
          );
        })}
        {ds.accounts.length === 0 && <Empty title="No accounts yet">Import a statement and its account is created for you, or add one by hand.<div className="mt-3 flex justify-center gap-2"><Link to="/import" className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700">Import statements</Link><Button onClick={() => setEditing(blankAccount(ds, asOf))}>Add account</Button></div></Empty>}
      </div>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing && ds.accounts.some((a) => a.id === editing.id) ? "Edit account" : "Add account"}>
        {editing && <AccountForm account={editing} onDone={() => setEditing(null)} />}
      </Modal>
      <Modal open={!!valuing} onClose={() => setValuing(null)} title="Update valuation">
        {valuing && (
          <div className="space-y-3">
            <Field label={`Value of ${valuing.account.name} today (${valuing.account.currency})`}>{(id) => <MoneyInput id={id} value={valuing.value} onChange={(v) => setValuing({ ...valuing, value: v })} />}</Field>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setValuing(null)}>Cancel</Button>
              <Button variant="primary" onClick={() => { update((d) => ({ ...d, accounts: d.accounts.map((a) => (a.id === valuing.account.id ? { ...a, valuations: [...a.valuations.filter((v) => v.date !== asOf), { date: asOf, valueMinor: valuing.value }] } : a)) }), "account.value"); setValuing(null); }}>Save</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function AccountForm({ account, onDone }: { account: Account; onDone: () => void }) {
  const ds = useDataset();
  const terms = termsFor(ds);
  const [a, setA] = useState(account);
  const exists = ds.accounts.some((x) => x.id === a.id);
  const liability = isLiability(a);
  return (
    <div className="space-y-3">
      <Field label="Name">{(id) => <Input id={id} value={a.name} onChange={(e) => setA({ ...a, name: e.target.value })} placeholder="e.g. Credit union shares" />}</Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type">{(id) => <Select id={id} value={a.type} onChange={(e) => setA({ ...a, type: e.target.value as Account["type"] })} options={accountTypes.map((t) => ({ value: t, label: typeLabel(t, terms) }))} />}</Field>
        <Field label="Wrapper">{(id) => <Select id={id} value={a.wrapper} onChange={(e) => setA({ ...a, wrapper: e.target.value as Account["wrapper"] })} options={wrappers.map((w) => ({ value: w, label: w === "none" ? "None" : w }))} />}</Field>
        <Field label="Currency">{(id) => <Select id={id} value={a.currency} onChange={(e) => setA({ ...a, currency: e.target.value as Currency })} options={currencyOptions()} />}</Field>
        <Field label="Country">{(id) => <Select id={id} value={a.jurisdiction} onChange={(e) => setA({ ...a, jurisdiction: e.target.value as Jurisdiction })} options={taxCountryOptions()} />}</Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={liability ? "Opening balance owed" : "Opening balance"} hint={liability ? "Enter what you owe as a positive amount." : undefined}>
          {(id) => <MoneyInput id={id} value={liability ? -a.openingBalanceMinor : a.openingBalanceMinor} onChange={(v) => setA({ ...a, openingBalanceMinor: liability ? -Math.abs(v) : v })} />}
        </Field>
        <Field label="As of">{(id) => <Input id={id} type="date" value={a.openingDate} onChange={(e) => setA({ ...a, openingDate: e.target.value })} />}</Field>
      </div>
      <fieldset className="text-sm">
        <legend className="mb-1 text-xs font-medium text-stone-600">Owners</legend>
        {ds.members.map((m) => (
          <label key={m.id} className="mr-4 inline-flex items-center gap-1">
            <input type="checkbox" checked={a.memberIds.includes(m.id)} onChange={(e) => setA({ ...a, memberIds: e.target.checked ? [...a.memberIds, m.id] : a.memberIds.filter((x) => x !== m.id) })} />
            {m.name}
          </label>
        ))}
      </fieldset>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={a.isEmergencyFund} onChange={(e) => setA({ ...a, isEmergencyFund: e.target.checked })} />
        Counts toward the emergency fund
      </label>
      <div className="flex justify-between gap-2 pt-2">
        {exists ? <Button variant="danger" onClick={() => { update((d) => ({ ...d, accounts: d.accounts.map((x) => (x.id === a.id ? { ...x, archived: true } : x)) }), "account.archive"); onDone(); }}>Archive</Button> : <span />}
        <div className="flex gap-2">
          <Button onClick={onDone}>Cancel</Button>
          <Button variant="primary" disabled={!a.name.trim()} onClick={() => { update((d) => ({ ...d, accounts: exists ? d.accounts.map((x) => (x.id === a.id ? a : x)) : [...d.accounts, a] }), exists ? "account.edit" : "account.create"); onDone(); }}>Save</Button>
        </div>
      </div>
    </div>
  );
}

/** Bank sync runs through a self-hosted server (it holds the aggregator keys). */
function BankConnections() {
  const { sync } = useStore();
  const ds = useDataset();
  const asOf = useAsOf();
  const [country, setCountry] = useState<"IE" | "UK">("IE");
  const [message, setMessage] = useState("");
  const api = sync ? apiClient(sync.apiUrl) : null;
  const conns = useQuery({ queryKey: ["connections", sync?.householdId], queryFn: () => api!.connections(sync!.householdId), enabled: !!api });
  const insts = useQuery({ queryKey: ["institutions", sync?.householdId, country], queryFn: () => api!.institutions(sync!.householdId, country), enabled: !!api });

  if (!sync || !api) {
    return (
      <Card title="Bank sync">
        <p className="text-sm text-stone-600 dark:text-stone-400">Bank sync uses read-only open banking (PSD2) consent through a licensed aggregator, which needs the self-hosted server. Sign in to one under <strong>Account &amp; sync</strong> and sync this household, or import CSV, OFX or CAMT.053 files.</p>
      </Card>
    );
  }

  async function pull(connId: string, accounts: { ref: string; name: string; currency: string }[]) {
    await api!.syncConnection(sync!.householdId, connId);
    const rows = await api!.connectionTransactions(sync!.householdId, connId, "2000-01-01");
    let d = ds;
    let added = 0;
    let merged = 0;
    for (const acc of accounts) {
      let local = d.accounts.find((a) => a.institutionId === `conn:${connId}:${acc.ref}`);
      if (!local) {
        const currency = isCurrency(acc.currency) ? acc.currency : d.household.baseCurrency;
        local = { ...blankAccount(d, asOf), name: acc.name, currency, jurisdiction: countryForCurrency(d, currency), institutionId: `conn:${connId}:${acc.ref}`, openingDate: "2000-01-01" };
        d = { ...d, accounts: [...d.accounts, local] };
      }
      const r = importStatement(d, local.id, { format: "csv", warnings: [], transactions: rows.filter((x) => x.accountRef === acc.ref).map((x) => x.transaction) });
      d = r.dataset;
      added += r.added;
      merged += r.merged;
    }
    replaceDataset(d);
    setMessage(`Synced: ${added} new transactions${merged ? `; ${merged} matched to ones you added by hand` : ""}.`);
  }

  return (
    <Card title="Bank connections" actions={<Badge tone="info">Read-only</Badge>}>
      {message && <p className="mb-2 text-sm text-brand-700">{message}</p>}
      {(conns.data ?? []).filter((c) => c.status !== "revoked").map((c) => (
        <div key={c.id} className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-stone-50 p-3 text-sm dark:bg-stone-800/50">
          <div>
            <div className="font-medium">{c.institutionName}</div>
            <div className="text-xs text-stone-500">{consentStatusLabel(c.status, c.consentExpiresAt, asOf)}{c.lastSyncedAt && ` · last sync ${formatDate(c.lastSyncedAt.slice(0, 10))}`}</div>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => pull(c.id, c.accounts)} disabled={c.status !== "active"}>Sync now</Button>
            <Button variant="ghost" onClick={async () => { await api.revokeConnection(sync.householdId, c.id); await conns.refetch(); }}>Disconnect</Button>
          </div>
        </div>
      ))}
      <div className="mt-3 flex flex-wrap gap-2">
        <Select aria-label="Country" value={country} onChange={(e) => setCountry(e.target.value as "IE" | "UK")} options={[{ value: "IE", label: "Ireland" }, { value: "UK", label: "UK" }]} className="w-auto" />
        {(insts.data ?? []).slice(0, 12).map((i) => (
          <Button key={i.id} onClick={async () => { const { url } = await api.connect(sync.householdId, { institutionId: i.id, institutionName: i.name, country }); window.location.href = url; }}>Connect {i.name}</Button>
        ))}
      </div>
      <p className="mt-2 text-xs text-stone-500">Consent lasts 90 days. You'll get a reminder 7 days before it expires. Cúntas never sees your bank credentials.</p>
    </Card>
  );
}
