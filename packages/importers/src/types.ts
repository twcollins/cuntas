import type { Country, Currency, IsoDate } from "@cuntas/rules";

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
  /** The bank preset id, or `csv:<header key>` for a layout the user mapped by hand. */
  preset?: string;
  /** What the file says about its account, used to pick the account to import into. */
  account?: { iban?: string; currency?: Currency; number?: string; type?: "current" | "creditCard" };
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
  /**
   * Zero-amount rows dated the same as the row before carry more detail for it (AIB puts ATM
   * location, card time and references on follow-on rows). Their text and balance are folded in.
   */
  detailRows?: boolean;
  /** Charges are exported as positive amounts (some US card issuers): flip every sign. */
  invertAmount?: boolean;
  /** The amount is unsigned and this column says which way it went (e.g. Transaction Type = Debit). */
  signFrom?: { column: string; negativeWhen: string };
  /** Skip rows whose column starts with this text (e.g. a "Beginning balance" line). */
  skip?: { column: string; startsWith: string };
  /** Column holding the account or card number, read from the first row that has one. */
  accountNumber?: string;
}

export interface CsvPreset extends ColumnMapping {
  id: string;
  name: string;
  country: Country;
  /** Headers that must all be present (normalised) for auto-detection. */
  signature: string[];
  /**
   * For exports with no header row: the column names to assume, in order. Detection then needs every
   * row to have exactly this many cells, a readable date in `date` and an amount in `amount`.
   */
  headerless?: string[];
  /** The kind of account the export comes from; current when absent. */
  accountType?: "creditCard";
}
