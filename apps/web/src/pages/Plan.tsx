import type { Thresholds } from "@cuntas/engine";
import { Badge, Button, Card, Disclaimer, Field, Input, MoneyInput, PageHeader, ProgressBar, Select } from "../components/ui";
import { NextStep } from "../components/NextStep";
import { usePlan } from "../lib/derived";
import { money } from "../lib/format";
import { update, useDataset } from "../lib/store";

const statusTone = { met: "good", unmet: "warn", "not-applicable": "neutral", dismissed: "neutral" } as const;
const statusLabel = { met: "Met", unmet: "To do", "not-applicable": "n/a", dismissed: "Skipped" } as const;

export function PlanPage() {
  const ds = useDataset();
  const { result, snapshot } = usePlan(ds);
  const t = snapshot.thresholds;
  const base = ds.household.baseCurrency;
  const setOverride = (key: keyof Thresholds, value: number) =>
    update((d) => ({ ...d, household: { ...d.household, settings: { ...d.household.settings, thresholdOverrides: { ...d.household.settings.thresholdOverrides, [key]: value } } } }));

  return (
    <div>
      <PageHeader title="Next steps" subtitle="The r/irishpersonalfinance flowchart (v2.1) as a checklist, measured against your data. The first unmet step is your next step." />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          {result.current && <NextStep card={result.current} />}
          {result.ladder.map((row) => (
            <Card key={row.step}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="text-xs font-medium text-stone-500">Step {row.order} · {row.jurisdictions.join(" / ")}</div>
                  <h3 className="font-semibold">{row.title}</h3>
                  <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">{row.chartRule}</p>
                </div>
                <Badge tone={statusTone[row.status]}>{statusLabel[row.status]}</Badge>
              </div>
              {row.checks.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {row.checks.map((c) => (
                    <li key={`${c.check}:${c.member ?? ""}`} className="rounded-lg bg-stone-50 p-3 dark:bg-stone-800/50">
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span>{c.title}{c.memberName ? ` · ${c.memberName}` : ""}</span>
                        <div className="flex items-center gap-2">
                          <Badge tone={statusTone[c.status]}>{statusLabel[c.status]}</Badge>
                          {c.status === "dismissed" && (
                            <Button variant="ghost" className="text-xs" onClick={() => update((d) => ({ ...d, stepStates: d.stepStates.filter((s) => !(s.stepId === c.check && (s.memberId ?? undefined) === c.member)) }), `step.restore:${c.check}`)}>
                              Restore
                            </Button>
                          )}
                        </div>
                      </div>
                      {c.progress && c.progress.target > 0 && (
                        <div className="mt-2">
                          <ProgressBar value={c.progress.current} max={c.progress.target} tone={c.status === "met" ? "brand" : "warn"} />
                          <div className="mt-1 text-xs text-stone-500">
                            {c.progress.unit === "EUR" || c.progress.unit === "GBP"
                              ? `${money(c.progress.current, c.progress.unit)} of ${money(c.progress.target, c.progress.unit)}`
                              : `${c.progress.current}${c.progress.unit === "%" ? "%" : ""} of ${c.progress.target}${c.progress.unit === "%" ? "%" : ""}`}
                          </div>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ))}
        </div>
        <div className="space-y-4">
          <Card title="Your thresholds">
            <p className="mb-3 text-xs text-stone-500">Defaults come from the chart. Change them to suit your household.</p>
            <div className="space-y-3">
              <Field label="Starter fund floor">{(id) => <MoneyInput id={id} value={t.starterFundFloorMinor} onChange={(v) => setOverride("starterFundFloorMinor", v)} />}</Field>
              <Field label="Starter fund, months of pay">{(id) => <Input id={id} type="number" min={0} step={0.5} value={t.starterFundMonths} onChange={(e) => setOverride("starterFundMonths", Number(e.target.value))} />}</Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Full fund floor (low)">{(id) => <MoneyInput id={id} value={t.fullFundFloorLowMinor} onChange={(v) => setOverride("fullFundFloorLowMinor", v)} />}</Field>
                <Field label="Full fund floor (high)">{(id) => <MoneyInput id={id} value={t.fullFundFloorHighMinor} onChange={(v) => setOverride("fullFundFloorHighMinor", v)} />}</Field>
                <Field label="Months (two incomes)">{(id) => <Input id={id} type="number" min={0} value={t.fullFundMonthsLow} onChange={(e) => setOverride("fullFundMonthsLow", Number(e.target.value))} />}</Field>
                <Field label="Months (one income)">{(id) => <Input id={id} type="number" min={0} value={t.fullFundMonthsHigh} onChange={(e) => setOverride("fullFundMonthsHigh", Number(e.target.value))} />}</Field>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="High interest above (%)">{(id) => <Input id={id} type="number" step={0.5} value={+(t.highAprAbove * 100).toFixed(2)} onChange={(e) => setOverride("highAprAbove", Number(e.target.value) / 100)} />}</Field>
                <Field label="Moderate from (%)">{(id) => <Input id={id} type="number" step={0.5} value={+(t.moderateAprFrom * 100).toFixed(2)} onChange={(e) => setOverride("moderateAprFrom", Number(e.target.value) / 100)} />}</Field>
              </div>
              <Field label="Retirement saving (% of age)" hint="The chart uses half your age.">{(id) => <Input id={id} type="number" step={5} value={Math.round(t.retirementShareOfAge * 100)} onChange={(e) => setOverride("retirementShareOfAge", Number(e.target.value) / 100)} />}</Field>
              <Field label="Base emergency funds on">
                {(id) => (
                  <Select
                    id={id}
                    value={ds.household.settings.fundBasis}
                    onChange={(e) => update((d) => ({ ...d, household: { ...d.household, settings: { ...d.household.settings, fundBasis: e.target.value as "netPay" | "essentialSpend" } } }))}
                    options={[{ value: "netPay", label: `Net pay (${money(snapshot.netMonthlyPayMinor, base)}/month)` }, { value: "essentialSpend", label: `Essential spending (${money(snapshot.essentialMonthlySpendMinor, base)}/month)` }]}
                  />
                )}
              </Field>
              <Button variant="ghost" onClick={() => update((d) => ({ ...d, household: { ...d.household, settings: { ...d.household.settings, thresholdOverrides: {} } } }))}>Reset to chart defaults</Button>
            </div>
          </Card>
        </div>
      </div>
      <Disclaimer />
    </div>
  );
}
