import { useMemo, useState } from "react";
import {
  comparePacks,
  listPacks,
  listRegionPacks,
  MANIFEST,
  nextTaxYear,
  nextYearDraft,
  packCheckState,
  packFingerprint,
  packKey,
  packOrigin,
  previousPack,
  packByKey,
  today,
  type FigureRow,
  type RuleFileError,
  type AnyPack,
  listStatePacks,
  parentOf,
  US_STATES,
} from "@cuntas/rules";
import { RulesBanner } from "../components/RulesBanner";
import { Badge, Button, Card, PageHeader, Table } from "../components/ui";
import { download, formatDate } from "../lib/format";
import { addRuleFile, removeRuleFile, saveCheck, useRulePacks } from "../lib/rulepacks";
import { useDataset } from "../lib/store";

/** `perRow`: each pack is its own place (US states), so drafts are offered per row, not per group. */
const GROUPS: { title: string; packs: () => AnyPack[]; perRow?: boolean }[] = [
  { title: "Ireland", packs: () => listPacks("IE") },
  { title: "UK", packs: () => listPacks("UK") },
  { title: "Scotland (income tax bands)", packs: () => listRegionPacks("scotland") },
  { title: "United States (federal)", packs: () => listPacks("US") },
  { title: "US states", packs: () => [...listStatePacks()].sort((a, b) => a.state.localeCompare(b.state) || a.taxYear.localeCompare(b.taxYear)), perRow: true },
];

function draftLabel(p: AnyPack) {
  return `Start ${nextTaxYear(parentOf(p), p.taxYear)} from ${p.taxYear}`;
}

