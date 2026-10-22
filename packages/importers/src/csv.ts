import type { Currency } from "@cuntas/rules";
import { assignContentIds } from "./hash";
import { cleanPayee, normaliseHeader, parseAmount, parseCsv, parseDate } from "./parse";
import { PRESETS } from "./presets";
import type { ColumnMapping, CsvPreset, ParsedStatement, ParsedTransaction } from "./types";

/** Finds the most specific preset whose signature headers are all present. */
export function detectPreset(headers: string[]): CsvPreset | undefined {
  const have = new Set(headers.map(normaliseHeader));
  return PRESETS.filter((p) => p.signature.every((s) => have.has(s))).sort((a, b) => b.signature.length - a.signature.length)[0];
}

export function readCsvHeaders(text: string): { headers: string[]; sample: string[][] } {
  const rows = parseCsv(text);
  return { headers: (rows[0] ?? []).map((h) => h.trim()), sample: rows.slice(1, 6) };
}

const asCurrency = (v: string | undefined, fallback: Currency): Currency => (v === "EUR" || v === "GBP" ? v : fallback);

export function importCsv(text: string, mapping?: ColumnMapping & { id?: string }): ParsedStatement {
  const rows = parseCsv(text);
  const headers = (rows[0] ?? []).map((h) => h.trim());
  const preset = mapping ?? detectPreset(headers);
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
  rows.slice(1).forEach((row, n) => {
    const line = n + 2;
    if (preset.where && col(row, preset.where.column) !== preset.where.equals) return;
    const date = parseDate(col(row, preset.date) ?? "", preset.dateFormat);
    let amount: number | null;
    if (preset.amount) {
      amount = parseAmount(col(row, preset.amount) ?? "", preset.decimalComma);
      const fee = preset.fee ? parseAmount(col(row, preset.fee) ?? "", preset.decimalComma) : 0;
      if (amount !== null && fee) amount -= Math.abs(fee);
    } else {
      const debit = parseAmount(col(row, preset.debit) ?? "", preset.decimalComma) ?? 0;
      const credit = parseAmount(col(row, preset.credit) ?? "", preset.decimalComma) ?? 0;
      amount = Math.abs(credit) - Math.abs(debit);
      if (!col(row, preset.debit) && !col(row, preset.credit)) amount = null;
    }
    if (!date || amount === null) {
      warnings.push(`Line ${line}: skipped (unreadable date or amount).`);
      return;
    }
    const rawDescription = preset.description.map((d) => col(row, d)).filter(Boolean).join(" ").trim();
    const balance = preset.balance ? parseAmount(col(row, preset.balance) ?? "", preset.decimalComma) : null;
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
    transactions: assignContentIds(parsed),
    warnings,
  };
}
