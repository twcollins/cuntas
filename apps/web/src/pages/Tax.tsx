import { useMemo, useState } from "react";
import { FxTable } from "@cuntas/ledger";
import {
  ageOn,
  applyRate,
  classify,
  deadlineFor,
  getPack,
  ieDeemedDisposals,
  iePayroll,
  listPacks,
  packOn,
  toMinor,
  ukIsaCheck,
  ukPayroll,
  type CrossBorderItem,
  type ExplainedLine,
  type IeAssessment,
  type PayFrequency,
} from "@cuntas/rules";
import { Badge, Button, Card, Disclaimer, Field, Input, MoneyInput, PageHeader, Select, Stat, Table, Why } from "../components/ui";
import { useAsOf } from "../lib/derived";
import { formatDate, money, moneyExact, pct } from "../lib/format";
import { useDataset } from "../lib/store";

export function TaxPage() {
  return (
    <div>
      <PageHeader title="Tax centre" subtitle="Calculators driven by versioned Irish and UK rule packs. Each figure links to the rule and source it came from." />
      <div className="space-y-4">
        <TakeHome />
        <div className="grid gap-4 lg:grid-cols-2">
          <Deadlines />
          <IsaChecker />
        </div>
        <DeemedDisposal />
        <CrossBorder />
      </div>
      <Disclaimer />
    </div>
  );
}

