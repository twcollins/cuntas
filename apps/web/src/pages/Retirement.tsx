import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { retirementPlan } from "@cuntas/ledger";
import { chartDefaults } from "@cuntas/rules";
import { Badge, Card, Disclaimer, Empty, Field, Input, PageHeader, Stat, Why } from "../components/ui";
import { useAsOf } from "../lib/derived";
import { money, pct } from "../lib/format";
import { update, useDataset } from "../lib/store";
import { useChartColors } from "../lib/theme";

const pctInput = (v: number) => +(v * 100).toFixed(2);

export function RetirementPage() {
  const ds = useDataset();
  const asOf = useAsOf();
  const pj = chartDefaults().projections;
  const [nominal, setNominal] = useState(pj.nominalReturn);
  const [inflation, setInflation] = useState(pj.inflation);
  const [withdrawal, setWithdrawal] = useState(pj.withdrawalRate);
  const [scenario, setScenario] = useState("central");
  const colors = useChartColors();
  const plan = useMemo(() => retirementPlan(ds, asOf, { nominalReturn: nominal, inflation, withdrawalRate: withdrawal }), [ds, asOf, nominal, inflation, withdrawal]);
  const cur = plan.currency;
  const chosen = plan.projections.find((p) => p.scenario.id === scenario) ?? plan.projections[1];
  const youngest = Math.min(...plan.members.map((m) => m.age));

  if (ds.members.length === 0) return <div><PageHeader title="Retirement" /><Empty title="Add yourself first">Ages, pay and pensions drive the projection. <Link to="/household" className="font-medium text-brand-700 underline dark:text-brand-500">Add people on the Household page</Link></Empty></div>;

  return (
    <div>
      <PageHeader title="Retirement projection" subtitle="Pots grown to each person's retirement age and turned into income, alongside Irish and UK State Pensions. All figures are in today's money." />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Assumptions">
          <div className="grid grid-cols-3 gap-2">
            <Field label="Return a year (%)">{(id) => <Input id={id} type="number" step={0.5} value={pctInput(nominal)} onChange={(e) => setNominal(Number(e.target.value) / 100)} />}</Field>
            <Field label="Inflation (%)">{(id) => <Input id={id} type="number" step={0.5} value={pctInput(inflation)} onChange={(e) => setInflation(Number(e.target.value) / 100)} />}</Field>
            <Field label="Withdrawal (%)">{(id) => <Input id={id} type="number" step={0.5} value={pctInput(withdrawal)} onChange={(e) => setWithdrawal(Number(e.target.value) / 100)} />}</Field>
          </div>
          <p className="mt-2 text-xs text-stone-500">Real return {pct(plan.assumptions.real)} a year. Scenarios add and subtract {pct(pj.scenarioSpread)}. Fees and tax on pension income are not deducted.</p>
          <div className="mt-4 space-y-3">
            {ds.members.map((m) => {
              const pm = plan.members.find((x) => x.id === m.id)!;
              return (
                <div key={m.id} className="rounded-lg bg-stone-50 p-3 text-sm dark:bg-stone-800/50">
                  <div className="flex items-center justify-between"><span className="font-medium">{m.name}</span><Badge>age {pm.age}</Badge></div>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <Field label="Retire at">{(id) => <Input id={id} type="number" min={40} max={80} value={pm.retirementAge} onChange={(e) => { const v = Number(e.target.value); if (v >= 40 && v <= 80) update((d) => ({ ...d, members: d.members.map((x) => (x.id === m.id ? { ...x, retirementAge: v } : x)) })); }} />}</Field>
                    <Field label="IE PRSI years">{(id) => <Input id={id} type="number" min={0} value={m.ieContributionYears ?? ""} placeholder="?" onChange={(e) => update((d) => ({ ...d, members: d.members.map((x) => (x.id === m.id ? { ...x, ieContributionYears: e.target.value === "" ? null : Math.max(0, Number(e.target.value)) } : x)) }))} />}</Field>
                    <Field label="UK NI years">{(id) => <Input id={id} type="number" min={0} value={m.ukQualifyingYears ?? ""} placeholder="0" onChange={(e) => update((d) => ({ ...d, members: d.members.map((x) => (x.id === m.id ? { ...x, ukQualifyingYears: e.target.value === "" ? null : Math.max(0, Number(e.target.value)) } : x)) }))} />}</Field>
                  </div>
                  <div className="mt-2 text-xs text-stone-500">
                    Pots {money(pm.potMinor, cur)} · adding {money(pm.annualContributionMinor, cur)} a year
                    {pm.statePensions.map((s) => <span key={s.jurisdiction}> · {s.jurisdiction} State Pension {money(s.annualMinor, cur)} from {s.startAge}</span>)}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <div className="space-y-4 lg:col-span-2">
          <div className="grid gap-3 sm:grid-cols-3">
            {plan.projections.map((p) => (
              <button key={p.scenario.id} type="button" onClick={() => setScenario(p.scenario.id)} className="text-left" aria-pressed={scenario === p.scenario.id}>
                <Stat label={`${p.scenario.label} (${pct(p.scenario.realReturn)} real)`} value={money(p.householdAnnualMinor, cur)} hint="Household income a year once every pension has started" tone={scenario === p.scenario.id ? "good" : undefined} />
              </button>
            ))}
          </div>
          {chosen && (
            <Card title={`Household pots and income: ${chosen.scenario.label.toLowerCase()}`}>
              <div className="h-72">
                <ResponsiveContainer>
                  <ComposedChart data={chosen.series.map((s) => ({ age: youngest + s.year, pot: s.potMinor / 100, income: s.incomeMinor / 100 }))} margin={{ left: 8, right: 8, bottom: 12 }}>
                    <defs><linearGradient id="pot" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={colors.primaryFill} stopOpacity={0.3} /><stop offset="100%" stopColor={colors.primaryFill} stopOpacity={0} /></linearGradient></defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} vertical={false} />
                    <XAxis dataKey="age" tick={{ fontSize: 12, fill: colors.axis }} stroke={colors.grid} label={{ value: plan.members.length > 1 ? "Age of youngest" : "Age", position: "insideBottom", offset: -2, fontSize: 11, fill: colors.axis }} />
                    <YAxis yAxisId="pot" tick={{ fontSize: 12, fill: colors.axis }} stroke={colors.grid} tickFormatter={(v: number) => money(v * 100, cur)} width={80} />
                    <YAxis yAxisId="income" orientation="right" tick={{ fontSize: 12, fill: colors.axis }} stroke={colors.grid} tickFormatter={(v: number) => money(v * 100, cur)} width={70} />
                    <Tooltip contentStyle={{ background: colors.tooltipBg, border: `1px solid ${colors.tooltipBorder}`, borderRadius: 8 }} formatter={(v: number, name: string) => [money(v * 100, cur), name === "pot" ? "Pots" : "Income a year"]} labelFormatter={(a) => `Age ${a}`} />
                    <Area yAxisId="pot" type="monotone" dataKey="pot" stroke={colors.primary} fill="url(#pot)" strokeWidth={2} isAnimationActive={false} />
                    <Line yAxisId="income" type="stepAfter" dataKey="income" stroke={colors.secondary} strokeWidth={2} dot={false} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {chosen.members.map((pm) => {
                  const m = plan.members.find((x) => x.id === pm.id)!;
                  return (
                    <div key={pm.id} className="rounded-lg border border-stone-200 p-3 text-sm dark:border-stone-800">
                      <div className="font-medium">{m.name} at {m.retirementAge}</div>
                      <ul className="mt-1 space-y-0.5 text-stone-600 dark:text-stone-400">
                        <li className="flex justify-between"><span>Pots at retirement</span><span className="tabular-nums">{money(pm.potAtRetirementMinor, cur)}</span></li>
                        <li className="flex justify-between"><span>Drawdown at {pct(withdrawal)}</span><span className="tabular-nums">{money(pm.drawdownAnnualMinor, cur)}</span></li>
                        <li className="flex justify-between"><span>State Pensions</span><span className="tabular-nums">{money(pm.statePensionAnnualMinor, cur)}</span></li>
                        <li className="flex justify-between font-medium text-stone-900 dark:text-stone-100"><span>Income a year</span><span className="tabular-nums">{money(pm.fullIncomeAnnualMinor, cur)}</span></li>
                      </ul>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3">
                <Why sources={plan.rules}>
                  <p>Each State Pension is pro rata to your contribution years, up to the number the rule pack sets for the full rate and subject to its minimum. Years until State Pension age are added while you live and work in that country.</p>
                </Why>
              </div>
            </Card>
          )}
          {plan.notes.length > 0 && <Card>{plan.notes.map((n) => <p key={n} className="text-sm text-amber-700 dark:text-amber-300">{n}</p>)}</Card>}
        </div>
      </div>
      <Disclaimer />
    </div>
  );
}
