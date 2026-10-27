import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { csvHeaderKey, detectFileKind, guessMapping, importFile, PRESETS, readCsvHeaders, type ColumnMapping, type DateFormat, type ParsedStatement } from "@cuntas/importers";
import { applyImports, mappingFor, planImports, rememberMapping, type ImportSummary, type NewAccountSpec } from "@cuntas/ledger";
import { Badge, Button, Card, Field, Input, PageHeader, Select, Table } from "../components/ui";
import { currencyOptions, formatDate, money, moneyExact } from "../lib/format";
import { onOpened, takeOpened } from "../lib/opened";
import { countryForCurrency, termsFor } from "../lib/region";
import { replaceDataset, useDataset } from "../lib/store";
import type { Currency } from "@cuntas/rules";

const DATE_FORMATS: DateFormat[] = ["DD/MM/YYYY", "YYYY-MM-DD", "DD-MM-YYYY", "DD.MM.YYYY", "DD MMM YYYY", "MM/DD/YYYY"];
const NEW = "__new";

interface FileEntry {
  id: number;
  name: string;
  text: string;
  statement: ParsedStatement;
  bankName?: string;
  /** For a CSV with no known layout: its headers, a key for remembering the mapping, and the mapping. */
  columns?: { headers: string[]; key: string; mapping: ColumnMapping; remembered: boolean };
  /** An account id, or NEW with the new account's details. */
  target: string;
  newAccount: NewAccountSpec;
  reason: "number" | "preset" | "name" | "new";
}

const bankNameOf = (s: ParsedStatement) => (s.preset ? PRESETS.find((p) => p.id === s.preset)?.name : undefined);

/**
 * Reads a CSV with the user's column mapping. Its header row stands in for a bank layout, so the
 * account it went into is remembered like a recognised bank's.
 */
const parseWith = (name: string, text: string, key: string, mapping: ColumnMapping): ParsedStatement => ({ ...importFile(name, text, mapping), preset: `csv:${key}` });

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function dateRange(s: ParsedStatement): string | null {
  const dates = s.transactions.map((t) => t.bookedAt).sort();
  if (dates.length === 0) return null;
  return `${formatDate(dates[0]!)} – ${formatDate(dates.at(-1)!)}`;
}

