import type { Currency } from "@cuntas/rules";
import { assignContentIds } from "./hash";
import { cleanPayee, parseAmount } from "./parse";
import type { ParsedStatement } from "./types";

const tag = (block: string, name: string) => block.match(new RegExp(`<${name}>([^<\\r\\n]*)`, "i"))?.[1]?.trim();

/** OFX 1.x (SGML) and 2.x (XML) bank and credit card statements. */
export function importOfx(text: string): ParsedStatement {
  const cur = tag(text, "CURDEF");
  const currency: Currency = cur === "GBP" ? "GBP" : "EUR";
  const warnings: string[] = [];
  if (cur && cur !== "EUR" && cur !== "GBP") warnings.push(`Currency ${cur} is not supported; treated as EUR.`);
  const blocks = text.match(/<STMTTRN>[\s\S]*?(<\/STMTTRN>|(?=<STMTTRN>)|(?=<\/BANKTRANLIST>))/gi) ?? [];
  const txs = blocks.flatMap((b) => {
    const dt = tag(b, "DTPOSTED");
    const amount = parseAmount(tag(b, "TRNAMT") ?? "");
    if (!dt || amount === null) {
      warnings.push("Skipped a transaction with no date or amount.");
      return [];
    }
    const name = tag(b, "NAME") ?? "";
    const memo = tag(b, "MEMO") ?? "";
    const rawDescription = [name, memo].filter(Boolean).join(" ").trim();
    const fitid = tag(b, "FITID");
    return [{
      bookedAt: `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}`,
      amountMinor: amount,
      currency,
      payee: cleanPayee(name || memo),
      rawDescription,
      ...(fitid ? { externalId: `ofx:${fitid}` } : {}),
    }];
  });
  const acct = tag(text, "ACCTID");
  return {
    format: "ofx",
    account: { currency, ...(acct ? { number: acct } : {}) },
    transactions: assignContentIds(txs),
    warnings,
  };
}
