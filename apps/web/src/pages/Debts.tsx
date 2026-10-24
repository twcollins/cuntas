import { useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { chartDefaults, toMinor } from "@cuntas/rules";
import { comparePayoff, newId, type Debt } from "@cuntas/ledger";
import { Badge, Button, Card, Disclaimer, Empty, Field, Input, Modal, MoneyInput, PageHeader, Select, Stat, Table } from "../components/ui";
import { usePlan } from "../lib/derived";
import { formatDate, money, pct } from "../lib/format";
import { update, useDataset } from "../lib/store";
import { useChartColors } from "../lib/theme";

const KINDS: { value: Debt["kind"]; label: string }[] = [
  { value: "creditCard", label: "Credit card" }, { value: "loan", label: "Personal loan" }, { value: "creditUnion", label: "Credit union loan" },
  { value: "bnpl", label: "Buy now, pay later" }, { value: "pcp", label: "PCP car finance" }, { value: "overdraft", label: "Overdraft" },
  { value: "studentLoan", label: "Student loan" }, { value: "mortgage", label: "Mortgage" }, { value: "other", label: "Other" },
];

export function DebtsPage() {
  const colors = useChartColors();
  const ds = useDataset();
  const { snapshot, asOf } = usePlan(ds);
  const base = ds.household.baseCurrency;
  const t = snapshot.thresholds;
  const debts = snapshot.debts.filter((d) => d.kind !== "mortgage" && d.balanceMinor > 0);
  const minimums = debts.reduce((a, d) => a + d.minPaymentMinor, 0);
  const [budget, setBudget] = useState(minimums + toMinor(200));
  const [editing, setEditing] = useState<Debt | null>(null);
  const probe = toMinor(chartDefaults().debtPlanner.extraPaymentProbe);
  const cmp = useMemo(() => comparePayoff(debts, budget, asOf, probe), [debts, budget, asOf, probe]);
  const chart = useMemo(() => {
    const n = Math.max(cmp.avalanche.schedule.length, cmp.snowball.schedule.length);
    return Array.from({ length: n }, (_, i) => ({ month: i + 1, avalanche: (cmp.avalanche.schedule[i]?.balanceMinor ?? 0) / 100, snowball: (cmp.snowball.schedule[i]?.balanceMinor ?? 0) / 100 }));
  }, [cmp]);
  const tier = (apr: number) => (apr > t.highAprAbove ? <Badge tone="bad">High</Badge> : apr >= t.moderateAprFrom ? <Badge tone="warn">Moderate</Badge> : <Badge>Low</Badge>);

  return (
    <div>
      <PageHeader title="Debts" subtitle={`High interest is above ${pct(t.highAprAbove)}; moderate is ${pct(t.moderateAprFrom)} to ${pct(t.highAprAbove)}.`} actions={<Button variant="primary" onClick={() => setEditing({ id: newId("debt"), name: "", accountId: null, kind: "creditCard", balanceMinor: 0, currency: base, aprBps: 0, minPaymentMinor: 0, termEnd: null })}>Add debt</Button>} />
      <Card title="Debt register">
        {ds.debts.length === 0 ? <Empty title="No debts recorded" /> : (
          <Table head={["Debt", "Balance", "APR", "Minimum", "", ""]}>
            {ds.debts.map((d) => {
              const s = snapshot.debts.find((x) => x.id === d.id)!;
              return (
                <tr key={d.id}>
                  <td className="px-2 py-2"><div className="font-medium">{d.name}</div><div className="text-xs text-stone-500">{KINDS.find((k) => k.value === d.kind)?.label}{d.accountId && " · balance from linked account"}</div></td>
                  <td className="px-2 py-2 text-right tabular-nums">{money(s.balanceMinor, base)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{pct(s.apr)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{money(d.minPaymentMinor, d.currency)}</td>
                  <td className="px-2 py-2">{tier(s.apr)}</td>
                  <td className="px-2 py-2 text-right"><Button variant="ghost" onClick={() => setEditing(d)}>Edit</Button></td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>

      {debts.length > 0 && (
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <Card title="Payoff planner">
            <Field label="Monthly amount for debts" hint={`Minimum payments total ${money(minimums, base)}.`}>{(id) => <MoneyInput id={id} value={budget} onChange={setBudget} />}</Field>
            <div className="mt-4 space-y-3">
              <Stat label="Avalanche (highest APR first)" value={cmp.avalanche.feasible ? formatDate(cmp.avalanche.schedule.at(-1)!.date) : "Never"} hint={`${cmp.avalanche.months} months · interest ${money(cmp.avalanche.totalInterestMinor, base)}`} tone="good" />
              <Stat label="Snowball (smallest balance first)" value={cmp.snowball.feasible ? formatDate(cmp.snowball.schedule.at(-1)!.date) : "Never"} hint={`${cmp.snowball.months} months · interest ${money(cmp.snowball.totalInterestMinor, base)}`} />
              <p className="text-sm">Every extra <strong>{money(probe, base)}</strong> a month saves <strong>{money(cmp.interestSavedByExtraMinor, base)}</strong> in interest{cmp.monthsSavedByExtra > 0 && <> and {cmp.monthsSavedByExtra} months</>}.</p>
              {cmp.avalanche.warning && <p className="text-sm text-rose-600">{cmp.avalanche.warning}</p>}
            </div>
          </Card>
          <Card title="Balance over time" className="lg:col-span-2">
            <div className="h-64">
              <ResponsiveContainer>
                <LineChart data={chart}>
                  <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: colors.axis }} stroke={colors.grid} label={{ value: "Months", position: "insideBottom", offset: -2, fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11, fill: colors.axis }} stroke={colors.grid} width={60} />
                  <Tooltip contentStyle={{ background: colors.tooltipBg, border: `1px solid ${colors.tooltipBorder}`, borderRadius: 8 }} formatter={(v: number) => money(Math.round(v * 100), base)} />
                  <Legend />
                  <Line type="monotone" dataKey="avalanche" stroke={colors.primary} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="snowball" stroke={colors.secondary} strokeWidth={2} dot={false} strokeDasharray="4 3" />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 text-sm text-stone-600 dark:text-stone-400">Avalanche order: {cmp.avalanche.order.map((id) => debts.find((d) => d.id === id)?.name).join(" → ")}</div>
          </Card>
        </div>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title="Debt">
        {editing && <DebtForm debt={editing} onDone={() => setEditing(null)} />}
      </Modal>
      <Disclaimer />
    </div>
  );
}

function DebtForm({ debt, onDone }: { debt: Debt; onDone: () => void }) {
  const ds = useDataset();
  const [d, setD] = useState(debt);
  const exists = ds.debts.some((x) => x.id === d.id);
  const liabilityAccounts = ds.accounts.filter((a) => ["creditCard", "loan", "mortgage"].includes(a.type));
  return (
    <div className="space-y-3">
      <Field label="Name">{(id) => <Input id={id} value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />}</Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Kind">{(id) => <Select id={id} value={d.kind} onChange={(e) => setD({ ...d, kind: e.target.value as Debt["kind"] })} options={KINDS} />}</Field>
        <Field label="APR (%)">{(id) => <Input id={id} type="number" step={0.1} min={0} value={d.aprBps / 100} onChange={(e) => setD({ ...d, aprBps: Math.round(Number(e.target.value) * 100) })} />}</Field>
        <Field label="Balance">{(id) => <MoneyInput id={id} value={d.balanceMinor} onChange={(v) => setD({ ...d, balanceMinor: v })} />}</Field>
        <Field label="Minimum monthly payment">{(id) => <MoneyInput id={id} value={d.minPaymentMinor} onChange={(v) => setD({ ...d, minPaymentMinor: v })} />}</Field>
        <Field label="Currency">{(id) => <Select id={id} value={d.currency} onChange={(e) => setD({ ...d, currency: e.target.value as "EUR" | "GBP" })} options={[{ value: "EUR", label: "EUR" }, { value: "GBP", label: "GBP" }]} />}</Field>
        <Field label="Linked account" hint="Balance follows the account.">{(id) => <Select id={id} value={d.accountId ?? ""} onChange={(e) => setD({ ...d, accountId: e.target.value || null })} options={[{ value: "", label: "None" }, ...liabilityAccounts.map((a) => ({ value: a.id, label: a.name }))]} />}</Field>
      </div>
      <div className="flex justify-between pt-2">
        {exists ? <Button variant="danger" onClick={() => { update((x) => ({ ...x, debts: x.debts.filter((y) => y.id !== d.id) }), "debt.delete"); onDone(); }}>Delete</Button> : <span />}
        <div className="flex gap-2">
          <Button onClick={onDone}>Cancel</Button>
          <Button variant="primary" disabled={!d.name.trim()} onClick={() => { update((x) => ({ ...x, debts: exists ? x.debts.map((y) => (y.id === d.id ? d : y)) : [...x.debts, d] }), "debt.save"); onDone(); }}>Save</Button>
        </div>
      </div>
    </div>
  );
}
