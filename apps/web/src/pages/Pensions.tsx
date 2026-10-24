import { useState } from "react";
import { newId, pensionKinds, type PensionPlan } from "@cuntas/ledger";
import { applyRate, myFutureFundStatus, pensionReliefHeadroom, ageOn, toMinor } from "@cuntas/rules";
import { Badge, Button, Card, Disclaimer, Field, Input, Modal, MoneyInput, PageHeader, ProgressBar, Select, Why } from "../components/ui";
import { usePlan } from "../lib/derived";
import { AnnualAllowanceCard } from "./tax/AnnualAllowance";
import { formatDate, money, pct } from "../lib/format";
import { update, useDataset } from "../lib/store";

const KIND_LABELS: Record<PensionPlan["kind"], string> = {
  occupationalDC: "Occupational DC", occupationalDB: "Occupational DB", PRSA: "PRSA", AVC: "AVC", MyFutureFund: "MyFutureFund", ARF: "ARF",
  ukWorkplaceDC: "UK workplace DC", ukWorkplaceDB: "UK workplace DB", SIPP: "SIPP", statePensionIE: "State Pension (IE)", statePensionUK: "State Pension (UK)",
};

const MFF_LABEL = { "auto-enrolled": "Auto-enrolled", "opted-out": "Opted out", "in-qualifying-scheme": "In a qualifying scheme", "not-eligible-age": "Not eligible (age)", "not-eligible-earnings": "Not eligible (earnings)" } as const;

export function PensionsPage() {
  const ds = useDataset();
  const { snapshot, pack, asOf } = usePlan(ds);
  const [editing, setEditing] = useState<PensionPlan | null>(null);
  return (
    <div>
      <PageHeader title="Pensions" subtitle={`Tax relief limits from rule pack ${pack.version}. Relief for ${pack.taxYear} can be claimed until ${formatDate(`${Number(pack.taxYear) + pack.pension.reliefClaimDeadline.yearOffset}-${pack.pension.reliefClaimDeadline.monthDay}`)}.`} actions={ds.members[0] && <Button variant="primary" onClick={() => setEditing({ id: newId("pp"), memberId: ds.members[0]!.id, name: "", kind: "occupationalDC", jurisdiction: "IE", currency: "EUR", valueMinor: 0, employeeRate: 0, employerRate: 0, employerMatchRule: null, isEmployerScheme: false })}>Add pension</Button>} />
      <div className="grid gap-4 md:grid-cols-2">
        {snapshot.members.map((m) => {
          const member = ds.members.find((x) => x.id === m.id)!;
          const target = (m.age * snapshot.thresholds.retirementShareOfAge) / 100;
          const current = m.pension.employeeRate + m.pension.employerRate;
          const personal = ds.pensionPlans.filter((p) => p.memberId === m.id && p.kind !== "MyFutureFund").reduce((a, p) => a + p.employeeRate, 0);
          const h = pensionReliefHeadroom(pack, { age: m.age, earningsMinor: member.grossAnnualMinor, contributedMinor: applyRate(member.grossAnnualMinor, personal), marginalRate: m.marginalRate });
          const mff = myFutureFundStatus(pack, { age: ageOn(member.dateOfBirth, asOf), grossAnnualMinor: member.grossAnnualMinor, inQualifyingScheme: m.pension.hasEmployerScheme, optedOut: member.myFutureFundOptedOut });
          return (
            <Card key={m.id} title={m.name} actions={<Badge tone="info">Age {m.age}</Badge>}>
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-sm"><span>Half-your-age gauge</span><span className="tabular-nums">{pct(current)} of {pct(target)}</span></div>
                  <ProgressBar value={current} max={target} tone={current >= target ? "brand" : "warn"} />
                  <p className="mt-1 text-xs text-stone-500">Employee {pct(m.pension.employeeRate)} + employer {pct(m.pension.employerRate)} of pre-tax pay.</p>
                </div>
                {m.pension.fullMatchEmployeeRate > 0 && (
                  <div className="text-sm">{m.pension.employeeRate >= m.pension.fullMatchEmployeeRate ? <Badge tone="good">Full employer match captured</Badge> : <Badge tone="warn">Match available up to {pct(m.pension.fullMatchEmployeeRate)}: you pay {pct(m.pension.employeeRate)}</Badge>}</div>
                )}
                <div className="rounded-lg bg-stone-50 p-3 text-sm dark:bg-stone-800/50">
                  <div className="font-medium">Tax relief headroom {pack.taxYear}</div>
                  <p className="mt-1 text-stone-600 dark:text-stone-400">
                    Limit {pct(h.limitRate)} of earnings (capped at {money(toMinor(pack.pension.earningsCap), "EUR")}) = {money(h.limitMinor, "EUR")}. You contribute about {money(h.contributedMinor, "EUR")}, leaving <strong>{money(h.headroomMinor, "EUR")}</strong> unused, worth <strong>{money(h.taxBackMinor, "EUR")}</strong> at your {pct(m.marginalRate)} marginal rate.
                  </p>
                  <div className="mt-1"><Why sources={h.rules} /></div>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span>MyFutureFund</span>
                  <span className="flex items-center gap-2">
                    <Badge tone={mff === "auto-enrolled" || mff === "in-qualifying-scheme" ? "good" : mff === "opted-out" ? "warn" : "neutral"}>{MFF_LABEL[mff]}</Badge>
                    {(mff === "auto-enrolled" || mff === "opted-out") && (
                      <Button variant="ghost" className="text-xs" onClick={() => update((d) => ({ ...d, members: d.members.map((x) => (x.id === m.id ? { ...x, myFutureFundOptedOut: mff === "auto-enrolled" } : x)) }), "mff.toggle")}>
                        {mff === "auto-enrolled" ? "Record opt-out" : "Re-enrol"}
                      </Button>
                    )}
                  </span>
                </div>
                <ul className="divide-y divide-stone-100 text-sm dark:divide-stone-800">
                  {ds.pensionPlans.filter((p) => p.memberId === m.id).map((p) => (
                    <li key={p.id} className="flex items-center justify-between py-2">
                      <div><div className="font-medium">{p.name}</div><div className="text-xs text-stone-500">{KIND_LABELS[p.kind]} · {p.jurisdiction}{p.isEmployerScheme && " · current employer"}</div></div>
                      <div className="flex items-center gap-2"><span className="tabular-nums">{money(p.valueMinor, p.currency)}</span><Button variant="ghost" onClick={() => setEditing(p)}>Edit</Button></div>
                    </li>
                  ))}
                </ul>
                {ds.pensionPlans.some((p) => p.memberId === m.id && p.jurisdiction === "UK") && m.residence === "IE" && (
                  <p className="text-xs text-amber-700 dark:text-amber-300">UK private and workplace pensions paid to an Irish resident are taxable only in Ireland (DTA Art. 17). Claim relief at source from HMRC before drawing it.</p>
                )}
              </div>
            </Card>
          );
        })}
      </div>
      <div className="mt-4"><AnnualAllowanceCard /></div>
      <Modal open={!!editing} onClose={() => setEditing(null)} title="Pension">
        {editing && <PensionForm plan={editing} onDone={() => setEditing(null)} />}
      </Modal>
      <Disclaimer />
    </div>
  );
}

