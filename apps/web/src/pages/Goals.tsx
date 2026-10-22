import { useState } from "react";
import { fullFundTarget, starterFundTarget } from "@cuntas/engine";
import { goalProgress, newId, type Goal } from "@cuntas/ledger";
import { ieHelpToBuy, packOn, toMinor } from "@cuntas/rules";
import { Badge, Button, Card, Field, Input, Modal, MoneyInput, PageHeader, ProgressBar, Select, Stat, Why } from "../components/ui";
import { usePlan } from "../lib/derived";
import { formatDate, money } from "../lib/format";
import { update, useDataset } from "../lib/store";

const TYPES: { value: Goal["type"]; label: string }[] = [
  { value: "emergencyFund", label: "Emergency fund" },
  { value: "sinkingFund", label: "Required purchase (sinking fund)" },
  { value: "houseDeposit", label: "House deposit" },
  { value: "college", label: "Children's college fund" },
  { value: "other", label: "Other goal" },
];

export function GoalsPage() {
  const ds = useDataset();
  const { snapshot, asOf, pack } = usePlan(ds);
  const base = ds.household.baseCurrency;
  const [editing, setEditing] = useState<Goal | null>(null);
  const starter = starterFundTarget(snapshot);
  const full = fullFundTarget(snapshot);
  const [price, setPrice] = useState(toMinor(400000));
  const [taxPaid, setTaxPaid] = useState(toMinor(40000));
  const htb = ieHelpToBuy(packOn("IE", asOf), { priceMinor: price, taxPaidLookbackMinor: taxPaid });

  return (
    <div>
      <PageHeader title="Goals" subtitle="Emergency funds, required purchases and longer goals, with the monthly amount each one needs." actions={<Button variant="primary" onClick={() => setEditing({ id: newId("goal"), name: "", type: "sinkingFund", targetMinor: 0, currency: base, targetDate: null, linkedAccountIds: [], savedMinor: 0, monthlyContributionMinor: 0 })}>Add goal</Button>} />
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <Stat label="Cash savings" value={money(snapshot.liquidSavingsMinor, base)} hint="Accounts marked as emergency fund (or savings and cash)" />
        <Stat label="Starter fund target" value={money(starter, base)} hint={`Greater of ${money(snapshot.thresholds.starterFundFloorMinor, base)} or ${snapshot.thresholds.starterFundMonths} month's ${snapshot.thresholds.fundBasis === "netPay" ? "net pay" : "essential spending"}`} tone={snapshot.liquidSavingsMinor >= starter ? "good" : undefined} />
        <Stat label="Full fund target" value={money(full.targetMinor, base)} hint={`${full.months} months, after high-interest debt is cleared`} tone={snapshot.liquidSavingsMinor >= full.targetMinor ? "good" : undefined} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {ds.goals.map((g) => {
          const p = goalProgress(ds, g, asOf);
          return (
            <Card key={g.id} title={g.name} actions={<Button variant="ghost" onClick={() => setEditing(g)}>Edit</Button>}>
              <div className="mb-2 flex flex-wrap gap-2">
                <Badge>{TYPES.find((t) => t.value === g.type)?.label}</Badge>
                {g.targetDate && <Badge tone={p.onTrack ? "good" : "warn"}>{p.onTrack ? "On track" : "Behind"}</Badge>}
              </div>
              <ProgressBar value={p.savedMinor} max={g.targetMinor} tone={p.onTrack || !g.targetDate ? "brand" : "warn"} />
              <div className="mt-2 flex justify-between text-sm">
                <span className="tabular-nums">{money(p.savedMinor, g.currency)} of {money(g.targetMinor, g.currency)}</span>
                {g.targetDate && <span className="text-stone-500">by {formatDate(g.targetDate)}</span>}
              </div>
              {p.monthlyNeededMinor !== null && (
                <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">
                  Needs <strong>{money(p.monthlyNeededMinor, g.currency)}</strong> a month over {p.monthsLeft} months; you set aside {money(g.monthlyContributionMinor, g.currency)}.
                </p>
              )}
              {g.type === "college" && g.targetDate && (p.monthsLeft ?? 0) > pack.exitTax.deemedDisposalYears * 12 && <p className="mt-2 text-xs text-stone-500">More than {pack.exitTax.deemedDisposalYears} years away: deemed disposal would apply to fund investments held this long.</p>}
            </Card>
          );
        })}
      </div>
      <Card title="Help to Buy estimate" className="mt-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="New home price">{(id) => <MoneyInput id={id} value={price} onChange={setPrice} />}</Field>
          <Field label="Income tax and DIRT paid, last 4 years">{(id) => <MoneyInput id={id} value={taxPaid} onChange={setTaxPaid} />}</Field>
          <Stat label="Estimated relief" value={money(htb.reliefMinor, "EUR")} hint={`Limited by ${htb.limitedBy === "maxRelief" ? "the maximum" : htb.limitedBy === "priceRate" ? "the share of the price" : "tax paid"}`} />
        </div>
        <div className="mt-2"><Why sources={[htb.rule]} /></div>
      </Card>
      <Modal open={!!editing} onClose={() => setEditing(null)} title="Goal">
        {editing && <GoalForm goal={editing} onDone={() => setEditing(null)} />}
      </Modal>
    </div>
  );
}

