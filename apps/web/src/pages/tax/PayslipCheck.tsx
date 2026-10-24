import { useState } from "react";
import { newId, residenceOn, type Payslip } from "@cuntas/ledger";
import { ageOn, iePayslipCheck, packOn, ukPayslipCheck, type PayslipFinding } from "@cuntas/rules";
import { Badge, Button, Card, Field, Input, Modal, MoneyInput, Select, Why } from "../../components/ui";
import { useAsOf } from "../../lib/derived";
import { formatDate, moneyExact } from "../../lib/format";
import { update, useDataset } from "../../lib/store";

/** Differences below this are rounding, not errors. */
const TOLERANCE_MINOR = 100;

const TONE: Record<PayslipFinding["severity"], "good" | "info" | "warn" | "bad"> = { ok: "good", info: "info", warn: "warn", bad: "bad" };

function check(p: Payslip, ds: ReturnType<typeof useDataset>) {
  const m = ds.members.find((x) => x.id === p.memberId);
  if (p.jurisdiction === "IE") {
    const r = iePayslipCheck(packOn("IE", p.payDate), {
      frequency: p.frequency, payDate: p.payDate, grossPeriodMinor: p.grossMinor, incomeTaxMinor: p.incomeTaxMinor, uscMinor: p.uscMinor, prsiMinor: p.prsiMinor,
      assessment: m?.assessment ?? "single", age: m ? ageOn(m.dateOfBirth, p.payDate) : 40, pensionPeriodMinor: p.pensionMinor, toleranceMinor: TOLERANCE_MINOR,
    });
    return { pack: r.pack, findings: r.findings, notes: r.notes, rows: [["Income tax", p.incomeTaxMinor, r.expected.incomeTaxMinor], ["USC", p.uscMinor, r.expected.uscMinor], ["PRSI", p.prsiMinor, r.expected.prsiMinor]] as [string, number, number][] };
  }
  const r = ukPayslipCheck(packOn("UK", p.payDate), {
    taxCode: p.taxCode, frequency: p.frequency, grossPeriodMinor: p.grossMinor, incomeTaxMinor: p.incomeTaxMinor, niMinor: p.niMinor, studentLoanMinor: p.studentLoanMinor,
    region: m?.ukRegion ?? "rUK", studentLoans: m?.studentLoans ?? [], toleranceMinor: TOLERANCE_MINOR,
  });
  return { pack: r.pack, findings: r.findings, notes: r.notes, rows: [["Income tax", p.incomeTaxMinor, r.expected.incomeTaxMinor], ["National Insurance", p.niMinor, r.expected.niMinor], ["Student loan", p.studentLoanMinor, r.expected.studentLoanMinor]] as [string, number, number][], code: r.expected.taxCode };
}