function PensionForm({ plan, onDone }: { plan: PensionPlan; onDone: () => void }) {
  const ds = useDataset();
  const [p, setP] = useState(plan);
  const exists = ds.pensionPlans.some((x) => x.id === p.id);
  return (
    <div className="space-y-3">
      <Field label="Name">{(id) => <Input id={id} value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} />}</Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Member">{(id) => <Select id={id} value={p.memberId} onChange={(e) => setP({ ...p, memberId: e.target.value })} options={ds.members.map((m) => ({ value: m.id, label: m.name }))} />}</Field>
        <Field label="Kind">{(id) => <Select id={id} value={p.kind} onChange={(e) => setP({ ...p, kind: e.target.value as PensionPlan["kind"], jurisdiction: e.target.value.startsWith("uk") || e.target.value === "SIPP" || e.target.value === "statePensionUK" ? "UK" : "IE", currency: e.target.value.startsWith("uk") || e.target.value === "SIPP" || e.target.value === "statePensionUK" ? "GBP" : "EUR" })} options={pensionKinds.map((k) => ({ value: k, label: KIND_LABELS[k] }))} />}</Field>
        <Field label="Current value">{(id) => <MoneyInput id={id} value={p.valueMinor} onChange={(v) => setP({ ...p, valueMinor: v })} />}</Field>
        <Field label="Currency">{(id) => <Select id={id} value={p.currency} onChange={(e) => setP({ ...p, currency: e.target.value as "EUR" | "GBP" })} options={[{ value: "EUR", label: "EUR" }, { value: "GBP", label: "GBP" }]} />}</Field>
        <Field label="You contribute (% of pay)">{(id) => <Input id={id} type="number" step={0.5} min={0} value={+(p.employeeRate * 100).toFixed(2)} onChange={(e) => setP({ ...p, employeeRate: Number(e.target.value) / 100 })} />}</Field>
        <Field label="Employer contributes (% of pay)">{(id) => <Input id={id} type="number" step={0.5} min={0} value={+(p.employerRate * 100).toFixed(2)} onChange={(e) => setP({ ...p, employerRate: Number(e.target.value) / 100 })} />}</Field>
        <Field label="Employer matches up to (% of pay)" hint="Leave 0 if there's no match.">{(id) => <Input id={id} type="number" step={0.5} min={0} value={+((p.employerMatchRule?.upToRate ?? 0) * 100).toFixed(2)} onChange={(e) => setP({ ...p, employerMatchRule: Number(e.target.value) > 0 ? { upToRate: Number(e.target.value) / 100, ratio: p.employerMatchRule?.ratio ?? 1 } : null })} />}</Field>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={p.isEmployerScheme} onChange={(e) => setP({ ...p, isEmployerScheme: e.target.checked })} />Current employer's scheme (a qualifying scheme for auto-enrolment)</label>
      <div className="flex justify-between pt-2">
        {exists ? <Button variant="danger" onClick={() => { update((d) => ({ ...d, pensionPlans: d.pensionPlans.filter((x) => x.id !== p.id) }), "pension.delete"); onDone(); }}>Delete</Button> : <span />}
        <div className="flex gap-2">
          <Button onClick={onDone}>Cancel</Button>
          <Button variant="primary" disabled={!p.name.trim()} onClick={() => { update((d) => ({ ...d, pensionPlans: exists ? d.pensionPlans.map((x) => (x.id === p.id ? p : x)) : [...d.pensionPlans, p] }), "pension.save"); onDone(); }}>Save</Button>
        </div>
      </div>
    </div>
  );
}