export function TaxRulesPage() {
  const ds = useDataset();
  const rp = useRulePacks();
  const asOf = today();
  const [errors, setErrors] = useState<{ name: string; list: RuleFileError[] } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [review, setReview] = useState<string | null>(null);

  async function onFile(file: File) {
    setMsg(null);
    const result = await addRuleFile(await file.text(), file.name);
    if (!result.ok) {
      setErrors({ name: file.name, list: result.errors });
      return;
    }
    setErrors(null);
    setMsg(`${file.name} loaded as ${result.key}${result.replaced ? ", replacing the file loaded before" : ""}. Check each section below.`);
    setReview(result.key);
  }

  return (
    <div>
      <PageHeader
        title="Tax rules"
        subtitle="The tax figures behind every calculation. Packs ship with the app; you can load a rule file for a new year, check its figures against the sources, and remove it to go back."
      />
      <RulesBanner ds={ds} asOf={asOf} showLink={false} />
      {msg && <p role="status" className="mb-4 rounded-lg bg-brand-50 p-3 text-sm text-brand-800 dark:bg-brand-900/30 dark:text-brand-100">{msg}</p>}
      <div className="space-y-4">
        <Card title="Add rule file">
          <p className="mb-3 text-sm text-stone-600 dark:text-stone-400">
            A rule file is YAML with figures only: the same format the app is built from. Start from a draft below, check each section against its source, then add it here. A file for a year that already has a pack replaces it on this device.
          </p>
          <label className="text-sm">
            <span className="sr-only">Rule file</span>
            <input type="file" accept=".yaml,.yml,text/yaml" aria-label="Rule file" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void onFile(f); }} />
          </label>
          {errors && (
            <div role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-900/30 dark:text-rose-100">
              <p className="mb-1 font-medium">{errors.name} wasn't loaded. Nothing has changed.</p>
              <ul className="space-y-0.5">
                {errors.list.map((e, i) => (
                  <li key={i}>{e.line !== null ? `Line ${e.line}` : "File"}{e.path && <> · <code>{e.path}</code></>}: {e.message}</li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        {review && packByKey(review) && <Review key={`${review}:${rp.revision}`} packKeyToReview={review} onClose={() => setReview(null)} />}

        {GROUPS.map((g) => {
          const packs = g.packs();
          const latest = packs.at(-1);
          return (
            <Card
              key={g.title}
              title={g.title}
              actions={latest && !g.perRow && (
                <Button className="text-xs" onClick={() => { const d = nextYearDraft(packKey(latest), asOf); download(d.filename, d.text, "text/yaml"); }}>
                  {draftLabel(latest)}
                </Button>
              )}
            >
              <Table head={["Tax year", "Version", "Checked", ""]}>
                {packs.map((p) => {
                  const key = packKey(p);
                  const origin = packOrigin(key);
                  const file = rp.files.find((f) => f.key === key);
                  const state = packCheckState(key, rp.checks);
                  return (
                    <tr key={key} className="border-t border-stone-100 dark:border-stone-800">
                      <td className="px-2 py-1.5">{"state" in p ? <>{US_STATES[p.state]} <span className="text-stone-500">{p.taxYear}</span></> : p.taxYear}</td>
                      <td className="px-2 py-1.5">
                        <code className="text-xs">{p.version}</code> <Badge tone={p.status === "verified" ? "good" : "warn"}>{p.status}</Badge>
                        <div className="text-xs text-stone-500">
                          {origin === "file" ? <>Your file {file?.name}</> : "Built in"} · <span className="font-mono" title={packFingerprint(key)}>{packFingerprint(key)?.slice(0, 12)}…</span>
                        </div>
                      </td>
                      <td className="px-2 py-1.5">
                        {state.checked && state.check ? <Badge tone="good">Checked {formatDate(state.check.checkedAt)}</Badge>
                          : state.needsCheck ? <Badge tone="warn">{state.sectionsChecked.length ? `${state.sectionsChecked.length} of ${state.sections.length} sections` : "Not checked yet"}</Badge>
                          : <span className="text-xs text-stone-500">Maintained with the app</span>}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right">
                        <Button variant="ghost" className="text-xs" onClick={() => setReview(key)}>Review</Button>
                        {g.perRow && packs.filter((x) => "state" in x && "state" in p && x.state === p.state).at(-1) === p && (
                          <Button variant="ghost" className="text-xs" onClick={() => { const d = nextYearDraft(key, asOf); download(d.filename, d.text, "text/yaml"); }}>{draftLabel(p)}</Button>
                        )}
                        {origin === "file" && <Button variant="ghost" className="text-xs" onClick={() => { void removeRuleFile(key); if (review === key) setReview(null); setMsg(MANIFEST.some((m) => m.key === key) ? `Removed your file for ${key}. The built-in pack is used again.` : `Removed your file for ${key}. That year uses the latest earlier pack.`); }}>Remove</Button>}
                      </td>
                    </tr>
                  );
                })}
              </Table>
            </Card>
          );
        })}
        <p className="text-xs text-stone-500">
          Rule files are stored on this device and included in the encrypted backup. A file's fingerprint (SHA-256) changes if the file does, and a changed file needs checking again.
        </p>
      </div>
    </div>
  );
}

function change(row: FigureRow): string {
  if (row.before === undefined) return "New";
  if (!row.changed) return "";
  if (typeof row.before === "number" && typeof row.after === "number") {
    const d = Number((row.after - row.before).toFixed(6));
    return d > 0 ? `+${d}` : String(d);
  }
  return "Changed";
}

const show = (v: FigureRow["after"] | undefined) => (v === undefined ? "—" : v === null ? "no limit" : String(v));

function Review({ packKeyToReview: key, onClose }: { packKeyToReview: string; onClose: () => void }) {
  const rp = useRulePacks();
  const pack = packByKey(key)!;
  const prev = previousPack(key);
  const sections = useMemo(() => comparePacks(prev, pack), [prev, pack]);
  const state = packCheckState(key, rp.checks);
  const [ticked, setTicked] = useState<Set<string>>(new Set(state.sectionsChecked));
  const asOf = today();
  const all = sections.map((s) => s.key);

  return (
    <Card
      title={<>Review {pack.version}{prev && <span className="font-normal text-stone-500"> against {prev.taxYear}</span>}</>}
      actions={<Button variant="ghost" className="text-xs" onClick={onClose}>Close</Button>}
    >
      <p className="mb-3 text-sm text-stone-600 dark:text-stone-400">
        Open each source and compare. Tick a section once every figure in it matches. The date and this file's fingerprint are recorded with your ticks.
      </p>
      <div className="space-y-4">
        {sections.map((s) => (
          <section key={s.key} aria-label={s.key} className="rounded-lg border border-stone-200 p-3 dark:border-stone-700">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-2 font-medium">
                <input type="checkbox" checked={ticked.has(s.key)} onChange={(e) => { const next = new Set(ticked); if (e.target.checked) next.add(s.key); else next.delete(s.key); setTicked(next); }} />
                <code>{s.key}</code>
                {s.status && <Badge tone="warn">{s.status}</Badge>}
              </label>
              <a href={s.source} target="_blank" rel="noreferrer" className="truncate text-xs text-brand-700 underline dark:text-brand-500">{s.source}</a>
            </div>
            <Table head={["Figure", prev ? prev.taxYear : "Last year", pack.taxYear, "Change"]}>
              {s.rows.map((r) => (
                <tr key={r.path} className="border-t border-stone-100 dark:border-stone-800">
                  <td className="px-2 py-1"><code className="text-xs">{r.path}</code></td>
                  <td className="px-2 py-1 text-right tabular-nums text-stone-500">{show(r.before)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{show(r.after)}</td>
                  <td className={`px-2 py-1 text-right tabular-nums ${r.changed ? "font-medium text-amber-700 dark:text-amber-300" : ""}`}>{change(r)}</td>
                </tr>
              ))}
            </Table>
          </section>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => { setTicked(new Set(all)); void saveCheck(key, all, asOf); }}>I've checked all of these</Button>
        <Button onClick={() => void saveCheck(key, [...ticked], asOf)}>Save ticks ({ticked.size} of {all.length})</Button>
      </div>
      {state.check && <p className="mt-2 text-xs text-stone-500">Last saved {formatDate(state.check.checkedAt)}: {state.sectionsChecked.length} of {all.length} sections.</p>}
    </Card>
  );
}
