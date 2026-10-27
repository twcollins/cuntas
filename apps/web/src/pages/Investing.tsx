import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { FxTable, residenceOn } from "@cuntas/ledger";
import { ageOn, chartDefaults, compareWrappers, COUNTRY_INFO, iePayroll, latestWith, packOn, toMinor, ukPayroll, ukRateBand, type Jurisdiction } from "@cuntas/rules";
import { Badge, Card, Disclaimer, Field, Input, MoneyInput, PageHeader, Select, Table, Why } from "../components/ui";
import { useAsOf } from "../lib/derived";
import { money, pct } from "../lib/format";
import { useDataset } from "../lib/store";
import { useChartColors } from "../lib/theme";

/** Extra pay used to measure the marginal rate on investment income. */
const PROBE_MINOR = 100_000;
/** Any pack, however far ahead, that defines the Investment Account. */
const LATEST = "9999-12-31";
const pctInput = (v: number) => +(v * 100).toFixed(2);

export function InvestingPage() {
  const ds = useDataset();
  const asOf = useAsOf();
  const pj = chartDefaults().projections;
  const colors = useChartColors();
  const [memberId, setMemberId] = useState(ds.members[0]?.id ?? "");
  const m = ds.members.find((x) => x.id === memberId);
  const home = m ? residenceOn(ds, m.id, asOf) : "IE";
  // Wrapper comparisons cover Ireland and the UK; a US resident starts from Ireland's.
  const [residence, setResidence] = useState<Jurisdiction>(home === "UK" ? "UK" : "IE");
  const cur = residence === "UK" ? "GBP" : "EUR";
  const [contribution, setContribution] = useState(toMinor(3000));
  const [years, setYears] = useState(pj.years);
  const [growth, setGrowth] = useState(pj.nominalReturn + pj.inflation);
  const [dividendYield, setDividendYield] = useState(pj.dividendYield);
  const [depositRate, setDepositRate] = useState(pj.depositRate);
  const iePack = packOn("IE", asOf);
  const ukPack = packOn("UK", asOf);
  const iaPack = latestWith("IE", "investmentAccount", LATEST);
  const [retirementRate, setRetirementRate] = useState<number | null>(null);

  // Marginal rates from the member's own pay under the chosen residence's rules.
  const rates = useMemo(() => {
    // Pay is held in the currency of where the member lives now; convert it for a different residence.
    const actual = m ? residenceOn(ds, m.id, asOf) : residence;
    const raw = m?.grossAnnualMinor || toMinor(50000);
    const gross = actual === residence ? raw : (new FxTable(ds.fxRates).tryConvert(raw, COUNTRY_INFO[actual].currency, cur, asOf) ?? raw);
    const age = m ? ageOn(m.dateOfBirth, asOf) : 40;
    if (residence === "IE") {
      const run = (g: number) => iePayroll(iePack, { grossAnnualMinor: g, frequency: "monthly", assessment: m?.assessment ?? "single", employment: m?.employmentType === "selfEmployed" ? "selfEmployed" : "employee", age });
      const a = run(gross);
      const b = run(gross + PROBE_MINOR);
      return { marginal: a.marginalRate, charges: (a.netAnnualMinor - b.netAnnualMinor + PROBE_MINOR) / PROBE_MINOR, band: "basic" as const, retirement: iePack.incomeTax.rates.standard };
    }
    const run = (g: number) => ukPayroll(ukPack, { grossAnnualMinor: g, region: m?.ukRegion ?? "rUK" });
    const a = run(gross);
    return { marginal: a.marginalRate, charges: a.marginalRate, band: ukRateBand(ukPack, gross), retirement: ukPack.incomeTax.bands[0]!.rate };
  }, [ds, m, asOf, residence, cur, iePack, ukPack]);

  const rows = useMemo(
    () =>
      compareWrappers({
        residence, iePack, ukPack, annualContributionMinor: contribution, years, growthRate: growth, dividendYield, depositRate,
        marginalRate: rates.marginal, incomeChargesRate: rates.charges, retirementTaxRate: retirementRate ?? rates.retirement, ukBand: rates.band, date: asOf, flags: ds.household.settings.flags,
        ...(iaPack ? { investmentAccountPack: iaPack } : {}),
      }).sort((a, b) => b.netValueMinor - a.netValueMinor),
    [residence, iePack, ukPack, iaPack, contribution, years, growth, dividendYield, depositRate, rates, retirementRate, asOf, ds.household.settings.flags],
  );

  return (
    <div>
      <PageHeader title="Compare tax wrappers" subtitle="The same yearly contribution and the same return, after tax, in each wrapper open to you. Treatment follows residence, not where the account is." />
      {home === "US" && (
        <p role="note" className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-900/30 dark:text-amber-100">
          {m?.name} lives in the US. This comparison covers Irish and UK wrappers; US accounts (401(k), IRA, HSA) aren't compared yet.
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Inputs">
          <div className="grid grid-cols-2 gap-2 [&_input]:w-full [&_select]:w-full">
            {ds.members.length > 0 && <Field label="For">{(id) => <Select id={id} value={memberId} onChange={(e) => { setMemberId(e.target.value); setResidence(residenceOn(ds, e.target.value, asOf) === "UK" ? "UK" : "IE"); }} options={ds.members.map((x) => ({ value: x.id, label: x.name }))} />}</Field>}
            <Field label="Resident in">{(id) => <Select id={id} value={residence} onChange={(e) => setResidence(e.target.value as Jurisdiction)} options={[{ value: "IE", label: "Ireland" }, { value: "UK", label: "UK" }]} />}</Field>
            <Field label="Each year (cost to you)">{(id) => <MoneyInput id={id} value={contribution} onChange={setContribution} />}</Field>
            <Field label="Years">{(id) => <Input id={id} type="number" min={1} max={50} value={years} onChange={(e) => setYears(Math.max(1, Math.min(50, Number(e.target.value))))} />}</Field>
            <Field label="Return a year (%)">{(id) => <Input id={id} type="number" step={0.5} value={pctInput(growth)} onChange={(e) => setGrowth(Number(e.target.value) / 100)} />}</Field>
            <Field label="Of which dividends (%)">{(id) => <Input id={id} type="number" step={0.5} value={pctInput(dividendYield)} onChange={(e) => setDividendYield(Number(e.target.value) / 100)} />}</Field>
            <Field label="Deposit rate (%)">{(id) => <Input id={id} type="number" step={0.25} value={pctInput(depositRate)} onChange={(e) => setDepositRate(Number(e.target.value) / 100)} />}</Field>
            <Field label="Tax on pension income (%)">{(id) => <Input id={id} type="number" step={1} value={pctInput(retirementRate ?? rates.retirement)} onChange={(e) => setRetirementRate(Number(e.target.value) / 100)} />}</Field>
          </div>
          <div className="mt-3 rounded-lg bg-stone-50 p-3 text-xs text-stone-600 dark:bg-stone-800/50 dark:text-stone-400">
            Pension relief at your marginal income tax rate: <strong>{pct(rates.marginal)}</strong>.{" "}
            {residence === "IE" ? <>Investment income taxed at <strong>{pct(rates.charges)}</strong> including USC and PRSI.</> : <>UK {rates.band} rate band for dividends, savings and CGT.</>}
          </div>
        </Card>

        <div className="space-y-4 lg:col-span-2">
          <Card title={`After ${years} years`}>
            <div className="h-64">
              <ResponsiveContainer>
                <BarChart data={rows.map((r) => ({ name: r.label, net: r.netValueMinor / 100, available: r.available }))} layout="vertical" margin={{ left: 8, right: 24 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 12, fill: colors.axis }} stroke={colors.grid} tickFormatter={(v: number) => money(v * 100, cur)} />
                  <YAxis type="category" dataKey="name" width={170} tick={{ fontSize: 12, fill: colors.axis }} stroke={colors.grid} />
                  <Tooltip contentStyle={{ background: colors.tooltipBg, border: `1px solid ${colors.tooltipBorder}`, borderRadius: 8 }} formatter={(v: number) => [money(v * 100, cur), "After tax"]} />
                  <Bar dataKey="net" radius={[0, 4, 4, 0]}>
                    {rows.map((r) => <Cell key={r.id} fill={r.available ? colors.primaryFill : colors.grid} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card>
            <Table head={["Wrapper", "You put in", "Invested", "Tax", "After tax"]}>
              {rows.map((r) => (
                <tr key={r.id} className={r.available ? "" : "text-stone-400"}>
                  <td className="px-2 py-2 align-top">
                    <div className="font-medium">{r.label} {!r.available && <Badge>not yet available</Badge>}</div>
                    <ul className="mt-0.5 text-xs text-stone-500">{r.notes.map((n) => <li key={n}>{n}</li>)}</ul>
                    {r.rules.length > 0 && <div className="mt-1"><Why sources={r.rules} /></div>}
                  </td>
                  <td className="px-2 py-2 text-right align-top tabular-nums">{money(r.contributedMinor, r.currency)}</td>
                  <td className="px-2 py-2 text-right align-top tabular-nums">{money(r.investedMinor, r.currency)}</td>
                  <td className="px-2 py-2 text-right align-top tabular-nums text-rose-600 dark:text-rose-400">{money(r.taxPaidMinor, r.currency)}</td>
                  <td className="px-2 py-2 text-right align-top font-semibold tabular-nums">{money(r.netValueMinor, r.currency)}</td>
                </tr>
              ))}
            </Table>
            <p className="mt-3 text-xs text-stone-500">Illustrations only, before fees, at a steady return. Pensions are locked until retirement and the comparison assumes you take them as a lump sum and income at the rate above. Not a recommendation of any wrapper or product.</p>
          </Card>
        </div>
      </div>
      <Disclaimer />
    </div>
  );
}
