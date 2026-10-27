import { useMemo, useState } from "react";
import { addMonths } from "@cuntas/rules";
import { BUCKET_LABELS, budgetFromEstimate, budgetFromSpending, budgetReport, newId, paydayWaterfall, periodOf, periodRange, previousPeriod, type Budget, type WaterfallBucket } from "@cuntas/ledger";
import { starterFundTarget } from "@cuntas/engine";
import { SpendingEstimateSheet } from "../components/SpendingEstimate";
import { Badge, Button, Card, Empty, MoneyInput, PageHeader, ProgressBar, Select, Table } from "../components/ui";
import { useCategoryName, usePlan } from "../lib/derived";
import { formatDate, money, monthLabel } from "../lib/format";
import { update, useDataset } from "../lib/store";

export function BudgetsPage() {
  const ds = useDataset();
  const { snapshot, asOf } = usePlan(ds);
  const payday = ds.household.settings.paydayDayOfMonth;
  const [period, setPeriod] = useState(periodOf(asOf, payday));
  const base = ds.household.baseCurrency;
  const catName = useCategoryName(ds);
  const budget = ds.budgets.find((b) => b.period === period);
  const report = useMemo(() => budgetReport(ds, period), [ds, period]);
  const range = periodRange(period, payday);
  const [adding, setAdding] = useState("");
  const [estimating, setEstimating] = useState(false);

  const saveBudget = (b: Budget) => update((d) => ({ ...d, budgets: [...d.budgets.filter((x) => x.period !== b.period), b] }));

  const fromEstimate = () => update((d) => {
    const b = budgetFromEstimate(d, period);
    return b ? { ...d, budgets: [...d.budgets.filter((x) => x.period !== period), b] } : d;
  });

  function create(from: "previous" | "spending") {
    const prev = ds.budgets.find((b) => b.period === previousPeriod(period));
    if (from === "previous" && prev) return saveBudget({ ...prev, id: newId("budget"), period });
    const p = periodRange(previousPeriod(period), payday);
    saveBudget(budgetFromSpending(ds, period, p.start, p.end));
  }

  const needs = useMemo(() => {
    const out: Partial<Record<WaterfallBucket, number>> = {};
    for (const l of budget?.lines ?? []) {
      const w = ds.categories.find((c) => c.id === l.categoryId)?.waterfall;
      if (w) out[w] = (out[w] ?? 0) + l.amountMinor;
    }
    out.minimumDebt = Math.max(out.minimumDebt ?? 0, snapshot.debts.reduce((a, d) => a + d.minPaymentMinor, 0));
    const gap = starterFundTarget(snapshot) - snapshot.liquidSavingsMinor;
    out.emergencyFund = Math.max(out.emergencyFund ?? 0, gap);
    return out;
  }, [budget, ds.categories, snapshot]);
  const waterfall = paydayWaterfall(snapshot.netMonthlyPayMinor, needs);
  const unbudgeted = ds.categories.filter((c) => c.kind === "expense" && !budget?.lines.some((l) => l.categoryId === c.id));

  return (
    <div>
      <PageHeader
        title="Budgets"
        subtitle={`${monthLabel(period)} pay period: ${formatDate(range.start)} to ${formatDate(range.end)}${payday > 1 ? ` (payday on the ${payday}th)` : ""}`}
        actions={
          <>
            <Button onClick={() => setPeriod(addMonths(`${period}-01`, -1).slice(0, 7))}>← Previous</Button>
            <Button onClick={() => setPeriod(addMonths(`${period}-01`, 1).slice(0, 7))}>Next →</Button>
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {!budget || !report ? (
            <Card>
              <Empty title="No budget for this period">
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  <Button variant="primary" onClick={() => create("previous")} disabled={!ds.budgets.some((b) => b.period === previousPeriod(period))}>Copy last period</Button>
                  <Button onClick={() => create("spending")}>Start from last period's spending</Button>
                  {ds.household.spendingEstimate ? (
                    <Button onClick={fromEstimate}>Start from your monthly estimate</Button>
                  ) : (
                    <Button onClick={() => setEstimating(true)}>Start from a rough monthly figure</Button>
                  )}
                </div>
              </Empty>
            </Card>
          ) : (
            <Card
              title={budget.mode === "envelope" ? "Envelope budget" : "Monthly caps"}
              actions={
                <Select
                  aria-label="Budget mode"
                  value={budget.mode}
                  onChange={(e) => saveBudget({ ...budget, mode: e.target.value as Budget["mode"] })}
                  options={[{ value: "envelope", label: "Envelope (zero-based)" }, { value: "cap", label: "Simple caps" }]}
                  className="w-auto"
                />
              }
            >
              {budget.mode === "envelope" && (
                <div className={`mb-4 rounded-lg p-3 text-sm ${report.toBeAssignedMinor < 0 ? "bg-rose-50 text-rose-800 dark:bg-rose-900/30 dark:text-rose-200" : "bg-brand-50 text-brand-800 dark:bg-brand-900/30 dark:text-brand-100"}`}>
                  <strong>{money(report.toBeAssignedMinor, base)}</strong> to be assigned · income this period {money(report.incomeMinor, base)}, budgeted {money(report.budgetedMinor, base)}
                </div>
              )}
              <Table head={["Category", "Budgeted", "Rollover", "Spent", "Available", ""]}>
                {report.lines.map((l) => {
                  const line = budget.lines.find((x) => x.categoryId === l.categoryId)!;
                  return (
                    <tr key={l.categoryId}>
                      <td className="px-2 py-2">
                        <div className="font-medium">{catName(l.categoryId)}</div>
                        <ProgressBar value={l.spentMinor} max={l.budgetedMinor + l.rolloverInMinor} tone={l.overspent ? "bad" : "brand"} />
                      </td>
                      <td className="w-28 px-2 py-2">
                        <MoneyInput aria-label={`Budget for ${catName(l.categoryId)}`} value={l.budgetedMinor} onChange={(v) => saveBudget({ ...budget, lines: budget.lines.map((x) => (x.categoryId === l.categoryId ? { ...x, amountMinor: v } : x)) })} className="py-1 text-right" />
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-stone-500">
                        <label className="flex items-center justify-end gap-1">
                          <input type="checkbox" checked={line.rollover} onChange={(e) => saveBudget({ ...budget, lines: budget.lines.map((x) => (x.categoryId === l.categoryId ? { ...x, rollover: e.target.checked } : x)) })} aria-label="Roll over" />
                          {money(l.rolloverInMinor, base)}
                        </label>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">{money(l.spentMinor, base)}</td>
                      <td className={`px-2 py-2 text-right font-medium tabular-nums ${l.overspent ? "text-rose-600" : ""}`}>{money(l.availableMinor, base)}</td>
                      <td className="px-2 py-2 text-right">
                        <Button variant="ghost" aria-label="Remove line" onClick={() => saveBudget({ ...budget, lines: budget.lines.filter((x) => x.categoryId !== l.categoryId) })}>✕</Button>
                      </td>
                    </tr>
                  );
                })}
              </Table>
              <div className="mt-3 flex gap-2">
                <Select aria-label="Add category" value={adding} onChange={(e) => setAdding(e.target.value)} options={[{ value: "", label: "Add a category…" }, ...unbudgeted.map((c) => ({ value: c.id, label: c.name }))]} />
                <Button disabled={!adding} onClick={() => { saveBudget({ ...budget, lines: [...budget.lines, { categoryId: adding, amountMinor: 0, rollover: true }] }); setAdding(""); }}>Add</Button>
              </div>
              {report.unbudgetedSpendMinor > 0 && <p className="mt-3 text-xs text-stone-500">{money(report.unbudgetedSpendMinor, base)} was spent in categories without a budget line.</p>}
            </Card>
          )}
        </div>
        <Card title="Payday waterfall">
          <p className="mb-3 text-xs text-stone-500">Your monthly net pay of {money(snapshot.netMonthlyPayMinor, base)}, allocated in the chart's order. Non-essential bills come after the starter emergency fund.</p>
          <ol className="space-y-2">
            {waterfall.allocations.map((a, i) => (
              <li key={a.bucket} className="text-sm">
                <div className="flex justify-between">
                  <span>{i + 1}. {BUCKET_LABELS[a.bucket]}</span>
                  <span className="tabular-nums">{money(a.allocatedMinor, base)}{a.needMinor > 0 && <span className="text-stone-400"> / {money(a.needMinor, base)}</span>}</span>
                </div>
                <ProgressBar value={a.allocatedMinor} max={a.needMinor} tone={a.shortMinor > 0 ? "warn" : "brand"} />
              </li>
            ))}
          </ol>
          <div className="mt-4 text-sm">
            {waterfall.firstShortBucket ? <Badge tone="warn">First bucket short: {BUCKET_LABELS[waterfall.firstShortBucket]}</Badge> : <Badge tone="good">Every bucket covered · {money(waterfall.leftoverMinor, base)} left over</Badge>}
          </div>
        </Card>
      </div>
      <SpendingEstimateSheet open={estimating} onClose={() => setEstimating(false)} saveLabel="Save and make a budget" onSaved={fromEstimate} />
    </div>
  );
}