function GoalForm({ goal, onDone }: { goal: Goal; onDone: () => void }) {
  const ds = useDataset();
  const [g, setG] = useState(goal);
  const exists = ds.goals.some((x) => x.id === g.id);
  const savingsAccounts = ds.accounts.filter((a) => !a.archived && ["savings", "current", "cash", "brokerage"].includes(a.type));
  return (
    <div className="space-y-3">
      <Field label="Name">{(id) => <Input id={id} value={g.name} onChange={(e) => setG({ ...g, name: e.target.value })} placeholder="e.g. Car for work" />}</Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type">{(id) => <Select id={id} value={g.type} onChange={(e) => setG({ ...g, type: e.target.value as Goal["type"] })} options={TYPES} />}</Field>
        <Field label="Target date">{(id) => <Input id={id} type="date" value={g.targetDate ?? ""} onChange={(e) => setG({ ...g, targetDate: e.target.value || null })} />}</Field>
        <Field label="Target amount">{(id) => <MoneyInput id={id} value={g.targetMinor} onChange={(v) => setG({ ...g, targetMinor: v })} />}</Field>
        <Field label="Monthly contribution">{(id) => <MoneyInput id={id} value={g.monthlyContributionMinor} onChange={(v) => setG({ ...g, monthlyContributionMinor: v })} />}</Field>
        <Field label="Saved so far" hint="Ignored when accounts are linked.">{(id) => <MoneyInput id={id} value={g.savedMinor} onChange={(v) => setG({ ...g, savedMinor: v })} />}</Field>
        <Field label="Currency">{(id) => <Select id={id} value={g.currency} onChange={(e) => setG({ ...g, currency: e.target.value as "EUR" | "GBP" })} options={[{ value: "EUR", label: "EUR" }, { value: "GBP", label: "GBP" }]} />}</Field>
      </div>
      <fieldset className="text-sm">
        <legend className="mb-1 text-xs font-medium text-stone-600">Linked accounts</legend>
        {savingsAccounts.map((a) => (
          <label key={a.id} className="mr-4 inline-flex items-center gap-1">
            <input type="checkbox" checked={g.linkedAccountIds.includes(a.id)} onChange={(e) => setG({ ...g, linkedAccountIds: e.target.checked ? [...g.linkedAccountIds, a.id] : g.linkedAccountIds.filter((x) => x !== a.id) })} />
            {a.name}
          </label>
        ))}
      </fieldset>
      <div className="flex justify-between pt-2">
        {exists ? <Button variant="danger" onClick={() => { update((d) => ({ ...d, goals: d.goals.filter((x) => x.id !== g.id) }), "goal.delete"); onDone(); }}>Delete</Button> : <span />}
        <div className="flex gap-2">
          <Button onClick={onDone}>Cancel</Button>
          <Button variant="primary" disabled={!g.name.trim()} onClick={() => { update((d) => ({ ...d, goals: exists ? d.goals.map((x) => (x.id === g.id ? g : x)) : [...d.goals, g] }), "goal.save"); onDone(); }}>Save</Button>
        </div>
      </div>
    </div>
  );
}
