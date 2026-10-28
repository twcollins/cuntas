import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { residenceOn, retirementPlan, usSocialSecurityFor, type Member } from "@cuntas/ledger";
import { chartDefaults, latestWith, toMinor, usFullRetirementAge } from "@cuntas/rules";
import { Badge, Card, Disclaimer, Empty, Field, Input, MoneyInput, PageHeader, Stat, Table, Why } from "../components/ui";
import { useAsOf } from "../lib/derived";
import { money, moneyExact, pct } from "../lib/format";
import { update, useDataset } from "../lib/store";
import { useChartColors } from "../lib/theme";

const pctInput = (v: number) => +(v * 100).toFixed(2);
const PENSION_NAME = { IE: "IE State Pension", UK: "UK State Pension", US: "US Social Security" } as const;

/** Lives in the US, is a US citizen, or has US work or an SSA statement recorded: Social Security applies. */
function usRelevant(m: Member, residence: string) {
  return residence === "US" || m.nationality.includes("US") || (m.usCoveredYears ?? 0) > 0 || !!m.usSsStatementMinor;
}

const setMember = (id: string, change: Partial<Member>) => update((d) => ({ ...d, members: d.members.map((x) => (x.id === id ? { ...x, ...change } : x)) }));

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
  const residence = (id: string) => residenceOn(ds, id, asOf);
  // Irish and UK years only matter to people with a link to Ireland or the UK.
  const ieUk = (m: Member) => residence(m.id) !== "US" || m.nationality.some((n) => n !== "US") || m.ieContributionYears !== null || m.ukQualifyingYears !== null;

  if (ds.members.length === 0) return <div><PageHeader title="Retirement" /><Empty title="Add yourself first">Ages, pay and pensions drive the projection. <Link to="/household" className="font-medium text-brand-700 underline dark:text-brand-500">Add people on the Household page</Link></Empty></div>;

  return (
    <div>
      <PageHeader title="Retirement projection" subtitle="Pots grown to each person's retirement age and turned into income, alongside Irish and UK State Pensions and US Social Security. All figures are in today's money." />
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
                    <Field label="Retire at">{(id) => <Input id={id} type="number" min={40} max={80} value={pm.retirementAge} onChange={(e) => { const v = Number(e.target.value); if (v >= 40 && v <= 80) setMember(m.id, { retirementAge: v }); }} />}</Field>
                    {ieUk(m) && <Field label="IE PRSI years">{(id) => <Input id={id} type="number" min={0} value={m.ieContributionYears ?? ""} placeholder="?" onChange={(e) => setMember(m.id, { ieContributionYears: e.target.value === "" ? null : Math.max(0, Number(e.target.value)) })} />}</Field>}
                    {ieUk(m) && <Field label="UK NI years">{(id) => <Input id={id} type="number" min={0} value={m.ukQualifyingYears ?? ""} placeholder="0" onChange={(e) => setMember(m.id, { ukQualifyingYears: e.target.value === "" ? null : Math.max(0, Number(e.target.value)) })} />}</Field>}
                  </div>
                  {usRelevant(m, residence(m.id)) && (
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      <Field label="US work years">{(id) => <Input id={id} type="number" min={0} max={60} value={m.usCoveredYears ?? ""} placeholder="?" onChange={(e) => setMember(m.id, { usCoveredYears: e.target.value === "" ? null : Math.min(60, Math.max(0, Number(e.target.value))) })} />}</Field>
                      <Field label="SSA benefit at full age ($/mo)">{(id) => <MoneyInput id={id} value={m.usSsStatementMinor ?? 0} onChange={(v) => setMember(m.id, { usSsStatementMinor: v > 0 ? v : null })} placeholder="From statement" />}</Field>
                      <Field label="Claim at">{(id) => <Input id={id} type="number" min={62} max={70} value={m.usClaimAge ?? ""} placeholder={String(usFra(m))} onChange={(e) => { const v = e.target.value === "" ? null : Number(e.target.value); if (v === null || (v >= 62 && v <= 70)) setMember(m.id, { usClaimAge: v }); }} />}</Field>
                    </div>
                  )}
                  <div className="mt-2 text-xs text-stone-500">
                    Pots {money(pm.potMinor, cur)} · adding {money(pm.annualContributionMinor, cur)} a year
                    {pm.statePensions.map((s) => <span key={s.jurisdiction}> · {PENSION_NAME[s.jurisdiction]} {money(s.annualMinor, cur)} from {s.startAge}</span>)}
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
                        <li className="flex justify-between"><span>{pm.statePensionAnnualMinor > 0 && m.statePensions.every((s) => s.jurisdiction === "US") ? "Social Security" : "State Pensions"}</span><span className="tabular-nums">{money(pm.statePensionAnnualMinor, cur)}</span></li>
                        <li className="flex justify-between font-medium text-stone-900 dark:text-stone-100"><span>Income a year</span><span className="tabular-nums">{money(pm.fullIncomeAnnualMinor, cur)}</span></li>
                      </ul>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3">
                <Why sources={plan.rules}>
                  <p>Each State Pension is pro rata to your contribution years, up to the number the rule pack sets for the full rate and subject to its minimum. Years until State Pension age are added while you live and work in that country.</p>
                  <p className="mt-2">US Social Security uses SSA's formula on your best 35 years, taking today's pay (up to the wage base) for each year of US work, so it is in today's money. Without a count of years, a US resident is assumed to have worked since 22. The figure from your SSA statement replaces the estimate. It needs 10 years of US work; the social security agreements with Ireland and the UK can combine years when you have fewer.</p>
                </Why>
              </div>
            </Card>
          )}
          <SocialSecurityClaiming members={ds.members.filter((m) => usRelevant(m, residence(m.id)))} />
          {plan.notes.length > 0 && <Card>{plan.notes.map((n) => <p key={n} className="text-sm text-amber-700 dark:text-amber-300">{n}</p>)}</Card>}
        </div>
      </div>
      <Disclaimer />
    </div>
  );
}

