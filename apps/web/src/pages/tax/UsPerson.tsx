import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { usPersonReports, type UsPersonReport } from "@cuntas/ledger";
import { COUNTRY_INFO } from "@cuntas/rules";
import { Badge, Card, Select, Table } from "../../components/ui";
import { useAsOf } from "../../lib/derived";
import { formatDate, money } from "../../lib/format";
import { useDataset } from "../../lib/store";

/** For US citizens anywhere and US residents: FBAR, Form 8938, PFICs, ISAs and filing from abroad. */
export function UsPersonCard() {
  const ds = useDataset();
  const asOf = useAsOf();
  const thisYear = Number(asOf.slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const reports = useMemo(() => usPersonReports(ds, asOf, year), [ds, asOf, year]);
  const anyYear = useMemo(() => reports.length > 0 || usPersonReports(ds, asOf, thisYear - 1).length > 0, [ds, asOf, thisYear, reports.length]);
  if (!anyYear) return null;
  const usd = (minor: number) => money(minor, "USD");

  return (
    <Card
      title="US reporting: accounts outside the US"
      actions={
        <div className="w-36">
          <Select aria-label="Tax year" value={String(year)} onChange={(e) => setYear(Number(e.target.value))} options={[{ value: String(thisYear), label: `${thisYear} so far` }, { value: String(thisYear - 1), label: String(thisYear - 1) }]} />
        </div>
      }
    >
      <p className="mb-3 text-sm text-stone-600 dark:text-stone-400">
        The US taxes its citizens wherever they live and asks every US person to report accounts held elsewhere. This uses each account's highest balance in the year from what's recorded here, in dollars at the latest stored rate; the FBAR itself uses the Treasury's year-end rate.
      </p>
      {reports.length === 0 && <p className="text-sm text-stone-500">Nothing to report for {year}.</p>}
      <div className="space-y-4">
        {reports.map((r) => (
          <Person key={r.memberId} r={r} usd={usd} />
        ))}
      </div>
    </Card>
  );
}

function Person({ r, usd }: { r: UsPersonReport; usd: (minor: number) => string }) {
  const where = r.citizen && r.livesAbroad ? `US citizen living in ${COUNTRY_INFO[r.residence].name}` : r.citizen ? "US citizen" : "US resident";
  const f = r.reporting;
  return (
    <section aria-label={`US reporting for ${r.name}`} className="rounded-lg bg-stone-50 p-3 text-sm dark:bg-stone-800/50">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{r.name} <span className="font-normal text-stone-500">· {where} · counted to {formatDate(r.through)}</span></span>
        {r.packVersion && <Badge tone="warn">{r.packVersion}</Badge>}
      </div>
      {r.missingRates.length > 0 && (
        <p role="alert" className="mb-2 rounded bg-amber-50 p-2 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
          No exchange rate for {r.missingRates.join(", ")} to USD is stored, so those accounts count as $0. <Link to="/settings" className="underline">Update exchange rates</Link>
        </p>
      )}
      {f && (
        <ul className="mb-3 space-y-1">
          <li>
            <Badge tone={f.fbar.required ? "bad" : "good"}>{f.fbar.required ? "FBAR needed" : "No FBAR so far"}</Badge>{" "}
            Highest balances add up to {usd(f.fbar.aggregateMaxMinor)} against {usd(f.fbar.thresholdMinor)}.{f.fbar.required && <> File FinCEN Form 114 online by {formatDate(f.fbar.due)}, extended automatically to {formatDate(f.fbar.extendedDue)}.</>}{" "}
            <a className="text-xs underline" href={f.fbar.source} target="_blank" rel="noreferrer">Source</a>
          </li>
          <li>
            <Badge tone={f.form8938.required ? "bad" : "good"}>{f.form8938.required ? "Form 8938 needed" : "No Form 8938 so far"}</Badge>{" "}
            {usd(f.form8938.yearEndMinor)} at {r.through.endsWith("12-31") ? "year end" : "today"} against {usd(f.form8938.yearEndThresholdMinor)}, highest {usd(f.form8938.maxMinor)} against {usd(f.form8938.anyTimeThresholdMinor)}{r.livesAbroad ? " (the limits for people living abroad)" : ""}.{" "}
            <a className="text-xs underline" href={f.form8938.source} target="_blank" rel="noreferrer">Source</a>
          </li>
          {r.citizen && r.livesAbroad && (
            <li>
              <Badge tone="info">US return</Badge> Due {formatDate(f.returnDueAbroad)} while living abroad (interest runs from April 15). Up to {usd(f.feieMinor)} of earned income can be excluded.
            </li>
          )}
        </ul>
      )}
      {r.holdings.length > 0 && (
        <Table head={["Account", "Country", "Highest", r.through.endsWith("12-31") ? "Year end" : "Today", ""]}>
          {r.holdings.map((h) => (
            <tr key={h.id}>
              <td className="py-1">{h.name}</td>
              <td className="py-1">{h.country}</td>
              <td className="py-1 tabular-nums">{h.maxUsdMinor === null ? "?" : usd(h.maxUsdMinor)}</td>
              <td className="py-1 tabular-nums">{h.yearEndUsdMinor === null ? "?" : usd(h.yearEndUsdMinor)}</td>
              <td className="py-1">
                <span className="flex flex-wrap gap-1">
                  {h.pfic && <Badge tone="bad">PFIC</Badge>}
                  {h.isa && <Badge tone="warn">ISA</Badge>}
                  {h.kind === "pension" && <Badge>pension</Badge>}
                  {h.joint && <Badge>joint</Badge>}
                </span>
              </td>
            </tr>
          ))}
        </Table>
      )}
      {r.notes.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-stone-600 dark:text-stone-400">
          {r.notes.map((n) => (
            <li key={n.text}>
              {n.text} <a className="text-xs underline" href={n.source} target="_blank" rel="noreferrer">Source</a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
