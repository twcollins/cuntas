import { useMemo, useState } from "react";
import { ageOn, getPack, ieSelfAssessment, listPacks, packOn, toMinor, type IeAssessment } from "@cuntas/rules";
import { Badge, Button, Card, Field, MoneyInput, Select, Stat, Table, Why } from "../../components/ui";
import { useAsOf } from "../../lib/derived";
import { formatDate, moneyExact, pct } from "../../lib/format";
import { update, useDataset } from "../../lib/store";

/** Form 11 estimate for self-employed members: liability, balance, preliminary tax and a monthly set-aside. */
export function SelfAssessmentCard() {
  const ds = useDataset();
  const asOf = useAsOf();
  const packs = listPacks("IE").filter((p) => p.selfAssessment);
  const selfEmployed = ds.members.filter((m) => m.employmentType === "selfEmployed");
  const first = selfEmployed[0] ?? ds.members[0];
  const [memberId, setMemberId] = useState(first?.id ?? "");
  const member = ds.members.find((m) => m.id === memberId);
  const [year, setYear] = useState(packOn("IE", asOf).taxYear);
  const [profit, setProfit] = useState(member?.employmentType === "selfEmployed" ? member.grossAnnualMinor : toMinor(60000));
  const [assessment, setAssessment] = useState<IeAssessment>(member?.assessment ?? "single");
  const [pension, setPension] = useState(0);
  const sa = member?.selfAssessment;
  const [paye, setPaye] = useState(sa?.payeIncomeMinor ?? 0);
  const [payeDeducted, setPayeDeducted] = useState(sa?.payeDeductedMinor ?? 0);
  const [prior, setPrior] = useState<number>(sa?.priorYearLiabilityMinor ?? 0);
  const [prePreceding, setPrePreceding] = useState<number>(sa?.prePrecedingYearLiabilityMinor ?? 0);
  const [paid, setPaid] = useState(sa?.preliminaryPaidMinor ?? 0);
  const yearValid = packs.some((p) => p.taxYear === year) ? year : packs.at(-1)!.taxYear;
  const pack = getPack("IE", yearValid);
  const age = member ? ageOn(member.dateOfBirth, `${yearValid}-12-31`) : 40;

  const r = useMemo(
    () => ieSelfAssessment(pack, {
      tradingProfitMinor: profit, payeIncomeMinor: paye, payeDeductedMinor: payeDeducted, assessment, age, pensionContributionMinor: pension,
      ...(prior > 0 ? { priorYearLiabilityMinor: prior } : {}), ...(prePreceding > 0 ? { prePrecedingYearLiabilityMinor: prePreceding } : {}), preliminaryPaidMinor: paid,
    }),
    [pack, profit, paye, payeDeducted, assessment, age, pension, prior, prePreceding, paid],
  );

  const pick = (id: string) => {
    const m = ds.members.find((x) => x.id === id);
    setMemberId(id);
    if (!m) return;
    if (m.employmentType === "selfEmployed") setProfit(m.grossAnnualMinor);
    setAssessment(m.assessment);
    setPaye(m.selfAssessment.payeIncomeMinor);
    setPayeDeducted(m.selfAssessment.payeDeductedMinor);
    setPrior(m.selfAssessment.priorYearLiabilityMinor ?? 0);
    setPrePreceding(m.selfAssessment.prePrecedingYearLiabilityMinor ?? 0);
    setPaid(m.selfAssessment.preliminaryPaidMinor);
  };

  return (
    <Card title="Self-employed: Form 11 and preliminary tax" actions={<Badge tone={r.packStatus === "verified" ? "good" : "warn"}>{r.pack} · {r.packStatus}</Badge>}>
      {selfEmployed.length === 0 && <p className="mb-3 text-xs text-stone-500">No one in the household is marked self-employed; figures below use the inputs as an example.</p>}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {ds.members.length > 0 && <Field label="Member">{(id) => <Select id={id} value={memberId} onChange={(e) => pick(e.target.value)} options={ds.members.map((m) => ({ value: m.id, label: m.name }))} />}</Field>}
            <Field label="Tax year">{(id) => <Select id={id} value={yearValid} onChange={(e) => setYear(e.target.value)} options={packs.map((p) => ({ value: p.taxYear, label: p.taxYear }))} />}</Field>
          </div>
          <Field label="Trading profit" hint="After expenses and capital allowances.">{(id) => <MoneyInput id={id} value={profit} onChange={setProfit} />}</Field>
          <Field label="Assessment">{(id) => <Select id={id} value={assessment} onChange={(e) => setAssessment(e.target.value as IeAssessment)} options={[{ value: "single", label: "Single" }, { value: "oneParent", label: "One-parent family" }, { value: "marriedOneIncome", label: "Married, one income" }]} />}</Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="PAYE income too">{(id) => <MoneyInput id={id} value={paye} onChange={setPaye} />}</Field>
            <Field label="Tax taken via PAYE">{(id) => <MoneyInput id={id} value={payeDeducted} onChange={setPayeDeducted} />}</Field>
            <Field label="Pension contributions">{(id) => <MoneyInput id={id} value={pension} onChange={setPension} />}</Field>
            <Field label="Preliminary tax paid">{(id) => <MoneyInput id={id} value={paid} onChange={setPaid} />}</Field>
            <Field label="Last year's liability" hint="Leave 0 if unknown.">{(id) => <MoneyInput id={id} value={prior} onChange={setPrior} />}</Field>
            <Field label="Liability 2 years ago">{(id) => <MoneyInput id={id} value={prePreceding} onChange={setPrePreceding} />}</Field>
          </div>
          {member && (
            <Button variant="ghost" className="text-xs" onClick={() => update((d) => ({ ...d, members: d.members.map((m) => (m.id === member.id ? { ...m, selfAssessment: { payeIncomeMinor: paye, payeDeductedMinor: payeDeducted, priorYearLiabilityMinor: prior || null, prePrecedingYearLiabilityMinor: prePreceding || null, preliminaryPaidMinor: paid } } : m)) }), "selfAssessment.save")}>
              Save these figures for {member.name}
            </Button>
          )}
        </div>
        <div className="space-y-4 lg:col-span-2">
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label={`Liability ${r.taxYear}`} value={moneyExact(r.netLiabilityMinor, "EUR")} hint={`Income tax, USC and PRSI${payeDeducted ? ", less PAYE" : ""}`} />
            <Stat label="Set aside each month" value={moneyExact(r.setAsideMonthlyMinor, "EUR")} hint={`${pct(r.setAsideRate)} of profit`} tone="good" />
            <Stat label="Balance with Form 11" value={moneyExact(r.balanceDueMinor, "EUR")} tone={r.balanceDueMinor > 0 ? "bad" : "good"} hint={r.balanceDueMinor < 0 ? "Overpaid: refund or credit" : `Due ${formatDate(r.deadlines[1]!.date)}`} />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <div className="mb-1 text-sm font-medium">Preliminary tax for {r.taxYear}</div>
              <ul className="space-y-1 text-sm">
                {r.preliminaryThisYear.options.map((o) => (
                  <li key={o.basis} className={`flex justify-between gap-2 ${o.amountMinor === r.preliminaryThisYear.requiredMinor ? "font-medium" : "text-stone-500"}`}><span>{o.label}</span><span className="tabular-nums">{moneyExact(o.amountMinor, "EUR")}</span></li>
                ))}
              </ul>
              {r.preliminaryThisYear.shortfallMinor > 0 ? <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">Short by {moneyExact(r.preliminaryThisYear.shortfallMinor, "EUR")}: interest may apply.</p> : <p className="mt-1 text-xs text-brand-700 dark:text-brand-500">Paid enough to avoid interest.</p>}
            </div>
            <div>
              <div className="mb-1 text-sm font-medium">Preliminary tax for {Number(r.taxYear) + 1}</div>
              <ul className="space-y-1 text-sm">
                {r.preliminaryNextYear.options.map((o) => (
                  <li key={o.basis} className={`flex justify-between gap-2 ${o.amountMinor === r.preliminaryNextYear.minimumMinor ? "font-medium" : "text-stone-500"}`}><span>{o.label}</span><span className="tabular-nums">{moneyExact(o.amountMinor, "EUR")}</span></li>
                ))}
              </ul>
              <p className="mt-1 text-xs text-stone-500">The lowest of these is enough. Bold is the lowest.</p>
            </div>
          </div>
          <Table head={["", "Amount"]}>
            <tr><td className="px-2 py-1.5">Income tax</td><td className="px-2 py-1.5 text-right tabular-nums">{moneyExact(r.incomeTaxMinor, "EUR")}</td></tr>
            <tr><td className="px-2 py-1.5">USC{profit > 0 && " (including any self-employed surcharge)"}</td><td className="px-2 py-1.5 text-right tabular-nums">{moneyExact(r.uscMinor, "EUR")}</td></tr>
            <tr><td className="px-2 py-1.5">PRSI (Class S{paye ? " and A1" : ""})</td><td className="px-2 py-1.5 text-right tabular-nums">{moneyExact(r.prsiMinor, "EUR")}</td></tr>
          </Table>
          <ul className="text-sm">
            {r.deadlines.map((d) => <li key={d.label} className="flex justify-between gap-2"><span>{d.label}</span><span className="whitespace-nowrap tabular-nums">{formatDate(d.date)}</span></li>)}
          </ul>
          <Why sources={r.lines.flatMap((l) => (l.rule ? [l.rule] : [])).concat(r.preliminaryThisYear.options.map((o) => o.rule))}>
            {r.notes.map((n) => <p key={n} className="text-amber-700 dark:text-amber-300">{n}</p>)}
          </Why>
        </div>
      </div>
    </Card>
  );
}
