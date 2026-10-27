import { isCurrency, type Currency } from "@cuntas/rules";
import { assignContentIds } from "./hash";
import { cleanPayee, normaliseHeader, parseAmount, parseCsv, parseDate } from "./parse";
import { PRESETS } from "./presets";
import type { ColumnMapping, CsvPreset, DateFormat, ParsedStatement, ParsedTransaction } from "./types";

/** Finds the most specific preset whose signature headers are all present. */
export function detectPreset(headers: string[]): CsvPreset | undefined {
  const have = new Set(headers.map(normaliseHeader));
  return PRESETS.filter((p) => !p.headerless && p.signature.every((s) => have.has(s))).sort((a, b) => b.signature.length - a.signature.length)[0];
}

/** Finds a preset for a file with no header row by checking the shape of every row. */
export function detectHeaderlessPreset(rows: string[][]): CsvPreset | undefined {
  const data = rows.filter((r) => r.some((c) => c.trim()));
  if (data.length === 0) return undefined;
  return PRESETS.find((p) => {
    const cols = p.headerless;
    if (!cols) return false;
    const at = (name?: string) => (name ? cols.findIndex((c) => normaliseHeader(c) === normaliseHeader(name)) : -1);
    const d = at(p.date);
    const a = at(p.amount);
    return data.every((r) => r.length === cols.length && parseDate(r[d]?.trim() ?? "", p.dateFormat) !== null && parseAmount(r[a]?.trim() ?? "", p.decimalComma) !== null);
  });
}

/** The header row, normalised, as a key for remembering a column mapping. */
export function csvHeaderKey(text: string): string {
  return (parseCsv(text)[0] ?? []).map(normaliseHeader).join("|");
}

export function readCsvHeaders(text: string): { headers: string[]; sample: string[][] } {
  const rows = parseCsv(text);
  return { headers: (rows[0] ?? []).map((h) => h.trim()), sample: rows.slice(1, 6) };
}

const HEADER_GUESSES: Record<"date" | "description" | "amount" | "debit" | "credit", RegExp> = {
  date: /date|when/,
  description: /desc|narrative|details|memo|reference|payee|merchant|what/,
  amount: /amount|value|sum/,
  debit: /debit|moneyout|paidout|withdraw|out$/,
  credit: /credit|moneyin|paidin|lodge|deposit|in$/,
};

const DATE_FORMATS: DateFormat[] = ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD", "DD-MM-YYYY", "DD.MM.YYYY", "DD MMM YYYY"];

/** The first date format that reads every sample, trying month first for dollar accounts. */
function guessDateFormat(values: string[], defaultCurrency: Currency): DateFormat {
  const order: DateFormat[] = defaultCurrency === "USD" ? ["MM/DD/YYYY", ...DATE_FORMATS.filter((f) => f !== "MM/DD/YYYY")] : DATE_FORMATS;
  const seen = values.map((v) => v.trim()).filter(Boolean);
  return order.find((f) => seen.length > 0 && seen.every((v) => parseDate(v, f) !== null && sameShape(v, f))) ?? order[0]!;
}

/** Whether a date string is laid out like the format (year first or last), so 2026-09-02 isn't read as DD-MM. */
const sameShape = (v: string, f: DateFormat) => /^\d{4}/.test(v) === f.startsWith("YYYY");

/** A starting column mapping for an unrecognised CSV, guessed from header names and, given sample rows, the date format. */
export function guessMapping(headers: string[], defaultCurrency: Currency, sample: string[][] = []): ColumnMapping {
  const find = (key: keyof typeof HEADER_GUESSES, skip: string[] = []) =>
    headers.find((h) => !skip.includes(h) && HEADER_GUESSES[key].test(normaliseHeader(h)));
  const date = find("date") ?? headers[0] ?? "";
  const debit = find("debit", [date]);
  const credit = find("credit", [date, ...(debit ? [debit] : [])]);
  const used = [date, debit, credit].filter((h): h is string => !!h);
  const description = find("description", used) ?? headers.find((h) => !used.includes(h)) ?? date;
  const split = debit && credit;
  const amount = split ? undefined : (find("amount", [...used, description]) ?? headers.find((h) => ![...used, description].includes(h)));
  const dateValues = sample.map((r) => r[headers.indexOf(date)] ?? "");
  return { date, dateFormat: guessDateFormat(dateValues, defaultCurrency), description: [description], defaultCurrency, ...(split ? { debit, credit } : { amount }) };
}

const asCurrency = (v: string | undefined, fallback: Currency): Currency => (v && isCurrency(v) ? v : fallback);

