import { useState } from "react";
import { detectFileKind, guessMapping, importFile, PRESETS, readCsvHeaders, type ColumnMapping, type DateFormat, type ParsedStatement } from "@cuntas/importers";
import { importStatement, newId } from "@cuntas/ledger";
import { Badge, Button, Card, Field, Input, PageHeader, Select, Table } from "../components/ui";
import { useAsOf } from "../lib/derived";
import { formatDate, moneyExact } from "../lib/format";
import { replaceDataset, useDataset } from "../lib/store";

const DATE_FORMATS: DateFormat[] = ["DD/MM/YYYY", "YYYY-MM-DD", "DD-MM-YYYY", "DD.MM.YYYY", "DD MMM YYYY", "MM/DD/YYYY"];

export function ImportPage() {
  const ds = useDataset();
  const asOf = useAsOf();
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [parsed, setParsed] = useState<ParsedStatement | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [accountId, setAccountId] = useState(ds.accounts.find((a) => !a.archived && a.type === "current")?.id ?? "__new");
  const [newName, setNewName] = useState("");
  const [result, setResult] = useState<string | null>(null);

  async function onFile(f: File) {
    const text = await f.text();
    setFile({ name: f.name, text });
    setResult(null);
    const p = importFile(f.name, text);
    setParsed(p);
    if (detectFileKind(f.name, text) === "csv" && !p.preset) {
      const h = readCsvHeaders(text).headers;
      setHeaders(h);
      const m = guessMapping(h, ds.household.baseCurrency);
      setMapping(m);
      setParsed(importFile(f.name, text, m));
    } else {
      setMapping(null);
    }
    setNewName(p.preset ? (PRESETS.find((x) => x.id === p.preset)?.name ?? f.name) : (p.account?.iban ?? f.name.replace(/\.\w+$/, "")));
  }

  function applyMapping(m: ColumnMapping) {
    setMapping(m);
    if (file) setParsed(importFile(file.name, file.text, m));
  }

  function doImport() {
    if (!parsed) return;
    let d = ds;
    let target = accountId;
    if (target === "__new") {
      const currency = parsed.account?.currency ?? parsed.transactions[0]?.currency ?? ds.household.baseCurrency;
      const first = parsed.transactions.map((t) => t.bookedAt).sort()[0] ?? asOf;
      const acc = { id: newId("acc"), name: newName || "Imported account", memberIds: ds.members.map((m) => m.id), type: "current" as const, currency, institutionId: null, wrapper: "none" as const, jurisdiction: currency === "GBP" ? ("UK" as const) : ("IE" as const), openingBalanceMinor: 0, openingDate: first, valuations: [], isEmergencyFund: false, archived: false };
      d = { ...d, accounts: [...d.accounts, acc] };
      target = acc.id;
    }
    const r = importStatement(d, target, parsed);
    replaceDataset(r.dataset);
    setAccountId(target);
    setResult(`Imported ${r.added} new transaction${r.added === 1 ? "" : "s"}${r.skipped ? `; skipped ${r.skipped} already imported` : ""}.${r.warnings.length ? ` ${r.warnings.length} warning(s).` : ""}`);
  }

  const colOptions = [{ value: "", label: "—" }, ...headers.map((h) => ({ value: h, label: h }))];

  return (
    <div>
      <PageHeader title="Import" subtitle="CSV, OFX or CAMT.053 files. Re-importing the same file never creates duplicates." />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="1. Choose a file">
            <input type="file" accept=".csv,.ofx,.qfx,.xml,.txt" aria-label="Statement file" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} className="text-sm" />
            {parsed && (
              <div className="mt-3 flex flex-wrap gap-2 text-sm">
                <Badge tone="info">{parsed.format.toUpperCase()}</Badge>
                {parsed.preset && <Badge tone="good">Detected: {PRESETS.find((p) => p.id === parsed.preset)?.name}</Badge>}
                <Badge>{parsed.transactions.length} transactions</Badge>
                {parsed.warnings.map((w) => <Badge key={w} tone="warn">{w}</Badge>)}
              </div>
            )}
          </Card>

          {mapping && (
            <Card title="Map the columns">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Date column">{(id) => <Select id={id} value={mapping.date} onChange={(e) => applyMapping({ ...mapping, date: e.target.value })} options={colOptions} />}</Field>
                <Field label="Date format">{(id) => <Select id={id} value={mapping.dateFormat} onChange={(e) => applyMapping({ ...mapping, dateFormat: e.target.value as DateFormat })} options={DATE_FORMATS.map((f) => ({ value: f, label: f }))} />}</Field>
                <Field label="Amount column (signed)">{(id) => <Select id={id} value={mapping.amount ?? ""} onChange={(e) => applyMapping({ ...mapping, amount: e.target.value || undefined })} options={colOptions} />}</Field>
                <Field label="Description column">{(id) => <Select id={id} value={mapping.description[0] ?? ""} onChange={(e) => applyMapping({ ...mapping, description: [e.target.value] })} options={colOptions} />}</Field>
                <Field label="Or: money out column">{(id) => <Select id={id} value={mapping.debit ?? ""} onChange={(e) => applyMapping({ ...mapping, debit: e.target.value || undefined, amount: e.target.value ? undefined : mapping.amount })} options={colOptions} />}</Field>
                <Field label="Money in column">{(id) => <Select id={id} value={mapping.credit ?? ""} onChange={(e) => applyMapping({ ...mapping, credit: e.target.value || undefined })} options={colOptions} />}</Field>
                <Field label="Currency">{(id) => <Select id={id} value={mapping.defaultCurrency} onChange={(e) => applyMapping({ ...mapping, defaultCurrency: e.target.value as "EUR" | "GBP" })} options={[{ value: "EUR", label: "EUR" }, { value: "GBP", label: "GBP" }]} />}</Field>
                <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={!!mapping.decimalComma} onChange={(e) => applyMapping({ ...mapping, decimalComma: e.target.checked })} />Decimal comma (1.234,56)</label>
              </div>
            </Card>
          )}

          {parsed && parsed.transactions.length > 0 && (
            <Card title="Preview">
              <Table head={["Date", "Description", "Amount"]}>
                {parsed.transactions.slice(0, 8).map((t) => (
                  <tr key={t.externalId}>
                    <td className="px-2 py-1.5 text-stone-500">{formatDate(t.bookedAt)}</td>
                    <td className="px-2 py-1.5">{t.payee}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{moneyExact(t.amountMinor, t.currency)}</td>
                  </tr>
                ))}
              </Table>
            </Card>
          )}
        </div>

        <Card title="2. Import into">
          <div className="space-y-3">
            <Field label="Account">{(id) => <Select id={id} value={accountId} onChange={(e) => setAccountId(e.target.value)} options={[...ds.accounts.filter((a) => !a.archived).map((a) => ({ value: a.id, label: `${a.name} (${a.currency})` })), { value: "__new", label: "New account…" }]} />}</Field>
            {accountId === "__new" && <Field label="New account name">{(id) => <Input id={id} value={newName} onChange={(e) => setNewName(e.target.value)} />}</Field>}
            <Button variant="primary" disabled={!parsed || parsed.transactions.length === 0} onClick={doImport}>Import transactions</Button>
            {result && <p role="status" className="text-sm text-brand-700 dark:text-brand-500">{result}</p>}
          </div>
          <div className="mt-6 text-xs text-stone-500">
            <p className="mb-1 font-medium">Bank presets</p>
            <p>{PRESETS.map((p) => p.name).join(", ")}. Any other layout can be mapped by hand.</p>
          </div>
        </Card>
      </div>
    </div>
  );
}