function TakeHome() {
  const ds = useDataset();
  const asOf = useAsOf();
  const [j, setJ] = useState<"IE" | "UK">("IE");
  const packs = listPacks(j);
  const [year, setYear] = useState(packOn("IE", asOf).taxYear);
  const first = ds.members[0];
  const [gross, setGross] = useState(first?.grossAnnualMinor || toMinor(50000));
  const [freq, setFreq] = useState<PayFrequency>("monthly");
  const [assessment, setAssessment] = useState<IeAssessment>("single");
  const [spouse, setSpouse] = useState(0);
  const [age, setAge] = useState(first ? ageOn(first.dateOfBirth, asOf) : 35);
  const [pensionPct, setPensionPct] = useState(0);
  const [mff, setMff] = useState(false);
  const [rent, setRent] = useState(0);
  const yearValid = packs.some((p) => p.taxYear === year) ? year : packs.at(-1)!.taxYear;

  const result = useMemo(() => {
    if (j === "IE") {
      const pack = getPack("IE", yearValid);
      const r = iePayroll(pack, { grossAnnualMinor: gross, frequency: freq, assessment, spouseGrossAnnualMinor: spouse, employment: "employee", age, pensionEmployeeMinor: applyRate(gross, pensionPct / 100), myFutureFund: mff, rentPaidMinor: rent });
      return { pack, net: r.netAnnualMinor, perPeriod: r.netPerPeriodMinor, periods: r.periods, marginal: r.marginalRate, lines: r.lines, notes: r.notes, rows: [["Income tax", r.incomeTaxMinor], ["USC", r.uscMinor], ["PRSI", r.prsiMinor], ["Pension", r.pensionEmployeeMinor], ["MyFutureFund", r.myFutureFund.employeeMinor]] as [string, number][] };
    }
    const pack = getPack("UK", yearValid);
    const r = ukPayroll(pack, { grossAnnualMinor: gross });
    return { pack, net: r.netAnnualMinor, perPeriod: r.netPerPeriodMinor, periods: 12, marginal: r.marginalRate, lines: r.lines, notes: r.notes, rows: [["Income tax", r.incomeTaxMinor], ["National Insurance", r.niMinor]] as [string, number][] };
  }, [j, yearValid, gross, freq, assessment, spouse, age, pensionPct, mff, rent]);
  const cur = j === "IE" ? "EUR" : "GBP";

  return (
    <Card title="Take-home pay" actions={<div className="flex gap-2"><Badge tone={result.pack.status === "verified" ? "good" : "warn"}>{result.pack.version} · {result.pack.status}</Badge></div>}>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Rules">{(id) => <Select id={id} value={j} onChange={(e) => { setJ(e.target.value as "IE" | "UK"); setYear(e.target.value === "IE" ? packOn("IE", asOf).taxYear : packOn("UK", asOf).taxYear); }} options={[{ value: "IE", label: "Ireland" }, { value: "UK", label: "UK (rUK)" }]} />}</Field>
            <Field label="Tax year">{(id) => <Select id={id} value={yearValid} onChange={(e) => setYear(e.target.value)} options={packs.map((p) => ({ value: p.taxYear, label: p.taxYear }))} />}</Field>
          </div>
          {ds.members.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {ds.members.map((m) => (
                <Button key={m.id} variant="ghost" className="text-xs" onClick={() => { setGross(m.grossAnnualMinor); setAge(ageOn(m.dateOfBirth, asOf)); setAssessment(m.assessment); const plan = ds.pensionPlans.find((p) => p.memberId === m.id && p.isEmployerScheme); setPensionPct((plan?.employeeRate ?? 0) * 100); }}>Use {m.name}</Button>
              ))}
            </div>
          )}
          <Field label="Gross annual pay">{(id) => <MoneyInput id={id} value={gross} onChange={setGross} />}</Field>
          {j === "IE" && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Paid">{(id) => <Select id={id} value={freq} onChange={(e) => setFreq(e.target.value as PayFrequency)} options={[{ value: "monthly", label: "Monthly" }, { value: "fortnightly", label: "Fortnightly" }, { value: "weekly", label: "Weekly" }]} />}</Field>
                <Field label="Age">{(id) => <Input id={id} type="number" value={age} onChange={(e) => setAge(Number(e.target.value))} />}</Field>
              </div>
              <Field label="Assessment">{(id) => <Select id={id} value={assessment} onChange={(e) => setAssessment(e.target.value as IeAssessment)} options={[{ value: "single", label: "Single" }, { value: "oneParent", label: "One-parent family" }, { value: "marriedOneIncome", label: "Married, one income" }, { value: "marriedTwoIncomes", label: "Married, two incomes" }]} />}</Field>
              {assessment === "marriedTwoIncomes" && <Field label="Spouse's gross pay">{(id) => <MoneyInput id={id} value={spouse} onChange={setSpouse} />}</Field>}
              <div className="grid grid-cols-2 gap-2">
                <Field label="Pension (% of pay)">{(id) => <Input id={id} type="number" step={0.5} min={0} value={pensionPct} onChange={(e) => setPensionPct(Number(e.target.value))} />}</Field>
                <Field label="Rent paid a year">{(id) => <MoneyInput id={id} value={rent} onChange={setRent} />}</Field>
              </div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={mff} onChange={(e) => setMff(e.target.checked)} />Enrolled in MyFutureFund</label>
            </>
          )}
        </div>
        <div className="lg:col-span-2">
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Take-home a year" value={moneyExact(result.net, cur)} tone="good" />
            <Stat label={`Per pay (${result.periods} a year)`} value={moneyExact(result.perPeriod, cur)} />
            <Stat label="Marginal income tax rate" value={pct(result.marginal)} />
          </div>
          <div className="mt-4">
            <Table head={["", "Amount"]}>
              <tr><td className="px-2 py-1.5">Gross pay</td><td className="px-2 py-1.5 text-right tabular-nums">{moneyExact(gross, cur)}</td></tr>
              {result.rows.filter(([, v]) => v !== 0).map(([k, v]) => (
                <tr key={k}><td className="px-2 py-1.5">{k}</td><td className="px-2 py-1.5 text-right tabular-nums text-rose-600">−{moneyExact(v, cur).replace("−", "")}</td></tr>
              ))}
              <tr className="font-semibold"><td className="px-2 py-1.5">Net pay</td><td className="px-2 py-1.5 text-right tabular-nums">{moneyExact(result.net, cur)}</td></tr>
            </Table>
          </div>
          <div className="mt-3">
            <Why sources={result.lines.flatMap((l: ExplainedLine) => (l.rule ? [l.rule] : []))}>
              <ul className="mb-2 space-y-0.5">
                {result.lines.map((l: ExplainedLine, i: number) => (
                  <li key={i} className="flex justify-between gap-4"><span>{l.label}</span><span className="tabular-nums">{moneyExact(l.amountMinor, cur)}</span></li>
                ))}
              </ul>
              {result.notes.map((n) => <p key={n} className="text-amber-700 dark:text-amber-300">{n}</p>)}
            </Why>
          </div>
        </div>
      </div>
    </Card>
  );
}

