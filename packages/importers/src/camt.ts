import { XMLParser } from "fast-xml-parser";
import type { Currency } from "@cuntas/rules";
import { assignContentIds } from "./hash";
import { cleanPayee, parseAmount } from "./parse";
import type { ParsedStatement, ParsedTransaction } from "./types";

type Node = Record<string, unknown>;
const arr = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const get = (o: unknown, path: string): unknown =>
  path.split(".").reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Node)[k] : undefined), o);
const text = (v: unknown): string | undefined =>
  v === undefined || v === null ? undefined : typeof v === "object" ? text((v as Node)["#text"]) : String(v);

/** ISO 20022 camt.053 bank-to-customer statements. */
export function importCamt053(xml: string): ParsedStatement {
  const doc = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false }).parse(xml);
  const stmts = arr(get(doc, "Document.BkToCstmrStmt.Stmt") as Node | Node[]);
  const warnings: string[] = [];
  let account: ParsedStatement["account"];
  const txs: (Omit<ParsedTransaction, "externalId"> & { externalId?: string })[] = [];
  for (const stmt of stmts) {
    const iban = text(get(stmt, "Acct.Id.IBAN"));
    const acctCcy = text(get(stmt, "Acct.Ccy"));
    account = { ...(iban ? { iban } : {}), ...(acctCcy === "EUR" || acctCcy === "GBP" ? { currency: acctCcy } : {}) };
    for (const e of arr(stmt.Ntry as Node | Node[])) {
      const amt = get(e, "Amt") as Node | string;
      const value = parseAmount(text(amt) ?? "");
      const ccy = typeof amt === "object" ? String(amt["@_Ccy"] ?? "") : "";
      const date = text(get(e, "BookgDt.Dt")) ?? text(get(e, "BookgDt.DtTm"))?.slice(0, 10);
      if (value === null || !date) {
        warnings.push("Skipped an entry with no amount or booking date.");
        continue;
      }
      const credit = text(e.CdtDbtInd) === "CRDT";
      const tx = arr(get(e, "NtryDtls.TxDtls") as Node | Node[])[0];
      const party = text(get(tx, credit ? "RltdPties.Dbtr.Nm" : "RltdPties.Cdtr.Nm")) ?? text(get(tx, credit ? "RltdPties.Dbtr.Pty.Nm" : "RltdPties.Cdtr.Pty.Nm"));
      const ustrd = arr(get(tx, "RmtInf.Ustrd") as string | string[]).map(String).join(" ");
      const info = text(e.AddtlNtryInf);
      const rawDescription = [party, ustrd, info].filter(Boolean).join(" ").trim();
      const ref = text(e.AcctSvcrRef) ?? text(e.NtryRef) ?? text(get(tx, "Refs.AcctSvcrRef"));
      txs.push({
        bookedAt: date,
        amountMinor: credit ? Math.abs(value) : -Math.abs(value),
        currency: (ccy === "GBP" ? "GBP" : "EUR") as Currency,
        payee: party ?? cleanPayee(rawDescription),
        rawDescription,
        ...(ref ? { externalId: `camt:${ref}` } : {}),
      });
    }
  }
  return { format: "camt053", ...(account ? { account } : {}), transactions: assignContentIds(txs), warnings };
}
