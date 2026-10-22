import type { Currency, IsoDate } from "@cuntas/rules";

export interface ParsedTransaction {
  bookedAt: IsoDate;
  amountMinor: number;
  currency: Currency;
  payee: string;
  rawDescription: string;
  /** Bank-provided id where available, otherwise a stable content hash so re-imports dedupe. */
  externalId: string;
  balanceMinor?: number;
}

export interface ParsedStatement {
  format: "csv" | "ofx" | "camt053";
  preset?: string;
  account?: { iban?: string; currency?: Currency; number?: string };
  transactions: ParsedTransaction[];
  warnings: string[];
}

export type DateFormat = "DD/MM/YYYY" | "YYYY-MM-DD" | "DD-MM-YYYY" | "DD MMM YYYY" | "MM/DD/YYYY" | "DD.MM.YYYY";

/** A column mapping. Bank presets and the user's column mapper share this shape. */
export interface ColumnMapping {
  date: string;
  dateFormat: DateFormat;
  amount?: string;
  /** Subtracted from amount (e.g. Revolut's Fee column). */
  fee?: string;
  debit?: string;
  credit?: string;
  description: string[];
  payee?: string;
  currency?: string;
  defaultCurrency: Currency;
  externalId?: string;
  balance?: string;
  decimalComma?: boolean;
  /** Keep only rows where this column equals the value (e.g. Revolut State = COMPLETED). */
  where?: { column: string; equals: string };
}

export interface CsvPreset extends ColumnMapping {
  id: string;
  name: string;
  country: "IE" | "UK";
  /** Headers that must all be present (normalised) for auto-detection. */
  signature: string[];
}
