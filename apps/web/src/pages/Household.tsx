import { useState } from "react";
import { memberPay, newId, newMember, type Member, type ResidencePeriod } from "@cuntas/ledger";
import { StudentLoanPicker } from "./tax/StudentLoanPicker";
import { Badge, Button, Card, Field, Input, Modal, MoneyInput, PageHeader, Select } from "../components/ui";
import { useAsOf } from "../lib/derived";
import { formatDate, money } from "../lib/format";
import { update, useDataset } from "../lib/store";

export function HouseholdPage() {
  const ds = useDataset();
  const asOf = useAsOf();
  const s = ds.household.settings;
  const [editing, setEditing] = useState<Member | null>(null);
  const setSettings = (patch: Partial<typeof s>) => update((d) => ({ ...d, household: { ...d.household, settings: { ...d.household.settings, ...patch } } }));
  return (
    <div>
      <PageHeader title="Household" subtitle="The people in this plan, their residence, and the settings the planner uses. To add another household or share this one, go to Households." actions={<Button variant="primary" onClick={() => setEditing(newMember({ id: newId("m"), name: "", dateOfBirth: "1990-01-01" }))}>Add person</Button>} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="People in this plan">
          {ds.members.length === 0 && <p className="text-sm text-stone-500">Add yourself to get take-home pay, pension and next-step figures.</p>}
          <ul className="divide-y divide-stone-100 dark:divide-stone-800">
            {ds.members.map((m) => {
              const pay = memberPay(ds, m, asOf);
              const periods = ds.residencePeriods.filter((r) => r.memberId === m.id).sort((a, b) => b.from.localeCompare(a.from));
              return (
                <li key={m.id} className="py-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium">{m.name}</div>
                      <div className="text-xs text-stone-500">Born {formatDate(m.dateOfBirth)} · {m.nationality.join(", ")} national · {m.employmentType}</div>
                    </div>
                    <Button variant="ghost" onClick={() => setEditing(m)}>Edit</Button>
                  </div>
                  {m.grossAnnualMinor > 0 && <div className="mt-1 text-sm">Gross {money(m.grossAnnualMinor, pay.currency)} → net {money(pay.netAnnualMinor, pay.currency)} a year <Badge>{pay.pack}</Badge></div>}
                  <div className="mt-1 flex flex-wrap gap-1 text-xs">
                    {periods.map((r) => <Badge key={r.id} tone="info">{r.jurisdiction} resident {formatDate(r.from)} – {r.to ? formatDate(r.to) : "now"}</Badge>)}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
        <Card title="Household settings">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name">{(id) => <Input id={id} value={ds.household.name} onChange={(e) => update((d) => ({ ...d, household: { ...d.household, name: e.target.value } }))} />}</Field>
            <Field label="Base currency">{(id) => <Select id={id} value={ds.household.baseCurrency} onChange={(e) => update((d) => ({ ...d, household: { ...d.household, baseCurrency: e.target.value as "EUR" | "GBP" } }))} options={[{ value: "EUR", label: "EUR" }, { value: "GBP", label: "GBP" }]} />}</Field>
            <Field label="Payday (day of month)" hint="Budget periods run from payday.">{(id) => <Input id={id} type="number" min={1} max={28} value={s.paydayDayOfMonth} onChange={(e) => setSettings({ paydayDayOfMonth: Math.min(28, Math.max(1, Number(e.target.value))) })} />}</Field>
            <Field label="Children">{(id) => <Input id={id} type="number" min={0} value={s.children} onChange={(e) => setSettings({ children: Math.max(0, Number(e.target.value)) })} />}</Field>
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={s.ownsHome} onChange={(e) => setSettings({ ownsHome: e.target.checked })} />We own our home</label>
          {!s.ownsHome && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Field label="Monthly rent">{(id) => <MoneyInput id={id} value={s.monthlyRentMinor} onChange={(v) => setSettings({ monthlyRentMinor: v })} />}</Field>
              <Field label="Expected mortgage payment" hint="For the mortgage-readiness test.">{(id) => <MoneyInput id={id} value={s.expectedMortgagePaymentMinor ?? 0} onChange={(v) => setSettings({ expectedMortgagePaymentMinor: v || null })} />}</Field>
            </div>
          )}
          <fieldset className="mt-4 text-sm">
            <legend className="mb-1 text-xs font-medium text-stone-600">Features awaiting legislation</legend>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={s.flags.includes("investmentAccount")} onChange={(e) => setSettings({ flags: e.target.checked ? [...s.flags, "investmentAccount"] : s.flags.filter((f) => f !== "investmentAccount") })} />
              Investment Account (from 1 July 2027, Finance Bill 2026)
            </label>
          </fieldset>
        </Card>
      </div>
      <Modal open={!!editing} onClose={() => setEditing(null)} title="Member">
        {editing && <MemberForm member={editing} onDone={() => setEditing(null)} />}
      </Modal>
    </div>
  );
}

function MemberForm({ member, onDone }: { member: Member; onDone: () => void }) {
  const ds = useDataset();
  const [m, setM] = useState(member);
  const exists = ds.members.some((x) => x.id === m.id);
  const [periods, setPeriods] = useState<ResidencePeriod[]>(ds.residencePeriods.filter((r) => r.memberId === m.id));
  if (!exists && periods.length === 0) periods.push({ id: newId("rp"), memberId: m.id, jurisdiction: "IE", from: m.dateOfBirth, to: null, declaredBy: "user" });
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name">{(id) => <Input id={id} value={m.name} onChange={(e) => setM({ ...m, name: e.target.value })} />}</Field>
        <Field label="Date of birth" hint="Age sets pension relief bands.">{(id) => <Input id={id} type="date" value={m.dateOfBirth} onChange={(e) => setM({ ...m, dateOfBirth: e.target.value })} />}</Field>
        <Field label="Employment">{(id) => <Select id={id} value={m.employmentType} onChange={(e) => setM({ ...m, employmentType: e.target.value as Member["employmentType"] })} options={[{ value: "employee", label: "Employee (PAYE)" }, { value: "selfEmployed", label: "Self-employed" }, { value: "notWorking", label: "Not working" }, { value: "retired", label: "Retired" }]} />}</Field>
        <Field label={m.employmentType === "selfEmployed" ? "Trading profit a year" : "Gross annual pay"}>{(id) => <MoneyInput id={id} value={m.grossAnnualMinor} onChange={(v) => setM({ ...m, grossAnnualMinor: v })} />}</Field>
        <Field label="Paid">{(id) => <Select id={id} value={m.payFrequency} onChange={(e) => setM({ ...m, payFrequency: e.target.value as Member["payFrequency"] })} options={[{ value: "monthly", label: "Monthly" }, { value: "fortnightly", label: "Fortnightly" }, { value: "weekly", label: "Weekly" }]} />}</Field>
        <Field label="Irish tax assessment">{(id) => <Select id={id} value={m.assessment} onChange={(e) => setM({ ...m, assessment: e.target.value as Member["assessment"] })} options={[{ value: "single", label: "Single" }, { value: "oneParent", label: "One-parent family" }, { value: "marriedOneIncome", label: "Married, one income" }, { value: "marriedTwoIncomes", label: "Married, two incomes" }]} />}</Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Retire at" hint="Blank: State Pension age.">{(id) => <Input id={id} type="number" min={40} max={80} value={m.retirementAge ?? ""} onChange={(e) => setM({ ...m, retirementAge: e.target.value === "" ? null : Number(e.target.value) })} />}</Field>
        <Field label="Irish PRSI years" hint="So far, for State Pension.">{(id) => <Input id={id} type="number" min={0} value={m.ieContributionYears ?? ""} onChange={(e) => setM({ ...m, ieContributionYears: e.target.value === "" ? null : Number(e.target.value) })} />}</Field>
        <Field label="UK NI years" hint="Qualifying years so far.">{(id) => <Input id={id} type="number" min={0} value={m.ukQualifyingYears ?? ""} onChange={(e) => setM({ ...m, ukQualifyingYears: e.target.value === "" ? null : Number(e.target.value) })} />}</Field>
      </div>
      <details className="rounded-lg border border-stone-200 p-3 text-sm dark:border-stone-800">
        <summary className="cursor-pointer text-xs font-medium text-stone-600 dark:text-stone-400">UK tax details (used while UK resident)</summary>
        <div className="mt-3 space-y-3">
          <Field label="Income tax">{(id) => <Select id={id} value={m.ukRegion} onChange={(e) => setM({ ...m, ukRegion: e.target.value as Member["ukRegion"] })} options={[{ value: "rUK", label: "England, Wales, Northern Ireland" }, { value: "scotland", label: "Scottish taxpayer" }]} />}</Field>
          <StudentLoanPicker value={m.studentLoans} onChange={(studentLoans) => setM({ ...m, studentLoans })} />
        </div>
      </details>
      <fieldset className="text-sm">
        <legend className="mb-1 text-xs font-medium text-stone-600 dark:text-stone-400">Nationality (matters for UK government pensions, DTA Art. 18)</legend>
        {(["IE", "UK"] as const).map((n) => (
          <label key={n} className="mr-4 inline-flex items-center gap-1"><input type="checkbox" checked={m.nationality.includes(n)} onChange={(e) => setM({ ...m, nationality: e.target.checked ? [...m.nationality, n] : m.nationality.filter((x) => x !== n) })} />{n === "IE" ? "Irish" : "British"}</label>
        ))}
      </fieldset>
      <div>
        <div className="mb-1 text-xs font-medium text-stone-600">Tax residence, as you declare it</div>
        {periods.map((r, i) => (
          <div key={r.id} className="mb-2 grid grid-cols-[1fr_1fr_1fr_auto] gap-2">
            <Select aria-label="Country" value={r.jurisdiction} onChange={(e) => setPeriods(periods.map((x, j) => (j === i ? { ...x, jurisdiction: e.target.value as "IE" | "UK" } : x)))} options={[{ value: "IE", label: "Ireland" }, { value: "UK", label: "UK" }]} />
            <Input aria-label="From" type="date" value={r.from} onChange={(e) => setPeriods(periods.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))} />
            <Input aria-label="To" type="date" value={r.to ?? ""} onChange={(e) => setPeriods(periods.map((x, j) => (j === i ? { ...x, to: e.target.value || null } : x)))} />
            <Button variant="ghost" aria-label="Remove period" onClick={() => setPeriods(periods.filter((_, j) => j !== i))}>✕</Button>
          </div>
        ))}
        <Button variant="ghost" className="text-xs" onClick={() => setPeriods([...periods, { id: newId("rp"), memberId: m.id, jurisdiction: "UK", from: new Date().toISOString().slice(0, 10), to: null, declaredBy: "user" }])}>+ Add residence period</Button>
        <p className="text-xs text-stone-500">Cúntas never decides residence: the 183-day and 280-day tests are for you (or your adviser) to apply.</p>
      </div>
      <div className="flex justify-between pt-2">
        {exists ? <Button variant="danger" onClick={() => { update((d) => ({ ...d, members: d.members.filter((x) => x.id !== m.id), residencePeriods: d.residencePeriods.filter((r) => r.memberId !== m.id) }), "member.delete"); onDone(); }}>Remove</Button> : <span />}
        <div className="flex gap-2">
          <Button onClick={onDone}>Cancel</Button>
          <Button variant="primary" disabled={!m.name.trim()} onClick={() => { update((d) => ({ ...d, members: exists ? d.members.map((x) => (x.id === m.id ? m : x)) : [...d.members, m], residencePeriods: [...d.residencePeriods.filter((r) => r.memberId !== m.id), ...periods] }), "member.save"); onDone(); }}>Save</Button>
        </div>
      </div>
    </div>
  );
}
