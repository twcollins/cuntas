import type { DateFormat } from "./types";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Parses a money string into minor units: "1,234.56", "-12.30", "(12.30)", "€12", "12,30" with decimalComma. */
export function parseAmount(raw: string, decimalComma = false): number | null {
  let s = raw.trim().replace(/[€£$\s]|EUR|GBP/gi, "");
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.endsWith("-")) {
    negative = true;
    s = s.slice(0, -1);
  }
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith("+")) s = s.slice(1);
  if (/(CR|DR)$/i.test(s)) {
    if (/DR$/i.test(s)) negative = !negative;
    s = s.slice(0, -2);
  }
  s = decimalComma ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  if (!/^\d*\.?\d*$/.test(s) || s === "." ) return null;
  const [whole = "0", frac = ""] = s.split(".");
  const minor = Number(whole || "0") * 100 + Number((frac + "00").slice(0, 2));
  return negative ? -minor : minor;
}

/** Parses a date string into ISO YYYY-MM-DD. */
export function parseDate(raw: string, format: DateFormat): string | null {
  const s = raw.trim().split(/[ T](?=\d{1,2}:)/)[0]!.trim();
  let y: number, m: number, d: number;
  const parts = s.split(/[/\-. ]/).filter(Boolean);
  switch (format) {
    case "YYYY-MM-DD":
      [y, m, d] = parts.map(Number) as [number, number, number];
      break;
    case "DD/MM/YYYY":
    case "DD-MM-YYYY":
    case "DD.MM.YYYY":
      [d, m, y] = parts.map(Number) as [number, number, number];
      break;
    case "MM/DD/YYYY":
      [m, d, y] = parts.map(Number) as [number, number, number];
      break;
    case "DD MMM YYYY": {
      d = Number(parts[0]);
      m = MONTHS.indexOf((parts[1] ?? "").slice(0, 3).toLowerCase()) + 1;
      y = Number(parts[2]);
      break;
    }
  }
  if (y < 100) y += 2000;
  if (!y || !m || !d || m > 12 || d > 31) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF), with delimiter sniffing. */
export function parseCsv(text: string, delimiter?: string): string[][] {
  const src = text.replace(/^\uFEFF/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const delim = delimiter ?? ([",", ";", "\t"].map((c) => [c, firstLine.split(c).length] as const).sort((a, b) => b[1] - a[1])[0]![0]);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

export const normaliseHeader = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

export function cleanPayee(description: string): string {
  return description
    .replace(/\s+/g, " ")
    .replace(/^(POS|VDP|VDC|VDA|D\/D|DD|SO|BGC|FPI|FPO|CARD PAYMENT TO|PAYMENT TO)\s*[-:]?\s*/i, "")
    .replace(/\s+\d{2}\/\d{2}(\/\d{2,4})?$/, "")
    .trim();
}
