import { datasetSchema, type Dataset } from "./schema";

/** Full JSON export. Keys are sorted so exports diff cleanly. */
export function exportJson(ds: Dataset): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sort)
      : v && typeof v === "object"
        ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sort(x)]))
        : v;
  return JSON.stringify(sort(ds), null, 2);
}

export function importJson(text: string): Dataset {
  return datasetSchema.parse(JSON.parse(text));
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV export: one file per entity. Nested fields are JSON-encoded in their cell. */
export function exportCsv(ds: Dataset): Record<string, string> {
  const files: Record<string, string> = {};
  for (const [key, value] of Object.entries(ds)) {
    const rows = Array.isArray(value) ? (value as Record<string, unknown>[]) : key === "household" ? [value as Record<string, unknown>] : null;
    if (!rows) continue;
    const headers = [...new Set(rows.flatMap((r) => Object.keys(r)))].sort();
    files[`${key}.csv`] = [headers.join(","), ...rows.map((r) => headers.map((h) => csvCell(r[h])).join(","))].join("\n") + "\n";
  }
  return files;
}
