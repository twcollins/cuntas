import { importCamt053 } from "./camt";
import { importCsv } from "./csv";
import { importOfx } from "./ofx";
import type { ColumnMapping, ParsedStatement } from "./types";

export * from "./types";
export * from "./parse";
export * from "./hash";
export { PRESETS } from "./presets";
export { detectPreset, importCsv, readCsvHeaders } from "./csv";
export { importOfx } from "./ofx";
export { importCamt053 } from "./camt";

export type FileKind = "csv" | "ofx" | "camt053";

export function detectFileKind(name: string, text: string): FileKind {
  const head = text.slice(0, 2000);
  if (/camt\.053/i.test(head) || /<BkToCstmrStmt/i.test(head)) return "camt053";
  if (/OFXHEADER|<OFX>/i.test(head) || /\.(ofx|qfx)$/i.test(name)) return "ofx";
  return "csv";
}

/** Imports any supported statement file. CSVs use the detected preset unless a mapping is given. */
export function importFile(name: string, text: string, mapping?: ColumnMapping): ParsedStatement {
  switch (detectFileKind(name, text)) {
    case "camt053":
      return importCamt053(text);
    case "ofx":
      return importOfx(text);
    case "csv":
      return importCsv(text, mapping);
  }
}
