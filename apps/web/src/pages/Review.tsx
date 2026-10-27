import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { fileGroup, reviewQueue, undoFile, type FileUndo, type ReviewGroup } from "@cuntas/ledger";
import { Button, Card, cx, Empty, PageHeader, Select } from "../components/ui";
import { useAsOf, useCategoryName } from "../lib/derived";
import { formatDate, money } from "../lib/format";
import { update, useDataset } from "../lib/store";

const UNDO_MS = 10_000;
const SWIPE_PX = 60;

// Uncategorised rows, one merchant at a time, biggest first: one tap files the lot and makes a rule.

export function ReviewPage() {
  const ds = useDataset();
  const asOf = useAsOf();
  const catName = useCategoryName(ds);
  const queue = useMemo(() => reviewQueue(ds, asOf), [ds, asOf]);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [rule, setRule] = useState(true);
  const [undo, setUndo] = useState<{ undo: FileUndo; text: string } | null>(null);
  const base = ds.household.baseCurrency;

  const left = queue.filter((g) => !skipped.has(g.key));
  const group = left[0];
  const rows = queue.reduce((s, g) => s + g.count, 0);

  useEffect(() => {
    if (!undo) return;
    const t = window.setTimeout(() => setUndo(null), UNDO_MS);
    return () => window.clearTimeout(t);
  }, [undo]);

  function file(g: ReviewGroup, categoryId: string) {
    const out: { undo?: FileUndo } = {};
    update((d) => {
      const r = fileGroup(d, g, categoryId, { rule });
      out.undo = r.undo;
      return r.dataset;
    });
    if (out.undo) setUndo({ undo: out.undo, text: `Filed ${g.count === 1 ? "1 transaction" : `${g.count} transactions`} from ${g.name} as ${catName(categoryId)}${rule ? ", with a rule for next time" : ""}.` });
    setRule(true);
  }

  const skip = (g: ReviewGroup) => setSkipped(new Set([...skipped, g.key]));

  // Keys 1–4 file under the matching chip; S skips.
  const fileRef = useRef(file);
  fileRef.current = file;
  const skipRef = useRef(skip);
  skipRef.current = skip;
  useEffect(() => {
    if (!group) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || el.closest("input, select, textarea")) return;
      const n = Number(e.key);
      if (n >= 1 && n <= group.suggestions.length) fileRef.current(group, group.suggestions[n - 1]!);
      else if (e.key.toLowerCase() === "s") skipRef.current(group);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [group]);

  // On a phone, a swipe left skips.
  const touchX = useRef<number | null>(null);

  const undoBar = undo && (
    <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-200 bg-brand-50 p-3 text-sm dark:border-brand-900 dark:bg-brand-900/30">
      <span>{undo.text}</span>
      <Button onClick={() => { const u = undo.undo; update((d) => undoFile(d, u)); setUndo(null); }}>Undo</Button>
    </div>
  );

  if (queue.length === 0) {
    return (
      <div>
        <PageHeader title="Review" />
        {undoBar}
        <Empty title="All caught up">
          Every transaction has a category.{" "}
          <Link to="/budgets" className="font-medium text-brand-700 underline dark:text-brand-500">Set up a budget</Link> or{" "}
          <Link to="/transactions" className="font-medium text-brand-700 underline dark:text-brand-500">see your transactions</Link>.
        </Empty>
      </div>
    );
  }

  const categoryOptions = (g: ReviewGroup) => [
    { value: "", label: "More…" },
    ...[...ds.categories]
      .sort((a, b) => Number(b.kind === (g.direction === "in" ? "income" : "expense")) - Number(a.kind === (g.direction === "in" ? "income" : "expense")))
      .map((c) => ({ value: c.id, label: `${c.group}: ${c.name}` })),
  ];

  return (
    <div className="max-w-2xl pb-20 sm:pb-0">
      <PageHeader
        title="Review"
        subtitle={`${rows} transaction${rows === 1 ? "" : "s"} from ${queue.length} merchant${queue.length === 1 ? "" : "s"} need a category. Biggest first, so the first few cover most of the money.`}
        actions={<Link to="/transactions" className="inline-flex items-center rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:hover:bg-stone-800">Done for now</Link>}
      />
      {undoBar}
      {group ? (
        <Card className="touch-pan-y">
          <div
            onTouchStart={(e) => { touchX.current = e.touches[0]?.clientX ?? null; }}
            onTouchEnd={(e) => {
              const start = touchX.current;
              touchX.current = null;
              const end = e.changedTouches[0]?.clientX;
              if (start !== null && end !== undefined && start - end > SWIPE_PX) skip(group);
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate text-xl font-semibold" aria-label={`Merchant: ${group.name}`}>{group.name}</h2>
                {group.example.toLowerCase() !== group.name.toLowerCase() && <p className="truncate text-xs text-stone-500" title={group.example}>{group.example}</p>}
              </div>
              <Button variant="ghost" onClick={() => skip(group)} title="Skip (S, or swipe left)">Skip</Button>
            </div>
            <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">
              {group.count} transaction{group.count === 1 ? "" : "s"} · {group.direction === "in" ? "money in " : ""}
              <span className="font-medium tabular-nums text-stone-900 dark:text-stone-100">{money(group.totalMinor, base, true)}</span> · {group.start === group.end ? formatDate(group.start) : `${formatDate(group.start)} – ${formatDate(group.end)}`}
            </p>
            <div role="group" aria-label={`Category for ${group.name}`} className="mt-4 flex flex-wrap gap-2">
              {group.suggestions.map((id, i) => (
                <button key={id} type="button" onClick={() => file(group, id)} className="rounded-full border border-stone-300 px-4 py-1.5 text-sm hover:border-brand-600 hover:bg-brand-50 dark:border-stone-700 dark:hover:bg-brand-900/30">
                  {catName(id)}
                  <span aria-hidden className="ml-1.5 hidden text-xs text-stone-400 sm:inline">{i + 1}</span>
                </button>
              ))}
              <Select aria-label="More categories" value="" onChange={(e) => { if (e.target.value) file(group, e.target.value); }} options={categoryOptions(group)} className="w-36" />
            </div>
            <label className="mt-4 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={rule} onChange={(e) => setRule(e.target.checked)} className="h-4 w-4 accent-brand-600" />
              Always use this for {group.name}
            </label>
          </div>
        </Card>
      ) : (
        <Card>
          <p className="text-sm">You skipped the {skipped.size === 1 ? "last merchant" : `last ${skipped.size} merchants`}.</p>
          <Button className="mt-3" onClick={() => setSkipped(new Set())}>Go through them again</Button>
        </Card>
      )}
      {left.length > 1 && (
        <div className="mt-6">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-stone-500">Up next</h3>
          <ul className="divide-y divide-stone-100 text-sm dark:divide-stone-800">
            {left.slice(1, 6).map((g) => (
              <li key={g.key} className="flex justify-between gap-3 py-1.5">
                <span className="truncate">{g.name} <span className="text-stone-500">· {g.count}</span></span>
                <span className={cx("shrink-0 tabular-nums", g.direction === "in" && "text-brand-700 dark:text-brand-500")}>{money(g.totalMinor, base, true)}</span>
              </li>
            ))}
          </ul>
          {left.length > 6 && <p className="mt-1 text-xs text-stone-500">and {left.length - 6} more</p>}
        </div>
      )}
    </div>
  );
}
