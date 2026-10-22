import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { budgetReport, netWorthSeries, periodOf, periodRange, totalsByCategory } from "@cuntas/ledger";
import { classify } from "@cuntas/rules";
import { starterFundTarget } from "@cuntas/engine";
import { NextStep } from "../components/NextStep";
import { Badge, Card, Disclaimer, PageHeader, Stat } from "../components/ui";
import { useCategoryName, usePlan } from "../lib/derived";
import { money, monthLabel } from "../lib/format";
import { useDataset } from "../lib/store";

export function OverviewPage() {
  const ds = useDataset();
  const { result, snapshot, asOf } = usePlan(ds);
  const base = ds.household.baseCurrency;
  const catName = useCategoryName(ds);
  const series = useMemo(() => netWorthSeries(ds, asOf, 12), [ds, asOf]);
  const latest = series[series.length - 1]!;
  const period = periodOf(asOf, ds.household.settings.paydayDayOfMonth);
  const range = periodRange(period, ds.household.settings.paydayDayOfMonth);
  const report = useMemo(() => budgetReport(ds, period), [ds, period]);
  const spending = useMemo(() => {
    const totals = totalsByCategory(ds, range.start, range.end);
    return [...totals.values()].filter((t) => t.spentMinor > 0).sort((a, b) => b.spentMinor - a.spentMinor).slice(0, 8).map((t) => ({ name: catName(t.categoryId), value: t.spentMinor / 100 }));
  }, [ds, range.start, range.end, catName]);
  const debtTotal = snapshot.debts.filter((d) => d.kind !== "mortgage").reduce((a, d) => a + d.balanceMinor, 0);
  const starter = starterFundTarget(snapshot);
  const warnings = useMemo(() => {
    const out: string[] = [];
    for (const a of ds.accounts.filter((x) => x.wrapper === "ISA" && !x.archived)) {
      for (const memberId of a.memberIds) {
        const m = ds.members.find((x) => x.id === memberId);
        const res = ds.residencePeriods.find((r) => r.memberId === memberId && r.from <= asOf && (!r.to || r.to >= asOf))?.jurisdiction ?? "IE";
        if (!m) continue;
        const c = classify({ kind: "isa" }, { residence: res, nationality: m.nationality }, asOf.slice(0, 4));
        if (c.flags.includes("isa-not-exempt")) out.push(`${a.name}: ${c.notes.slice(1).join(" ")}`);
      }
    }
    return out;
  }, [ds, asOf]);
  const fxNow = latest.fxEffectMinor;

  return (
    <div>
      <PageHeader title={`Hello, ${ds.members.map((m) => m.name).join(" & ") || ds.household.name}`} subtitle={`Pay period ${monthLabel(period)} · rule pack ${result.rulePack}`} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {result.current ? (
            <NextStep card={result.current} />
          ) : (
            <Card title="Every step on the ladder is met">
              <p className="mb-3 text-sm text-stone-600 dark:text-stone-400">Choose what your next euro does. Figures use your marginal rate and the current rule pack.</p>
              <ul className="space-y-2 text-sm">
                {result.options.map((o) => (
                  <li key={o.id} className="rounded-lg bg-stone-50 p-3 dark:bg-stone-800/60"><div className="font-medium">{o.title}</div><div className="text-stone-600 dark:text-stone-400">{o.detail}</div></li>
                ))}
              </ul>
            </Card>
          )}
          {result.alwaysOn.map((c) => (
            <NextStep key={`${c.check}:${c.member}`} card={c} secondary />
          ))}
          {warnings.map((w) => (
            <div key={w} className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-900/20 dark:text-amber-200">⚠ {w}</div>
          ))}
        </div>
        <div className="space-y-4">
          <Stat label="Net worth" value={money(latest.netMinor, base)} hint={fxNow !== 0 ? `FX effect this month ${money(fxNow, base)}` : `Assets ${money(latest.assetsMinor, base)} · debts ${money(latest.liabilitiesMinor, base)}`} />
          <Stat label="Emergency fund" value={money(snapshot.liquidSavingsMinor, base)} hint={`Starter target ${money(starter, base)}`} tone={snapshot.liquidSavingsMinor >= starter ? "good" : undefined} />
          <Stat label="Debt (excl. mortgage)" value={money(debtTotal, base)} tone={debtTotal > 0 ? "bad" : "good"} hint={<Link to="/debts" className="underline">Payoff planner</Link>} />
          {report && <Stat label="Left to spend this period" value={money(report.lines.reduce((a, l) => a + Math.max(0, l.availableMinor), 0), base)} hint={`${money(report.spentMinor, base)} spent of ${money(report.budgetedMinor, base)} budgeted`} />}
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card title="Net worth" actions={<Badge>{base}</Badge>}>
          <div className="h-56">
            <ResponsiveContainer>
              <AreaChart data={series.map((p) => ({ date: p.date.slice(0, 7), net: p.netMinor / 100, fx: p.fxEffectMinor / 100 }))}>
                <defs>
                  <linearGradient id="nw" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#14917f" stopOpacity={0.35} /><stop offset="100%" stopColor="#14917f" stopOpacity={0} /></linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} width={60} tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} />
                <Tooltip formatter={(v: number, k: string) => [money(Math.round(v * 100), base), k === "net" ? "Net worth" : "FX effect"]} />
                <Area type="monotone" dataKey="net" stroke="#0f766e" fill="url(#nw)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-xs text-stone-500">GBP balances converted at ECB reference rates; the tooltip shows the part of each month's change caused by exchange rates.</p>
        </Card>
        <Card title={`Spending this period`} actions={<Link to="/transactions" className="text-sm text-brand-700 underline dark:text-brand-500">All transactions</Link>}>
          <div className="h-56">
            <ResponsiveContainer>
              <BarChart data={spending} layout="vertical" margin={{ left: 20 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number) => money(Math.round(v * 100), base)} />
                <Bar dataKey="value" fill="#14917f" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
      <Disclaimer />
    </div>
  );
}
