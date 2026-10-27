import { Link } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { budgetReport, essentialSpend, netWorthSeries, periodOf, spendingWindow, totalsByCategory } from "@cuntas/ledger";
import { classify } from "@cuntas/rules";
import { fundBasisUsed, starterFundTarget } from "@cuntas/engine";
import { BackupReminder } from "../components/BackupReminder";
import { NextStep } from "../components/NextStep";
import { RulesBanner } from "../components/RulesBanner";
import { SetupChecklist, useSetupShowing } from "../components/Setup";
import { SpendingEstimateSheet } from "../components/SpendingEstimate";
import { Badge, Card, Disclaimer, PageHeader, Stat } from "../components/ui";
import { useCategoryName, usePlan } from "../lib/derived";
import { formatDate, money, monthLabel } from "../lib/format";
import { useChartColors } from "../lib/theme";
import { useDataset } from "../lib/store";
import { currencyWord } from "../lib/region";

const STEP_ZERO = new Set(["ie.track-budget.tracking", "ie.track-budget.budget", "us.budget.tracking", "us.budget.budget"]);

export function OverviewPage() {
  const colors = useChartColors();
  const ds = useDataset();
  const { result, snapshot, asOf, figures } = usePlan(ds);
  const base = ds.household.baseCurrency;
  const catName = useCategoryName(ds);
  const series = useMemo(() => netWorthSeries(ds, asOf, 12), [ds, asOf]);
  const latest = series[series.length - 1]!;
  const hasAccounts = ds.accounts.some((a) => !a.archived && a.tracksBalance !== false);
  const period = periodOf(asOf, ds.household.settings.paydayDayOfMonth);
  // This period's spending, or the latest period with some (last month's statement, imported late).
  const range = useMemo(() => spendingWindow(ds, asOf, ds.household.settings.paydayDayOfMonth), [ds, asOf]);
  const report = useMemo(() => budgetReport(ds, period), [ds, period]);
  const spending = useMemo(() => {
    const totals = totalsByCategory(ds, range.start, range.end);
    return [...totals.values()].filter((t) => t.spentMinor > 0).sort((a, b) => b.spentMinor - a.spentMinor).slice(0, 8).map((t) => ({ name: catName(t.categoryId), value: t.spentMinor / 100 }));
  }, [ds, range.start, range.end, catName]);
  const debtTotal = snapshot.debts.filter((d) => d.kind !== "mortgage").reduce((a, d) => a + d.balanceMinor, 0);
  const starter = starterFundTarget(snapshot);
  const essential = useMemo(() => essentialSpend(ds, asOf), [ds, asOf]);
  const [estimating, setEstimating] = useState(false);
  const linkCls = "text-brand-700 underline dark:text-brand-500";
  // Say what the target rests on when it isn't pay, and ask for a figure when there's nothing to go on.
  const fundHint =
    fundBasisUsed(snapshot) === "essentialSpend" && essential.source === "estimate" ? (
      <>Starter target {money(starter, base)}, based on your estimate · <button type="button" className={linkCls} onClick={() => setEstimating(true)}>Change</button></>
    ) : snapshot.netMonthlyPayMinor <= 0 && essential.source === "none" ? (
      <>Starter target {money(starter, base)} · <button type="button" className={linkCls} onClick={() => setEstimating(true)}>Add your monthly spending</button> for a target that fits</>
    ) : (
      `Starter target ${money(starter, base)}`
    );
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
  // While the setup checklist shows, it stands in for step 0's "start tracking" and "set a budget".
  const setup = useSetupShowing();
  const stepZero = !!result.current && STEP_ZERO.has(result.current.check);

  return (
    <div>
      <PageHeader title={`Hello, ${ds.members.map((m) => m.name).join(" & ") || ds.household.name}`} subtitle={<>Pay period {monthLabel(period)} · rule pack {result.rulePack}{figures && <> · <Badge tone="bad">{figures}</Badge></>}</>} />
      <RulesBanner ds={ds} asOf={asOf} />
      <BackupReminder />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {setup && <SetupChecklist />}
          {setup && stepZero ? null : result.current ? (
            <NextStep card={result.current} />
          ) : (
            <Card title="Every step on the ladder is met">
              <p className="mb-3 text-sm text-stone-600 dark:text-stone-400">Choose what your next {currencyWord(ds)} does. Figures use your marginal rate and the current rule pack.</p>
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
          <Stat label="Emergency fund" value={money(snapshot.liquidSavingsMinor, base)} hint={fundHint} tone={snapshot.liquidSavingsMinor >= starter ? "good" : undefined} />
          <Stat label="Debt (excl. mortgage)" value={money(debtTotal, base)} tone={debtTotal > 0 ? "bad" : "good"} hint={<Link to="/debts" className="underline">Payoff planner</Link>} />
          {report && <Stat label="Left to spend this period" value={money(report.lines.reduce((a, l) => a + Math.max(0, l.availableMinor), 0), base)} hint={`${money(report.spentMinor, base)} spent of ${money(report.budgetedMinor, base)} budgeted`} />}
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card title="Net worth" actions={<Badge>{base}</Badge>}>
          {!hasAccounts ? (
            <ChartEmpty>Add an account or import a statement to see your net worth over time. <Link to="/accounts" className="text-brand-700 underline dark:text-brand-500">Add an account</Link> · <Link to="/import" className="text-brand-700 underline dark:text-brand-500">Import</Link></ChartEmpty>
          ) : (
          <div className="h-56">
            <ResponsiveContainer>
              <AreaChart data={series.map((p) => ({ date: p.date.slice(0, 7), net: p.netMinor / 100, fx: p.fxEffectMinor / 100 }))}>
                <defs>
                  <linearGradient id="nw" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={colors.primaryFill} stopOpacity={0.35} /><stop offset="100%" stopColor={colors.primaryFill} stopOpacity={0} /></linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: colors.axis }} stroke={colors.grid} />
                <YAxis tick={{ fontSize: 11, fill: colors.axis }} stroke={colors.grid} width={60} tickFormatter={(v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v)))} />
                <Tooltip contentStyle={{ background: colors.tooltipBg, border: `1px solid ${colors.tooltipBorder}`, borderRadius: 8 }} formatter={(v: number, k: string) => [money(Math.round(v * 100), base), k === "net" ? "Net worth" : "FX effect"]} />
                <Area type="monotone" dataKey="net" stroke={colors.primary} fill="url(#nw)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          )}
          {hasAccounts && <p className="mt-2 text-xs text-stone-500">Balances in other currencies are converted at ECB reference rates; the tooltip shows the part of each month's change caused by exchange rates.</p>}
        </Card>
        <Card title={range.latest ? `Spending ${formatDate(range.start)} – ${formatDate(range.end)}` : "Spending this period"} actions={<Link to="/transactions" className="text-sm text-brand-700 underline dark:text-brand-500">All transactions</Link>}>
          {spending.length === 0 ? (
            <ChartEmpty>No spending recorded since {formatDate(range.start)}. <Link to="/import" className="text-brand-700 underline dark:text-brand-500">Import a statement</Link></ChartEmpty>
          ) : (
          <div className="h-56">
            <ResponsiveContainer>
              <BarChart data={spending} layout="vertical" margin={{ left: 20 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11, fill: colors.axis }} stroke={colors.grid} />
                <Tooltip contentStyle={{ background: colors.tooltipBg, border: `1px solid ${colors.tooltipBorder}`, borderRadius: 8 }} formatter={(v: number) => money(Math.round(v * 100), base)} />
                <Bar dataKey="value" fill={colors.primaryFill} radius={[0, 4, 4, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          )}
        </Card>
      </div>
      <Disclaimer />
      <SpendingEstimateSheet open={estimating} onClose={() => setEstimating(false)} />
    </div>
  );
}

function ChartEmpty({ children }: { children: ReactNode }) {
  return <div className="flex h-56 items-center justify-center rounded-lg border border-dashed border-stone-300 p-6 text-center text-sm text-stone-600 dark:border-stone-700 dark:text-stone-400"><p>{children}</p></div>;
}
