import { useMemo, useState } from "react";
import { residenceOn, residenceWhatIf } from "@cuntas/ledger";
import type { Classification, Jurisdiction } from "@cuntas/rules";
import { Badge, Card, Disclaimer, Empty, Field, PageHeader, Select, Stat } from "../components/ui";
import { useAsOf } from "../lib/derived";
import { money } from "../lib/format";
import { useDataset } from "../lib/store";

const COUNTRY: Record<Jurisdiction, string> = { IE: "Ireland", UK: "the UK" };

function Taxed({ c }: { c: Classification }) {
  return c.taxedBy.length === 0 ? <Badge tone="good">Tax-free</Badge> : <span className="flex flex-wrap gap-1">{c.taxedBy.map((t) => <Badge key={t} tone="info">Taxed in {t}</Badge>)}</span>;
}

export function WhatIfPage() {
  const ds = useDataset();
  const asOf = useAsOf();
  const current = (id: string) => residenceOn(ds, id, asOf);
  const firstHome = ds.members[0] ? current(ds.members[0].id) : "IE";
  const [to, setTo] = useState<Jurisdiction>(firstHome === "IE" ? "UK" : "IE");
  const [selected, setSelected] = useState<string[]>(ds.members.map((m) => m.id));
  const [keepJob, setKeepJob] = useState(false);
  const r = useMemo(() => residenceWhatIf(ds, asOf, { memberIds: selected, to, keepJob }), [ds, asOf, selected, to, keepJob]);
  const changed = r.items.filter((i) => i.changed);
  const same = r.items.filter((i) => !i.changed);

  if (ds.members.length === 0) return <div><PageHeader title="What if we moved" /><Empty title="Add household members first" /></div>;

  return (
    <div>
      <PageHeader title="What if we moved" subtitle="See which pay, pensions, ISAs and accounts would change tax treatment if members of the household moved between Ireland and the UK. Your declared residence isn't changed." />
      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-4">
          <Field label="Move to">{(id) => <Select id={id} className="w-40" value={to} onChange={(e) => setTo(e.target.value as Jurisdiction)} options={[{ value: "UK", label: "The UK" }, { value: "IE", label: "Ireland" }]} />}</Field>
          <fieldset className="text-sm">
            <legend className="mb-1 text-xs font-medium text-stone-600 dark:text-stone-400">Who moves</legend>
            {ds.members.map((m) => (
              <label key={m.id} className="mr-4 inline-flex items-center gap-1">
                <input type="checkbox" checked={selected.includes(m.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, m.id] : selected.filter((x) => x !== m.id))} />
                {m.name} <span className="text-xs text-stone-500">(now {current(m.id)})</span>
              </label>
            ))}
          </fieldset>
          <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={keepJob} onChange={(e) => setKeepJob(e.target.checked)} />Keep current jobs and commute across the border</label>
        </div>
      </Card>

      {r.members.length > 0 && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {r.members.map((m) => (
            <Stat
              key={m.id}
              label={`${m.name}: take-home a year`}
              value={m.from === m.to ? money(m.payBefore.netAnnualMinor, m.payBefore.currency) : <>{money(m.payBefore.netAnnualMinor, m.payBefore.currency)} → {money(m.payAfter.netAnnualMinor, m.payAfter.currency)}</>}
              hint={m.from === m.to ? `Already lives in ${COUNTRY[m.to]}` : keepJob ? `Same job; ${m.payAfter.pack} rules, before any cross-border credit` : `Same gross pay converted to ${m.payAfter.currency}, under ${m.payAfter.pack}`}
            />
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={`Changes treatment (${changed.length})`}>
          {changed.length === 0 ? <p className="text-sm text-stone-500">Nothing recorded changes treatment.</p> : (
            <ul className="space-y-3">
              {changed.map((i, n) => {
                const m = ds.members.find((x) => x.id === i.memberId)!;
                return (
                  <li key={n} className="rounded-lg bg-stone-50 p-3 text-sm dark:bg-stone-800/50">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{i.label} <span className="font-normal text-stone-500">· {m.name}</span></span>
                      <span className="flex items-center gap-2 text-xs"><Taxed c={i.before} /> → <Taxed c={i.after} /></span>
                    </div>
                    <ul className="mt-1 list-disc pl-5 text-stone-600 dark:text-stone-400">{i.after.notes.slice(1).map((x) => <li key={x}>{x}</li>)}</ul>
                    <a className="text-xs underline" href={i.after.reference.source} target="_blank" rel="noreferrer">{i.after.reference.ref}</a>
                  </li>
                );
              })}
            </ul>
          )}
          {same.length > 0 && <p className="mt-3 text-xs text-stone-500">Unchanged: {same.map((i) => i.label).join(", ")}.</p>}
        </Card>

        <Card title="Also check before moving">
          {r.notes.length === 0 ? <p className="text-sm text-stone-500">No one selected moves country.</p> : (
            <ul className="space-y-2 text-sm">
              {r.notes.map((n) => (
                <li key={n.topic} className="flex gap-2">
                  <span aria-hidden className="text-stone-400">•</span>
                  <span>{n.text} <a href={n.source} target="_blank" rel="noreferrer" className="text-xs underline">source</a></span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 text-xs text-stone-500">Tax residence depends on days present and your ties, tested year by year. Cúntas never decides it for you; check the move with Revenue, HMRC or an adviser.</p>
        </Card>
      </div>
      <Disclaimer />
    </div>
  );
}