export function ImportPage() {
  const ds = useDataset();
  const terms = termsFor(ds);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [result, setResult] = useState<ImportSummary | null>(null);
  const nextId = useRef(1);
  const input = useRef<HTMLInputElement>(null);

  async function addFiles(list: File[]) {
    if (list.length === 0) return;
    setResult(null);
    const read = await Promise.all(list.map(async (f) => ({ name: f.name, text: await f.text() })));
    setFiles((current) => {
      const parsed = read.map(({ name, text }) => {
        let statement = importFile(name, text);
        let columns: FileEntry["columns"];
        if (detectFileKind(name, text) === "csv" && !statement.preset) {
          const { headers, sample } = readCsvHeaders(text);
          const key = csvHeaderKey(text);
          const kept = mappingFor(ds, key);
          const mapping = kept ?? guessMapping(headers, ds.household.baseCurrency, sample);
          statement = parseWith(name, text, key, mapping);
          columns = { headers, key, mapping, remembered: !!kept };
        }
        return { name, text, statement, columns, bankName: bankNameOf(statement) };
      });
      const plan = planImports(ds, parsed);
      const added = parsed.map((p, i): FileEntry => {
        const t = plan[i]!.target;
        const currency = p.statement.account?.currency ?? p.statement.transactions[0]?.currency ?? ds.household.baseCurrency;
        return {
          ...p,
          id: nextId.current++,
          target: typeof t === "string" ? t : NEW,
          newAccount: typeof t === "string" ? { name: p.bankName ?? p.name.replace(/\.\w+$/, ""), type: p.statement.account?.type ?? "current", currency } : t.new,
          reason: plan[i]!.reason,
        };
      });
      return [...current, ...added];
    });
  }

  // Files dropped anywhere in the app arrive here, now or while the page is open. The ref keeps
  // the listener on the latest dataset.
  const addRef = useRef(addFiles);
  addRef.current = addFiles;
  useEffect(() => {
    void addRef.current(takeOpened("statement"));
    return onOpened(() => void addRef.current(takeOpened("statement")));
  }, []);

  const update = (id: number, change: Partial<FileEntry>) => setFiles((fs) => fs.map((f) => (f.id === id ? { ...f, ...change } : f)));

  function applyMapping(f: FileEntry, mapping: ColumnMapping) {
    update(f.id, { statement: parseWith(f.name, f.text, f.columns!.key, mapping), columns: { ...f.columns!, mapping } });
  }

  const total = files.reduce((a, f) => a + f.statement.transactions.length, 0);

  function doImport() {
    let d = ds;
    for (const f of files) if (f.columns && f.statement.transactions.length > 0) d = rememberMapping(d, f.columns.key, f.columns.mapping);
    const items = files
      .filter((f) => f.statement.transactions.length > 0)
      .map((f) => ({ statement: f.statement, target: f.target === NEW ? { new: { ...f.newAccount, jurisdiction: countryForCurrency(ds, f.newAccount.currency) } } : f.target }));
    const r = applyImports(d, items);
    replaceDataset(r.dataset);
    setResult(r.summary);
    setFiles([]);
  }

  const accountOptions = (f: FileEntry) => [
    ...ds.accounts.filter((a) => !a.archived && a.tracksBalance !== false).map((a) => ({ value: a.id, label: `${a.name} (${a.currency})` })),
    { value: NEW, label: `New: ${f.newAccount.name}` },
  ];

  return (
    <div>
      <PageHeader title="Import" subtitle="Bank statement files, several at once. Re-importing the same file never creates duplicates." />
      <div className="space-y-4">
        {result && <ImportResult summary={result} />}

        <Card>
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="flex w-full flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-stone-300 px-4 py-8 text-center hover:border-brand-600 hover:bg-brand-50 dark:border-stone-700 dark:hover:bg-stone-800"
          >
            <span className="font-medium">Drop bank files here, or <span className="text-brand-700 underline dark:text-brand-500">choose files</span></span>
            <span className="text-sm text-stone-500">CSV, OFX, QFX or CAMT.053 · several at once · you can drop them on any page</span>
          </button>
          <input ref={input} type="file" multiple accept=".csv,.ofx,.qfx,.xml,.txt" aria-label="Statement files" className="sr-only" onChange={(e) => { void addFiles([...(e.target.files ?? [])]); e.target.value = ""; }} />
        </Card>

        {files.length > 0 && (
          <Card title={plural(files.length, "file")}>
            <ul className="divide-y divide-stone-100 dark:divide-stone-800">
              {files.map((f) => (
                <li key={f.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
                    <div className="min-w-0 flex-1 basis-56">
                      <div className="truncate font-medium">{f.name}</div>
                      <div className="mt-1 flex flex-wrap gap-1.5 text-sm">
                        {f.bankName ? <Badge tone="good">Detected: {f.bankName}</Badge> : f.columns ? <Badge tone="warn">{f.columns.remembered ? "Columns as last time" : "Check the columns"}</Badge> : <Badge tone="info">{f.statement.format.toUpperCase()}</Badge>}
                        <Badge>{plural(f.statement.transactions.length, "row")}</Badge>
                        {dateRange(f.statement) && <span className="text-stone-500">{dateRange(f.statement)}</span>}
                      </div>
                    </div>
                    <div className="w-full space-y-2 sm:w-96">
                      <Select aria-label={`Account for ${f.name}`} value={f.target} onChange={(e) => update(f.id, { target: e.target.value })} options={accountOptions(f)} />
                      {f.target === NEW && (
                        <div className="flex gap-2">
                          <Input aria-label={`New account name for ${f.name}`} value={f.newAccount.name} onChange={(e) => update(f.id, { newAccount: { ...f.newAccount, name: e.target.value } })} />
                          <Select aria-label={`Account type for ${f.name}`} className="w-40 shrink-0" value={f.newAccount.type} onChange={(e) => update(f.id, { newAccount: { ...f.newAccount, type: e.target.value as NewAccountSpec["type"] } })} options={[{ value: "current", label: terms.currentAccount }, { value: "creditCard", label: "Credit card" }]} />
                        </div>
                      )}
                    </div>
                    <Button aria-label={`Remove ${f.name}`} className="px-2" onClick={() => setFiles((fs) => fs.filter((x) => x.id !== f.id))}>✕</Button>
                  </div>
                  {f.statement.warnings.length > 0 && (
                    <ul className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                      {f.statement.warnings.slice(0, 3).map((w) => <li key={w}>{w}</li>)}
                      {f.statement.warnings.length > 3 && <li>and {f.statement.warnings.length - 3} more</li>}
                    </ul>
                  )}
                  {f.columns && <ColumnMapper file={f} onChange={(m) => applyMapping(f, m)} />}
                </li>
              ))}
            </ul>
            <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-stone-100 pt-4 dark:border-stone-800">
              <Button variant="primary" disabled={total === 0} onClick={doImport}>Import {plural(total, "transaction")}</Button>
              <span className="text-sm text-stone-500">Anything already imported is skipped.</span>
            </div>
          </Card>
        )}

        {files.length === 0 && !result && (
          <p className="text-xs text-stone-500">Recognised banks: {PRESETS.map((p) => p.name).join(", ")}. Any other layout can be mapped by hand, and the mapping is kept for next time.</p>
        )}
      </div>
    </div>
  );
}

function ImportResult({ summary: s }: { summary: ImportSummary }) {
  const ds = useDataset();
  const base = ds.household.baseCurrency;
  const extras = [
    s.skipped > 0 && `${s.skipped} already imported (skipped)`,
    s.merged > 0 && `${s.merged} matched to ones you added by hand`,
    s.transfers > 0 && `${plural(s.transfers, "transfer")} between your accounts matched`,
  ].filter(Boolean);
  return (
    <Card title="Import done">
      <p role="status" className="text-lg font-semibold">Imported {plural(s.added, "transaction")} from {plural(s.files, "file")}</p>
      {extras.length > 0 && <p className="mt-1 text-sm text-stone-500">{extras.join(" · ")}</p>}
      {s.added > 0 && (
        <ul className="mt-3 space-y-1.5 text-sm">
          {s.categorised > 0 && <li><span aria-hidden className="text-brand-600">✔ </span>{s.categorised} categorised automatically</li>}
          {s.uncategorised > 0 && (
            <li>
              <span aria-hidden className="text-amber-500">● </span>{s.uncategorised} need a category ·{" "}
              <Link to="/review" className="font-medium text-brand-700 underline dark:text-brand-500">Review now</Link>
            </li>
          )}
          {s.start && s.end && s.spentMinor > 0 && (
            <li>
              Spending {formatDate(s.start)} – {formatDate(s.end)}: <span className="font-medium tabular-nums">{money(s.spentMinor, base)}</span> ·{" "}
              <Link to="/budgets" className="font-medium text-brand-700 underline dark:text-brand-500">Set up a budget from this</Link>
            </li>
          )}
        </ul>
      )}
      {s.warnings.length > 0 && <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">{plural(s.warnings.length, "warning")}: {s.warnings.slice(0, 2).join(" ")}</p>}
    </Card>
  );
}

function ColumnMapper({ file, onChange }: { file: FileEntry; onChange: (m: ColumnMapping) => void }) {
  const { headers, mapping } = file.columns!;
  const colOptions = [{ value: "", label: "—" }, ...headers.map((h) => ({ value: h, label: h }))];
  return (
    <details className="mt-3 rounded-lg border border-stone-200 p-3 dark:border-stone-800" open={file.statement.transactions.length === 0 || !file.columns!.remembered}>
      <summary className="cursor-pointer text-sm font-medium">Columns</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Date column">{(id) => <Select id={id} value={mapping.date} onChange={(e) => onChange({ ...mapping, date: e.target.value })} options={colOptions} />}</Field>
        <Field label="Date format">{(id) => <Select id={id} value={mapping.dateFormat} onChange={(e) => onChange({ ...mapping, dateFormat: e.target.value as DateFormat })} options={DATE_FORMATS.map((f) => ({ value: f, label: f }))} />}</Field>
        <Field label="Description column">{(id) => <Select id={id} value={mapping.description[0] ?? ""} onChange={(e) => onChange({ ...mapping, description: [e.target.value] })} options={colOptions} />}</Field>
        <Field label="Amount column (signed)">{(id) => <Select id={id} value={mapping.amount ?? ""} onChange={(e) => onChange({ ...mapping, amount: e.target.value || undefined })} options={colOptions} />}</Field>
        <Field label="Or: money out column">{(id) => <Select id={id} value={mapping.debit ?? ""} onChange={(e) => onChange({ ...mapping, debit: e.target.value || undefined, amount: e.target.value ? undefined : mapping.amount })} options={colOptions} />}</Field>
        <Field label="Money in column">{(id) => <Select id={id} value={mapping.credit ?? ""} onChange={(e) => onChange({ ...mapping, credit: e.target.value || undefined })} options={colOptions} />}</Field>
        <Field label="Currency">{(id) => <Select id={id} value={mapping.defaultCurrency} onChange={(e) => onChange({ ...mapping, defaultCurrency: e.target.value as Currency })} options={currencyOptions()} />}</Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={!!mapping.decimalComma} onChange={(e) => onChange({ ...mapping, decimalComma: e.target.checked })} />Decimal comma (1.234,56)</label>
      </div>
      <div className="mt-3">
        {file.statement.transactions.length === 0 ? (
          <p className="text-sm text-stone-500">No rows read yet: pick the date and amount columns.</p>
        ) : (
          <Table head={["Date", "Description", "Amount"]}>
            {file.statement.transactions.slice(0, 5).map((t) => (
              <tr key={t.externalId}>
                <td className="whitespace-nowrap px-2 py-1.5 text-stone-500">{formatDate(t.bookedAt)}</td>
                <td className="px-2 py-1.5">{t.payee}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{moneyExact(t.amountMinor, t.currency)}</td>
              </tr>
            ))}
          </Table>
        )}
      </div>
    </details>
  );
}