function Deadlines() {
  const asOf = useAsOf();
  const year = Number(asOf.slice(0, 4));
  const ie = packOn("IE", asOf);
  const uk = packOn("UK", asOf);
  const items = [
    { label: `Form 11 / ROS for ${year - 1} (and pension relief for ${year - 1})`, date: deadlineFor(year - 1, ie.deadlines.form11), j: "IE" },
    ...ie.cgt.payment.map((p) => ({ label: `CGT on ${p.disposalsThroughMonth === 12 ? "December" : "January to November"} ${ie.taxYear} disposals`, date: deadlineFor(Number(ie.taxYear), { monthDay: p.dueMonthDay, yearOffset: p.yearOffset }), j: "IE" })),
    { label: `Form 11 for ${year}`, date: deadlineFor(year, ie.deadlines.form11), j: "IE" },
    { label: `UK self assessment ${uk.taxYear}`, date: deadlineFor(Number(uk.taxYear.slice(0, 4)), uk.deadlines.selfAssessmentOnline), j: "UK" },
  ].sort((a, b) => a.date.localeCompare(b.date));
  return (
    <Card title="Tax deadlines">
      <ul className="space-y-2 text-sm">
        {items.map((i) => (
          <li key={i.label} className={`flex items-center justify-between gap-2 ${i.date < asOf ? "text-stone-400 line-through" : ""}`}>
            <span><Badge>{i.j}</Badge> {i.label}</span>
            <span className="whitespace-nowrap tabular-nums">{formatDate(i.date)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function IsaChecker() {
  const packs = listPacks("UK");
  const [year, setYear] = useState(packs.at(-1)!.taxYear);
  const [age, setAge] = useState(40);
  const [cash, setCash] = useState(0);
  const [stocks, setStocks] = useState(0);
  const [lisa, setLisa] = useState(0);
  const pack = getPack("UK", year);
  const r = ukIsaCheck(pack, { age, subscribed: { cash, stocksAndShares: stocks, lifetime: lisa, innovativeFinance: 0 } });
  return (
    <Card title="UK ISA allowance" actions={<Badge tone={pack.status === "verified" ? "good" : "warn"}>{pack.version}</Badge>}>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Tax year">{(id) => <Select id={id} value={year} onChange={(e) => setYear(e.target.value)} options={packs.map((p) => ({ value: p.taxYear, label: p.taxYear }))} />}</Field>
        <Field label="Age">{(id) => <Input id={id} type="number" value={age} onChange={(e) => setAge(Number(e.target.value))} />}</Field>
        <Field label="Cash ISA">{(id) => <MoneyInput id={id} value={cash} onChange={setCash} />}</Field>
        <Field label="Stocks and shares ISA">{(id) => <MoneyInput id={id} value={stocks} onChange={setStocks} />}</Field>
        <Field label="Lifetime ISA">{(id) => <MoneyInput id={id} value={lisa} onChange={setLisa} />}</Field>
      </div>
      <div className="mt-3 text-sm">
        {r.allowed ? <Badge tone="good">Within allowance · {money(r.totalRemainingMinor, "GBP")} left{r.cashRemainingMinor !== null && ` (cash: ${money(r.cashRemainingMinor, "GBP")})`}</Badge> : r.reasons.map((x) => <p key={x} className="text-rose-600">{x}</p>)}
      </div>
      <p className="mt-2 text-xs text-stone-500">For an Irish resident a UK ISA has no tax exemption: see the cross-border check below.</p>
    </Card>
  );
}

function DeemedDisposal() {
  const ds = useDataset();
  const asOf = useAsOf();
  const fx = new FxTable(ds.fxRates);
  const until = `${Number(asOf.slice(0, 4)) + 10}-12-31`;
  const rows = ds.holdings
    .filter((h) => h.taxClass === "exitTaxFund")
    .flatMap((h) => {
      const toEur = (minor: number) => (h.currency === "EUR" ? minor : (fx.tryConvert(minor, h.currency, "EUR", asOf) ?? 0));
      return ieDeemedDisposals({ lots: h.lots.map((l) => ({ id: l.id, date: l.date, units: l.units, costMinor: toEur(l.costMinor) })), unitPriceMinor: toEur(h.unitPriceMinor), from: asOf, until }).map((e) => ({ ...e, holding: h.name }));
    });
  return (
    <Card title="Deemed-disposal calendar">
      <p className="mb-3 text-sm text-stone-600 dark:text-stone-400">Irish exit tax treats fund and ETF holdings as sold every 8 years. Estimates use today's price, converted to euro.</p>
      {rows.length === 0 ? <p className="text-sm text-stone-500">No fund holdings recorded.</p> : (
        <Table head={["Holding", "Anniversary", "Estimated gain", "Estimated tax", "Pay by"]}>
          {rows.map((r) => (
            <tr key={`${r.lotId}:${r.date}`}>
              <td className="px-2 py-2">{r.holding}<div className="text-xs text-stone-500">lot {r.lotId} · {r.pack}</div></td>
              <td className="px-2 py-2">{formatDate(r.date)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{money(r.estimatedGainMinor, "EUR")}</td>
              <td className="px-2 py-2 text-right tabular-nums">{money(r.estimatedTaxMinor, "EUR")} <span className="text-xs text-stone-500">at {pct(r.rate)}</span></td>
              <td className="px-2 py-2">{formatDate(r.paymentDeadline)}</td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}

function CrossBorder() {
  const ds = useDataset();
  const asOf = useAsOf();
  const items: { label: string; member: string; item: CrossBorderItem }[] = [];
  for (const m of ds.members) {
    for (const p of ds.pensionPlans.filter((x) => x.memberId === m.id && x.jurisdiction === "UK")) items.push({ label: p.name, member: m.id, item: { kind: p.kind === "statePensionUK" ? "statePension" : "privatePension", sourceCountry: "UK" } });
    for (const a of ds.accounts.filter((x) => x.memberIds.includes(m.id) && !x.archived)) {
      if (a.wrapper === "ISA" || a.wrapper === "LISA") items.push({ label: a.name, member: m.id, item: { kind: "isa" } });
      else if ((a.type === "savings" || a.type === "current") && a.jurisdiction === "UK") items.push({ label: a.name, member: m.id, item: { kind: "deposit", accountCountry: "UK" } });
    }
  }
  return (
    <Card title="Cross-border check (IE-UK)">
      <p className="mb-3 text-sm text-stone-600 dark:text-stone-400">Treatment follows each member's declared residence, not the account's country. Cúntas never decides residence for you.</p>
      {items.length === 0 ? <p className="text-sm text-stone-500">No UK pensions, ISAs or accounts recorded.</p> : (
        <ul className="space-y-2">
          {items.map((x, i) => {
            const m = ds.members.find((y) => y.id === x.member)!;
            const res = ds.residencePeriods.find((r) => r.memberId === m.id && r.from <= asOf && (!r.to || r.to >= asOf))?.jurisdiction ?? "IE";
            const c = classify(x.item, { residence: res, nationality: m.nationality }, asOf.slice(0, 4));
            return (
              <li key={i} className="rounded-lg bg-stone-50 p-3 text-sm dark:bg-stone-800/50">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{x.label} <span className="font-normal text-stone-500">· {m.name}, resident in {res}</span></span>
                  <span className="flex gap-1">{c.taxedBy.map((t) => <Badge key={t} tone="info">Taxed in {t}</Badge>)}<Badge>{c.reference.ref}</Badge></span>
                </div>
                <ul className="mt-1 list-disc pl-5 text-stone-600 dark:text-stone-400">{c.notes.slice(1).map((n) => <li key={n}>{n}</li>)}</ul>
                <a className="text-xs underline" href={c.reference.source} target="_blank" rel="noreferrer">Source</a>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