/** How far down a file to look for the header row, past summary lines some banks put first. */
const HEADER_SEARCH_ROWS = 12;

export function importCsv(text: string, mapping?: ColumnMapping & { id?: string; accountType?: "creditCard" }): ParsedStatement {
  let rows = parseCsv(text);
  let headers = (rows[0] ?? []).map((h) => h.trim());
  let preset: (ColumnMapping & { id?: string; accountType?: "creditCard" }) | undefined = mapping ?? detectPreset(headers);
  if (!preset) {
    // Some exports (Bank of America checking) open with a summary block before the header row.
    for (let i = 1; i < Math.min(rows.length, HEADER_SEARCH_ROWS) && !preset; i++) {
      const found = detectPreset(rows[i]!.map((h) => h.trim()));
      if (found) {
        preset = found;
        rows = rows.slice(i);
        headers = rows[0]!.map((h) => h.trim());
      }
    }
  }
  if (!preset) {
    const headerless = detectHeaderlessPreset(rows);
    if (headerless?.headerless) {
      preset = headerless;
      headers = headerless.headerless;
      rows = [headers, ...rows];
    }
  }
  if (!preset) {
    return { format: "csv", transactions: [], warnings: ["Unrecognised layout: map the columns to import this file."] };
  }
  const index = new Map(headers.map((h, i) => [normaliseHeader(h), i]));
  const col = (row: string[], name?: string) => {
    if (!name) return undefined;
    const i = index.get(normaliseHeader(name));
    return i === undefined ? undefined : row[i]?.trim();
  };

  const warnings: string[] = [];
  const parsed: (Omit<ParsedTransaction, "externalId"> & { externalId?: string })[] = [];
  let number: string | undefined;
  rows.slice(1).forEach((row, n) => {
    const line = n + 2;
    if (preset.where && col(row, preset.where.column) !== preset.where.equals) return;
    if (preset.skip && (col(row, preset.skip.column) ?? "").startsWith(preset.skip.startsWith)) return;
    const date = parseDate(col(row, preset.date) ?? "", preset.dateFormat);
    let amount: number | null;
    if (preset.amount) {
      amount = parseAmount(col(row, preset.amount) ?? "", preset.decimalComma);
      const fee = preset.fee ? parseAmount(col(row, preset.fee) ?? "", preset.decimalComma) : 0;
      if (amount !== null && fee) amount -= Math.abs(fee);
      if (amount !== null && preset.signFrom) amount = (col(row, preset.signFrom.column) ?? "").toLowerCase() === preset.signFrom.negativeWhen.toLowerCase() ? -Math.abs(amount) : Math.abs(amount);
      if (amount !== null && preset.invertAmount) amount = -amount;
    } else {
      const debit = parseAmount(col(row, preset.debit) ?? "", preset.decimalComma) ?? 0;
      const credit = parseAmount(col(row, preset.credit) ?? "", preset.decimalComma) ?? 0;
      amount = Math.abs(credit) - Math.abs(debit);
      if (!col(row, preset.debit) && !col(row, preset.credit)) amount = null;
    }
    number ??= col(row, preset.accountNumber) || undefined;
    if (!date || amount === null) {
      warnings.push(`Line ${line}: skipped (unreadable date or amount).`);
      return;
    }
    const rawDescription = preset.description.map((d) => col(row, d)).filter(Boolean).join(" ").trim();
    const balance = preset.balance ? parseAmount(col(row, preset.balance) ?? "", preset.decimalComma) : null;
    const prev = parsed.at(-1);
    if (preset.detailRows && amount === 0 && prev?.bookedAt === date) {
      prev.rawDescription = [prev.rawDescription, rawDescription].filter(Boolean).join(" ");
      if (balance !== null) prev.balanceMinor = balance;
      return;
    }
    const externalId = preset.externalId ? col(row, preset.externalId) : undefined;
    parsed.push({
      bookedAt: date,
      amountMinor: amount,
      currency: asCurrency(col(row, preset.currency), preset.defaultCurrency),
      payee: col(row, preset.payee) || cleanPayee(rawDescription),
      rawDescription,
      ...(externalId ? { externalId } : {}),
      ...(balance !== null ? { balanceMinor: balance } : {}),
    });
  });

  return {
    format: "csv",
    ...("id" in preset && preset.id ? { preset: preset.id } : {}),
    ...(number || preset.accountType ? { account: { ...(number ? { number } : {}), ...(preset.accountType ? { type: preset.accountType } : {}) } } : {}),
    transactions: assignContentIds(parsed),
    warnings,
  };
}
