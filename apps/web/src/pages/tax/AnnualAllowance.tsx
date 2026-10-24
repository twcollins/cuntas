import { useState } from "react";
import { getPack, listPacks, toMinor, ukAnnualAllowance, ukPayroll } from "@cuntas/rules";
import { Badge, Card, Field, MoneyInput, Select, Stat, Why } from "../../components/ui";
import { money, pct } from "../../lib/format";

/** UK pension annual allowance: taper, carry forward from the three previous years, and the MPAA. */
export function AnnualAllowanceCard() {
  const packs = listPacks("UK").filter((p) => p.pensionAnnualAllowance);
  const [year, setYear] = useState(packs[0]?.taxYear ?? "");
  const [income, setIncome] = useState(toMinor(120000));
  const [personal, setPersonal] = useState(toMinor(20000));
  const [employer, setEmployer] = useState(toMinor(15000));
  const [mpaa, setMpaa] = useState(false);
  const pack = packs.length ? getPack("UK", year) : null;
  const start = Number(year.slice(0, 4));
  const prevYears = [3, 2, 1].map((n) => `${start - n}-${String(start - n + 1).slice(2)}`);
  const [carry, setCarry] = useState<number[]>([0, 0, 0]);
  if (!pack) return null;
  const marginal = ukPayroll(pack, { grossAnnualMinor: income }).marginalRate;
  const threshold = income - personal;
  const r = ukAnnualAllowance(pack, {
    thresholdIncomeMinor: threshold,
    adjustedIncomeMinor: threshold + personal + employer,
    relevantEarningsMinor: income,
    totalContributionsMinor: personal + employer,
    personalContributionsMinor: personal,
    mpaaTriggered: mpaa,
    carryForward: prevYears.map((taxYear, i) => ({ taxYear, unusedMinor: carry[i] ?? 0 })),
    marginalRate: marginal,
  });
  const aa = pack.pensionAnnualAllowance!;
  return (
    <Card title="UK pension annual allowance" actions={<Badge tone={aa.status === "provisional" ? "warn" : "good"}>{pack.version}{aa.status === "provisional" ? " · provisional" : ""}</Badge>}>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Tax year">{(id) => <Select id={id} value={year} onChange={(e) => setYear(e.target.value)} options={packs.map((p) => ({ value: p.taxYear, label: p.taxYear }))} />}</Field>
            <Field label="Income before pension">{(id) => <MoneyInput id={id} value={income} onChange={setIncome} />}</Field>
            <Field label="Your contributions (gross)">{(id) => <MoneyInput id={id} value={personal} onChange={setPersonal} />}</Field>
            <Field label="Employer contributions">{(id) => <MoneyInput id={id} value={employer} onChange={setEmployer} />}</Field>
          </div>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={mpaa} onChange={(e) => setMpaa(e.target.checked)} />I have flexibly drawn from a defined-contribution pension (MPAA applies)</label>
          {!mpaa && (
            <fieldset>
              <legend className="mb-1 text-xs font-medium text-stone-600 dark:text-stone-400">Unused allowance to carry forward</legend>
              <div className="grid grid-cols-3 gap-2">
                {prevYears.map((y, i) => <Field key={y} label={y}>{(id) => <MoneyInput id={id} value={carry[i] ?? 0} onChange={(v) => setCarry(carry.map((c, j) => (j === i ? v : c)))} />}</Field>)}
              </div>
            </fieldset>
          )}
        </div>
        <div className="space-y-3 lg:col-span-2">
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label={r.tapered ? "Tapered allowance" : mpaa ? "MPAA" : "Annual allowance"} value={money(r.annualAllowanceMinor, "GBP")} hint={`Plus ${money(r.carryForwardAvailableMinor, "GBP")} carried forward`} />
            <Stat label="Over the allowance" value={money(r.excessMinor, "GBP")} tone={r.excessMinor > 0 ? "bad" : "good"} hint={r.excessMinor > 0 ? `About ${money(r.estimatedChargeMinor, "GBP")} charge at ${pct(marginal)}` : "No annual allowance charge"} />
            <Stat label="Left this year" value={money(Math.max(0, r.totalAvailableMinor - personal - employer), "GBP")} hint="Including carry forward" />
          </div>
          {r.carryForwardUsed.length > 0 && <p className="text-sm">Carry forward used: {r.carryForwardUsed.map((c) => `${c.taxYear} ${money(c.usedMinor, "GBP")}`).join(", ")}.</p>}
          {r.personalOverReliefLimitMinor > 0 && <p className="text-sm text-amber-700 dark:text-amber-300">{money(r.personalOverReliefLimitMinor, "GBP")} of your contributions is above 100% of earnings and gets no relief.</p>}
          <Why sources={r.lines.flatMap((l) => (l.rule ? [l.rule] : []))}>
            <p>Threshold income is taken as income less your own contributions; adjusted income adds all contributions back.</p>
            {r.notes.map((n) => <p key={n} className="text-amber-700 dark:text-amber-300">{n}</p>)}
          </Why>
        </div>
      </div>
    </Card>
  );
}
