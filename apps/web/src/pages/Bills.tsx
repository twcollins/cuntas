import { useMemo, useState } from "react";
import { BILL_TEMPLATES, billCadences, detectRecurring, newId, nextDueOf, perYear, upcomingBills, type Bill, type RecurringSeries } from "@cuntas/ledger";
import { addDays } from "@cuntas/rules";
import { Badge, Button, Card, Disclaimer, Empty, Field, Input, Modal, MoneyInput, PageHeader, Select, Stat, Table } from "../components/ui";
import { useAsOf, useCategoryName } from "../lib/derived";
import { formatDate, money } from "../lib/format";
import { update, useDataset } from "../lib/store";

const CADENCE_LABEL: Record<Bill["cadence"], string> = { weekly: "Weekly", fortnightly: "Fortnightly", monthly: "Monthly", quarterly: "Quarterly", annual: "Yearly", biennial: "Every 2 years" };

export function BillsPage() {
  const ds = useDataset();
  const asOf = useAsOf();
  const catName = useCategoryName(ds);
  const base = ds.household.baseCurrency;
  const detected = useMemo(() => detectRecurring(ds, asOf), [ds, asOf]);
  const upcoming = useMemo(() => upcomingBills(ds, asOf, 60), [ds, asOf]);
  const [editing, setEditing] = useState<Bill | null>(null);
  const linked = new Set(ds.bills.map((b) => b.payeeKey).filter(Boolean));
  const active = detected.filter((r) => r.status === "active");
  const rises = active.filter((r) => r.priceChange);
  const yearly = ds.bills.reduce((a, b) => a + (b.currency === base ? Math.round(b.amountMinor * perYear(b.cadence)) : 0), 0) + active.filter((r) => !linked.has(r.key) && r.currency === base).reduce((a, r) => a + r.annualCostMinor, 0);
  const next30 = upcoming.filter((u) => u.date <= addDays(asOf, 30));

  const blank = (): Bill => ({ id: newId("bill"), name: "", template: null, cadence: "monthly", amountMinor: 0, currency: base, nextDue: asOf, categoryId: null, payeeKey: null });

  return (
    <div>
      <PageHeader
        title="Bills"
        subtitle="Subscriptions and bills found in your transactions, plus the once-a-year ones that are easy to forget."
        actions={<Button variant="primary" onClick={() => setEditing(blank())}>Add bill</Button>}
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat label="Due in the next 30 days" value={money(next30.filter((u) => u.currency === base).reduce((a, u) => a + u.amountMinor, 0), base)} hint={`${next30.length} payments`} />
        <Stat label="Bills a year" value={money(yearly, base)} hint={`${ds.bills.length + active.filter((r) => !linked.has(r.key)).length} recurring payments`} />
        <Stat label="Price rises spotted" value={rises.length} tone={rises.length ? "bad" : undefined} hint={rises.length ? rises.map((r) => r.payee).join(", ") : "None in recent payments"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Coming up (60 days)">
          {upcoming.length === 0 ? <p className="text-sm text-stone-500">Nothing due.</p> : (
            <ul className="divide-y divide-stone-100 text-sm dark:divide-stone-800">
              {upcoming.map((u, i) => (
                <li key={`${u.name}-${u.date}-${i}`} className="flex items-center justify-between gap-2 py-2">
                  <span className="flex items-center gap-2">
                    <span className="w-24 shrink-0 tabular-nums text-stone-500">{formatDate(u.date)}</span>
                    <span>{u.name}</span>
                    {u.source === "detected" && <Badge>detected</Badge>}
                  </span>
                  <span className="tabular-nums">{money(u.amountMinor, u.currency, true)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Your bills">
          {ds.bills.length === 0 ? <Empty title="No bills yet">Add one, or confirm a detected payment below.</Empty> : (
            <ul className="divide-y divide-stone-100 text-sm dark:divide-stone-800">
              {ds.bills.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-2 py-2">
                  <div>
                    <div className="font-medium">{b.name}</div>
                    <div className="text-xs text-stone-500">{CADENCE_LABEL[b.cadence]} · next {formatDate(nextDueOf(b, asOf))}{b.categoryId && ` · ${catName(b.categoryId)}`}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="tabular-nums">{money(b.amountMinor, b.currency, true)}</span>
                    <Button variant="ghost" onClick={() => setEditing(b)}>Edit</Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4">
            <div className="mb-2 text-xs font-medium text-stone-600 dark:text-stone-400">Add a common bill</div>
            <div className="flex flex-wrap gap-1">
              {BILL_TEMPLATES.filter((t) => !ds.bills.some((b) => b.template === t.id)).map((t) => (
                <Button key={t.id} variant="ghost" className="border border-dashed border-stone-300 text-xs dark:border-stone-700" title={t.note} onClick={() => setEditing({ ...blank(), name: t.name, template: t.id, cadence: t.cadence, categoryId: t.categoryId, currency: t.jurisdiction === "UK" ? "GBP" : "EUR" })}>
                  + {t.name} <span className="text-stone-400">{t.jurisdiction}</span>
                </Button>
              ))}
            </div>
          </div>
        </Card>
      </div>

      <Card title="Found in your transactions" className="mt-4">
        {detected.length === 0 ? <p className="text-sm text-stone-500">No repeating payments found yet. Detection needs three or more payments to the same payee on a steady rhythm.</p> : (
          <Table head={["Payee", "Rhythm", "Last paid", "Amount", "A year", ""]}>
            {detected.map((r) => <DetectedRow key={r.key} r={r} linked={linked.has(r.key)} onConfirm={() => setEditing({ ...blank(), name: r.payee, cadence: r.cadence, amountMinor: r.lastAmountMinor, currency: r.currency, nextDue: r.nextDate, categoryId: r.categoryId, payeeKey: r.key })} />)}
          </Table>
        )}
      </Card>

      <Modal open={!!editing} onClose={() => setEditing(null)} title="Bill">
        {editing && <BillForm bill={editing} onDone={() => setEditing(null)} />}
      </Modal>
      <Disclaimer />
    </div>
  );
}

function DetectedRow({ r, linked, onConfirm }: { r: RecurringSeries; linked: boolean; onConfirm: () => void }) {
  return (
    <tr className={r.status === "lapsed" ? "text-stone-400" : ""}>
      <td className="px-2 py-2">
        <div className="font-medium">{r.payee}</div>
        <div className="flex flex-wrap gap-1 text-xs">
          {r.priceChange && <Badge tone="bad">Up {Math.round(r.priceChange.rate * 1000) / 10}% from {money(r.priceChange.fromMinor, r.currency, true)}</Badge>}
          {!r.fixedPrice && <Badge>varies</Badge>}
          {r.status === "lapsed" && <Badge>stopped?</Badge>}
          {linked && <Badge tone="good">tracked</Badge>}
        </div>
      </td>
      <td className="px-2 py-2">{CADENCE_LABEL[r.cadence]} <span className="text-xs text-stone-500">· {r.occurrences}×</span></td>
      <td className="px-2 py-2 whitespace-nowrap">{formatDate(r.lastDate)}</td>
      <td className="px-2 py-2 text-right tabular-nums">{money(r.lastAmountMinor, r.currency, true)}</td>
      <td className="px-2 py-2 text-right tabular-nums">{money(r.annualCostMinor, r.currency)}</td>
      <td className="px-2 py-2">
        <div className="flex justify-end gap-1">
          {!linked && r.status === "active" && <Button variant="ghost" className="text-xs" onClick={onConfirm}>Track as bill</Button>}
          <Button variant="ghost" className="text-xs" onClick={() => update((d) => ({ ...d, recurringDismissed: [...d.recurringDismissed, r.key] }), "recurring.dismiss")}>Not a bill</Button>
        </div>
      </td>
    </tr>
  );
}

function BillForm({ bill, onDone }: { bill: Bill; onDone: () => void }) {
  const ds = useDataset();
  const [b, setB] = useState(bill);
  const exists = ds.bills.some((x) => x.id === b.id);
  const template = BILL_TEMPLATES.find((t) => t.id === b.template);
  return (
    <div className="space-y-3">
      {template?.note && <p className="rounded-lg bg-stone-50 p-2 text-xs text-stone-600 dark:bg-stone-800/60 dark:text-stone-400">{template.note}</p>}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name">{(id) => <Input id={id} value={b.name} onChange={(e) => setB({ ...b, name: e.target.value })} />}</Field>
        <Field label="How often">{(id) => <Select id={id} value={b.cadence} onChange={(e) => setB({ ...b, cadence: e.target.value as Bill["cadence"] })} options={billCadences.map((c) => ({ value: c, label: CADENCE_LABEL[c] }))} />}</Field>
        <Field label="Amount">{(id) => <MoneyInput id={id} value={b.amountMinor} onChange={(v) => setB({ ...b, amountMinor: v })} />}</Field>
        <Field label="Currency">{(id) => <Select id={id} value={b.currency} onChange={(e) => setB({ ...b, currency: e.target.value as "EUR" | "GBP" })} options={[{ value: "EUR", label: "EUR" }, { value: "GBP", label: "GBP" }]} />}</Field>
        <Field label="Next due">{(id) => <Input id={id} type="date" value={b.nextDue} onChange={(e) => setB({ ...b, nextDue: e.target.value })} />}</Field>
        <Field label="Category">{(id) => <Select id={id} value={b.categoryId ?? ""} onChange={(e) => setB({ ...b, categoryId: e.target.value || null })} options={[{ value: "", label: "None" }, ...ds.categories.filter((c) => c.kind === "expense").map((c) => ({ value: c.id, label: c.name }))]} />}</Field>
      </div>
      <div className="flex justify-between pt-2">
        {exists ? <Button variant="danger" onClick={() => { update((d) => ({ ...d, bills: d.bills.filter((x) => x.id !== b.id) }), "bill.delete"); onDone(); }}>Delete</Button> : <span />}
        <div className="flex gap-2">
          <Button onClick={onDone}>Cancel</Button>
          <Button variant="primary" disabled={!b.name.trim()} onClick={() => { update((d) => ({ ...d, bills: exists ? d.bills.map((x) => (x.id === b.id ? b : x)) : [...d.bills, b] }), "bill.save"); onDone(); }}>Save</Button>
        </div>
      </div>
    </div>
  );
}
