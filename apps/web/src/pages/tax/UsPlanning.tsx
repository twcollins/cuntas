import { useMemo, useState } from "react";
import { residenceOn } from "@cuntas/ledger";
import { ageOn, applyRate, packOn, usEstimatedTax, usPayroll, usRetirementLimits } from "@cuntas/rules";
import { Badge, Card, Field, MoneyInput, Select, Stat, Table, Why } from "../../components/ui";
import { useAsOf } from "../../lib/derived";
import { formatDate, moneyExact } from "../../lib/format";
import { useDataset } from "../../lib/store";

/** For US members: this year's retirement and HSA limits, and quarterly estimated tax. Federal only. */
export function UsPlanningCard() {
  const ds = useDataset();
  const asOf = useAsOf();
  const usMembers = ds.members.filter((m) => residenceOn(ds, m.id, asOf) === "US");
  const [memberId, setMemberId] = useState(usMembers.find((m) => m.employmentType === "selfEmployed")?.id ?? usMembers[0]?.id ?? "");
  const [priorTax, setPriorTax] = useState<number>(0);
  const [priorAgi, setPriorAgi] = useState<number>(0);
  const [withholding, setWithholding] = useState<number>(0);
  const member = usMembers.find((m) => m.id === memberId);
  const pack = packOn("US", asOf);

  const figures = useMemo(() => {
    if (!member) return null;
    const plans = ds.pensionPlans.filter((p) => p.memberId === member.id && p.isEmployerScheme && p.jurisdiction === "US");
    const gross = member.employmentType === "notWorking" || member.employmentType === "retired" ? 0 : member.grossAnnualMinor;
    const age = ageOn(member.dateOfBirth, `${pack.taxYear}-12-31`);
    const r = usPayroll(pack, {
      grossAnnualMinor: gross,
      employment: member.employmentType === "selfEmployed" ? "selfEmployed" : "employee",
      age,
      filingStatus: member.usFilingStatus,
      pretax401kMinor: applyRate(gross, plans.reduce((a, p) => a + p.employeeRate, 0)),
    });
    const limits = usRetirementLimits(pack, {
      age,
      filingStatus: member.usFilingStatus,
      magiMinor: r.agiMinor,
      compensationMinor: gross,
      coveredByWorkplacePlan: plans.length > 0,
      hsaCoverage: member.usHsaCoverage === "none" ? null : member.usHsaCoverage,
    });
    const expected = r.incomeTaxMinor + r.selfEmploymentTaxMinor - r.refundableCreditMinor;
    const est = usEstimatedTax(pack, {
      expectedTaxMinor: expected,
      priorYearTaxMinor: priorTax > 0 ? priorTax : null,
      priorYearAgiMinor: priorAgi > 0 ? priorAgi : null,
      withholdingMinor: member.employmentType === "selfEmployed" ? withholding : r.incomeTaxMinor,
      filingStatus: member.usFilingStatus,
    });
    return { limits, est, expected };
  }, [ds, member, pack, priorTax, priorAgi, withholding]);

  if (usMembers.length === 0 || !member || !figures) return null;
  const { limits, est, expected } = figures;
  const usd = (minor: number) => moneyExact(minor, "USD");

  return (
    <Card title="US limits and estimated tax" actions={<Badge tone="warn">{pack.version} · federal only</Badge>}>
      {usMembers.length > 1 && (
        <div className="mb-3 max-w-xs">
          <Field label="For">{(id) => <Select id={id} value={memberId} onChange={(e) => setMemberId(e.target.value)} options={usMembers.map((m) => ({ value: m.id, label: m.name }))} />}</Field>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-medium">{pack.taxYear} contribution limits</h3>
          <Table head={["Account", "Limit"]}>
            <tr><td className="px-2 py-1.5">401(k) or similar, employee{limits.catchUpMinor > 0 ? " (with catch-up)" : ""}</td><td className="px-2 py-1.5 text-right tabular-nums">{usd(limits.employeeDeferralMinor)}</td></tr>
            <tr><td className="px-2 py-1.5">IRA, all IRAs together</td><td className="px-2 py-1.5 text-right tabular-nums">{usd(limits.iraMinor)}</td></tr>
            <tr><td className="px-2 py-1.5">Of which Roth IRA</td><td className="px-2 py-1.5 text-right tabular-nums">{usd(limits.rothIraMinor)}</td></tr>
            <tr><td className="px-2 py-1.5">Deductible traditional IRA</td><td className="px-2 py-1.5 text-right tabular-nums">{usd(limits.traditionalIraDeductibleMinor)}</td></tr>
            <tr><td className="px-2 py-1.5">HSA</td><td className="px-2 py-1.5 text-right tabular-nums">{limits.hsaMinor === null ? <span className="text-stone-500">No HSA-eligible plan</span> : usd(limits.hsaMinor)}</td></tr>
          </Table>
          {limits.notes.map((n) => <p key={n} className="mt-2 text-xs text-amber-700 dark:text-amber-300">{n}</p>)}
        </div>
        <div>
          <h3 className="mb-2 text-sm font-medium">Quarterly estimated tax</h3>
          <div className="mb-3 grid grid-cols-2 gap-2">
            <Field label="Last year's total tax">{(id) => <MoneyInput id={id} value={priorTax} onChange={setPriorTax} />}</Field>
            <Field label="Last year's AGI">{(id) => <MoneyInput id={id} value={priorAgi} onChange={setPriorAgi} />}</Field>
            {member.employmentType === "selfEmployed" && <Field label="Tax withheld elsewhere">{(id) => <MoneyInput id={id} value={withholding} onChange={setWithholding} />}</Field>}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Federal tax this year" value={usd(expected)} hint="Income tax and self-employment tax, after credits" />
            <Stat label="Each installment" value={est.required ? usd(est.perInstallmentMinor) : "None needed"} hint={est.required ? `Safe harbour: ${est.basis === "priorYear" ? "last year's tax" : "90% of this year's"}` : "Less than the minimum would be owed after withholding"} />
          </div>
          {est.required && (
            <ul className="mt-2 space-y-0.5 text-sm">
              {est.dueDates.map((d) => <li key={d} className={`flex justify-between ${d < asOf ? "text-stone-400 line-through" : ""}`}><span>Installment due</span><span className="tabular-nums">{formatDate(d)}</span></li>)}
            </ul>
          )}
          <div className="mt-2">
            <Why sources={[{ pack: pack.version, key: "estimatedTax", source: est.source }, { pack: pack.version, key: "retirement", source: pack.retirement.source }]}>
              {est.notes.map((n) => <p key={n}>{n}</p>)}
            </Why>
          </div>
        </div>
      </div>
    </Card>
  );
}