function usFra(m: Member): number {
  const pack = latestWith("US", "socialSecurity", new Date().toISOString().slice(0, 10));
  return pack ? usFullRetirementAge(pack, m.dateOfBirth).years : 67;
}

/** Monthly Social Security by claiming age, 62 to 70, for each person it applies to. */
function SocialSecurityClaiming({ members }: { members: Member[] }) {
  const ds = useDataset();
  const asOf = useAsOf();
  const pack = latestWith("US", "socialSecurity", asOf);
  const plan = useMemo(() => retirementPlan(ds, asOf), [ds, asOf]);
  if (!pack?.socialSecurity || members.length === 0) return null;
  const [earliest, latest] = pack.socialSecurity.claimAges;
  const ages = Array.from({ length: latest - earliest + 1 }, (_, i) => earliest + i);
  return (
    <Card title="Social Security: when to claim" actions={<Badge tone="warn">{pack.version}</Badge>}>
      <p className="mb-3 text-sm text-stone-600 dark:text-stone-400">A month a year in today's dollars, by the age benefits start. Claiming before full retirement age cuts the benefit for life; each year after it, up to 70, adds 8%.</p>
      {members.map((m) => {
        const fra = usFullRetirementAge(pack, m.dateOfBirth);
        const rows = ages.map((a) => ({ a, r: usSocialSecurityFor(ds, m, asOf, a)! }));
        const pia = rows[0]!.r.piaMinor;
        // Years counted differ by claiming age only when working on past 62; say what the chosen age uses.
        const chosen = usSocialSecurityFor(ds, m, asOf)!;
        return (
          <div key={m.id} className="mb-4 last:mb-0">
            <p className="mb-1 text-sm font-medium">
              {m.name} · full retirement age {fra.years}{fra.months ? ` and ${fra.months} months` : ""} · {chosen.fromStatement ? "from your SSA statement" : residenceOn(ds, m.id, asOf) !== "US" ? "enter the benefit at full retirement age from your SSA statement to see it" : chosen.eligible ? `estimated from ${chosen.coveredYears} years at ${money(Math.min(m.grossAnnualMinor, toMinor(pack.fica.socialSecurityWageBase)), "USD")}${chosen.assumedYears ? " (work since 22 assumed)" : ""}` : "under 10 years of US work: no benefit on its own"}
            </p>
            {pia > 0 && (
              <Table head={["Claim at", "A month", "% of full"]}>
                {rows.map(({ a, r }) => (
                  <tr key={a} className={a === (m.usClaimAge ?? fra.years) ? "font-medium" : undefined}>
                    <td className="py-1">{a}{a === fra.years && !fra.months ? " (full)" : ""}</td>
                    <td className="py-1 tabular-nums">{moneyExact(r.monthlyMinor, "USD")}</td>
                    <td className="py-1 tabular-nums">{Math.round((r.monthlyMinor / pia) * 1000) / 10}%</td>
                  </tr>
                ))}
              </Table>
            )}
          </div>
        );
      })}
      <div className="mt-3"><Why sources={plan.rules.filter((r) => r.key === "socialSecurity")}><p>SSA's formula: 90% of average indexed monthly earnings up to the first bend point, 32% to the second, 15% above; 5/9 of 1% off for each of the first 36 months claimed early and 5/12 of 1% beyond; 2/3 of 1% added for each month delayed up to 70.</p></Why></div>
    </Card>
  );
}