export function PayslipCheckCard() {
  const ds = useDataset();
  const asOf = useAsOf();
  const [editing, setEditing] = useState<Payslip | null>(null);
  const blank = (): Payslip => {
    const m = ds.members[0];
    const j = m ? residenceOn(ds, m.id, asOf) : "IE";
    return { id: newId("ps"), memberId: m?.id ?? "", jurisdiction: j, payDate: asOf, frequency: m?.payFrequency ?? "monthly", currency: j === "UK" ? "GBP" : "EUR", grossMinor: m ? Math.round(m.grossAnnualMinor / 12) : 0, incomeTaxMinor: 0, uscMinor: 0, prsiMinor: 0, niMinor: 0, studentLoanMinor: 0, taxCode: "", pensionMinor: 0 };
  };
  return (
    <Card title="Payslip check" actions={<Button variant="primary" onClick={() => setEditing(blank())}>Check a payslip</Button>}>
      <p className="mb-3 text-sm text-stone-600 dark:text-stone-400">Enter the figures from a payslip to spot emergency tax, credits or bands not allocated to the job, a wrong USC band, or a tax code problem. Payslips stay on this device.</p>
      {ds.payslips.length === 0 ? <p className="text-sm text-stone-500">No payslips entered yet.</p> : (
        <div className="space-y-3">
          {[...ds.payslips].sort((a, b) => b.payDate.localeCompare(a.payDate)).map((p) => {
            const r = check(p, ds);
            const m = ds.members.find((x) => x.id === p.memberId);
            return (
              <div key={p.id} className="rounded-lg border border-stone-200 p-3 text-sm dark:border-stone-800">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{m?.name ?? "Member"} · {formatDate(p.payDate)} <span className="font-normal text-stone-500">· gross {moneyExact(p.grossMinor, p.currency)} {p.frequency}{p.taxCode && ` · code ${p.taxCode}`}</span></span>
                  <span className="flex gap-1"><Badge>{r.pack}</Badge><Button variant="ghost" className="text-xs" onClick={() => setEditing(p)}>Edit</Button></span>
                </div>
                <div className="mt-2 grid gap-3 md:grid-cols-2">
                  <table className="text-sm">
                    <thead><tr className="text-left text-xs text-stone-500"><th className="font-medium"></th><th className="text-right font-medium">Payslip</th><th className="text-right font-medium">Expected</th></tr></thead>
                    <tbody>
                      {r.rows.map(([label, actual, expected]) => (
                        <tr key={label}>
                          <td className="py-0.5">{label}</td>
                          <td className="py-0.5 text-right tabular-nums">{moneyExact(actual, p.currency)}</td>
                          <td className={`py-0.5 text-right tabular-nums ${Math.abs(actual - expected) > TOLERANCE_MINOR ? "font-semibold text-rose-600 dark:text-rose-400" : "text-stone-500"}`}>{moneyExact(expected, p.currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <ul className="space-y-1.5">
                    {r.findings.map((f) => (
                      <li key={f.code} className="flex items-start gap-2"><Badge tone={TONE[f.severity]}>{f.severity === "ok" ? "OK" : f.severity}</Badge><span>{f.message}</span></li>
                    ))}
                  </ul>
                </div>
                <div className="mt-2"><Why sources={r.findings.flatMap((f) => (f.rule ? [f.rule] : []))}>{r.notes.map((n) => <p key={n}>{n}</p>)}</Why></div>
              </div>
            );
          })}
        </div>
      )}
      <Modal open={!!editing} onClose={() => setEditing(null)} title="Payslip">
        {editing && <PayslipForm slip={editing} onDone={() => setEditing(null)} />}
      </Modal>
    </Card>
  );
}

function PayslipForm({ slip, onDone }: { slip: Payslip; onDone: () => void }) {
  const ds = useDataset();
  const [p, setP] = useState(slip);
  const exists = ds.payslips.some((x) => x.id === p.id);
  const ie = p.jurisdiction === "IE";
  const money = (key: keyof Payslip, label: string) => <Field label={label}>{(id) => <MoneyInput id={id} value={p[key] as number} onChange={(v) => setP({ ...p, [key]: v })} />}</Field>;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Member">{(id) => <Select id={id} value={p.memberId} onChange={(e) => setP({ ...p, memberId: e.target.value })} options={ds.members.map((m) => ({ value: m.id, label: m.name }))} />}</Field>
        <Field label="Country">{(id) => <Select id={id} value={p.jurisdiction} onChange={(e) => setP({ ...p, jurisdiction: e.target.value as "IE" | "UK", currency: e.target.value === "UK" ? "GBP" : "EUR" })} options={[{ value: "IE", label: "Ireland" }, { value: "UK", label: "UK" }]} />}</Field>
        <Field label="Pay date">{(id) => <Input id={id} type="date" value={p.payDate} onChange={(e) => setP({ ...p, payDate: e.target.value })} />}</Field>
        <Field label="Paid">{(id) => <Select id={id} value={p.frequency} onChange={(e) => setP({ ...p, frequency: e.target.value as Payslip["frequency"] })} options={[{ value: "monthly", label: "Monthly" }, { value: "fortnightly", label: "Fortnightly" }, { value: "weekly", label: "Weekly" }]} />}</Field>
        {money("grossMinor", "Gross pay this period")}
        {money("pensionMinor", "Pension deducted")}
        {money("incomeTaxMinor", ie ? "Income tax (PAYE)" : "Income tax")}
        {ie ? money("uscMinor", "USC") : money("niMinor", "National Insurance")}
        {ie ? money("prsiMinor", "PRSI") : money("studentLoanMinor", "Student loan")}
        {!ie && <Field label="Tax code">{(id) => <Input id={id} value={p.taxCode} placeholder="1257L" onChange={(e) => setP({ ...p, taxCode: e.target.value })} />}</Field>}
      </div>
      <div className="flex justify-between pt-2">
        {exists ? <Button variant="danger" onClick={() => { update((d) => ({ ...d, payslips: d.payslips.filter((x) => x.id !== p.id) }), "payslip.delete"); onDone(); }}>Delete</Button> : <span />}
        <div className="flex gap-2">
          <Button onClick={onDone}>Cancel</Button>
          <Button variant="primary" disabled={!p.memberId || p.grossMinor <= 0} onClick={() => { update((d) => ({ ...d, payslips: exists ? d.payslips.map((x) => (x.id === p.id ? p : x)) : [...d.payslips, p] }), "payslip.save"); onDone(); }}>Save and check</Button>
        </div>
      </div>
    </div>
  );
}
