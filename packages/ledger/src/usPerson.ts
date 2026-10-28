import { latestWith, treatyFor, usForeignReporting, yearOf, type IsoDate, type Jurisdiction, type UsPack } from "@cuntas/rules";
import { accountBalance, maxBalanceBetween } from "./balances";
import { FxTable } from "./fx";
import type { Account, Dataset } from "./schema";
import { residenceOn } from "./snapshot";

// What a US person (a citizen anywhere, or anyone living in the US) has to report about money held
// outside the US: FBAR and Form 8938 from the year's highest and year-end balances, funds that are
// PFICs, ISAs that aren't tax-free for US tax, and filing from abroad. Guidance from the figures
// recorded here; the IRS forms decide.

/** Account types that are financial accounts for FBAR. */
const REPORTABLE: readonly Account["type"][] = ["current", "savings", "brokerage", "pension"];
const STATE_KINDS = new Set(["statePensionIE", "statePensionUK"]);

export interface ForeignHolding {
  id: string;
  name: string;
  kind: "account" | "pension";
  country: Jurisdiction;
  currency: string;
  maxMinor: number;
  yearEndMinor: number;
  /** In dollars at the year-end rate; null when no rate is stored. */
  maxUsdMinor: number | null;
  yearEndUsdMinor: number | null;
  joint: boolean;
  /** Funds held through it are PFICs for US tax. */
  pfic: boolean;
  isa: boolean;
}

export interface UsPersonReport {
  memberId: string;
  name: string;
  citizen: boolean;
  residence: Jurisdiction;
  livesAbroad: boolean;
  taxYear: number;
  /** The last day counted: 31 December, or today for this year. */
  through: IsoDate;
  holdings: ForeignHolding[];
  reporting: { fbar: ReturnType<typeof usForeignReporting>["fbar"]; form8938: ReturnType<typeof usForeignReporting>["form8938"]; returnDueAbroad: IsoDate; feieMinor: number } | null;
  missingRates: string[];
  notes: { text: string; source: string }[];
  packVersion: string | null;
}

export function usPersonReports(ds: Dataset, asOf: IsoDate, taxYear = yearOf(asOf)): UsPersonReport[] {
  const start = `${taxYear}-01-01`;
  const yearEnd = `${taxYear}-12-31`;
  const through = asOf < yearEnd ? asOf : yearEnd;
  if (through < start) return [];
  const fx = new FxTable(ds.fxRates);
  const pack: UsPack | undefined = latestWith("US", "foreignReporting", yearEnd) ?? latestWith("US", "foreignReporting", asOf);
  const usd = (minor: number, currency: Account["currency"]) => (currency === "USD" ? minor : fx.tryConvert(minor, currency, "USD", through));
  const out: UsPersonReport[] = [];

  for (const m of ds.members) {
    const residence = residenceOn(ds, m.id, through);
    const citizen = m.nationality.includes("US");
    if (!citizen && residence !== "US") continue;
    const livesAbroad = residence !== "US";
    const holdings: ForeignHolding[] = [];
    const plans = ds.pensionPlans.filter((p) => p.memberId === m.id && p.jurisdiction !== "US" && !STATE_KINDS.has(p.kind));
    for (const a of ds.accounts) {
      if (!a.memberIds.includes(m.id) || a.jurisdiction === "US" || !REPORTABLE.includes(a.type) || a.tracksBalance === false || a.openingDate > through) continue;
      // A pension can be recorded both as an account (for net worth) and as a plan (Pensions page); count the plans then.
      if (a.type === "pension" && plans.length > 0) continue;
      const maxMinor = maxBalanceBetween(a, ds.transactions, start, through);
      const yearEndMinor = accountBalance(a, ds.transactions, through);
      holdings.push({
        id: a.id,
        name: a.name,
        kind: a.type === "pension" ? "pension" : "account",
        country: a.jurisdiction,
        currency: a.currency,
        maxMinor,
        yearEndMinor,
        maxUsdMinor: usd(maxMinor, a.currency),
        yearEndUsdMinor: usd(yearEndMinor, a.currency),
        joint: a.memberIds.length > 1,
        pfic: a.type === "brokerage" || a.wrapper === "InvestmentAccount",
        isa: a.wrapper === "ISA" || a.wrapper === "LISA",
      });
    }
    for (const p of plans) {
      const v = usd(p.valueMinor, p.currency);
      holdings.push({ id: p.id, name: p.name, kind: "pension", country: p.jurisdiction, currency: p.currency, maxMinor: p.valueMinor, yearEndMinor: p.valueMinor, maxUsdMinor: v, yearEndUsdMinor: v, joint: false, pfic: false, isa: false });
    }
    if (holdings.length === 0 && !(citizen && livesAbroad)) continue;

    const missingRates = [...new Set(holdings.filter((h) => h.maxUsdMinor === null).map((h) => h.currency))];
    const priced = (list: ForeignHolding[]) => list.map((h) => ({ maxMinor: Math.max(0, h.maxUsdMinor ?? 0), yearEndMinor: Math.max(0, h.yearEndUsdMinor ?? 0) }));
    let reporting: UsPersonReport["reporting"] = null;
    if (pack) {
      const input = { livesAbroad, filingStatus: m.usFilingStatus, taxYear };
      const accounts = usForeignReporting(pack, { ...input, accounts: priced(holdings.filter((h) => h.kind === "account")) });
      const all = usForeignReporting(pack, { ...input, accounts: priced(holdings) });
      reporting = { fbar: accounts.fbar, form8938: all.form8938, returnDueAbroad: all.returnDueAbroad, feieMinor: all.foreignEarnedIncomeExclusionMinor };
    }

    const notes: UsPersonReport["notes"] = [];
    const treaty = (c: Jurisdiction) => (c === "US" ? null : treatyFor("US", c));
    if (citizen && livesAbroad && pack?.foreignReporting) {
      notes.push({
        text: "As a US citizen you file a US return every year wherever you live, reporting worldwide income. Earned income can be excluded up to the year's limit (Form 2555), or tax paid where you live credited against the US tax (Form 1116); the treaty decides which country taxes each kind of income first.",
        source: pack.foreignReporting.foreignEarnedIncomeExclusion.source,
      });
    }
    const pfic = holdings.filter((h) => h.pfic);
    if (pfic.length) {
      const t = treaty(pfic[0]!.country);
      notes.push({
        text: `${pfic.map((h) => h.name).join(", ")}: funds and ETFs domiciled outside the US are PFICs. Each needs Form 8621 every year and, without a QEF or mark-to-market election, gains and some distributions are taxed at the top rate plus an interest charge. Shares held directly are not PFICs.`,
        source: t?.pfic?.source ?? "https://www.irs.gov/forms-pubs/about-form-8621",
      });
    }
    const isa = holdings.filter((h) => h.isa);
    if (isa.length) {
      notes.push({
        text: `${isa.map((h) => h.name).join(", ")}: an ISA is not tax-free for US tax. Interest, dividends and gains inside it go on the US return each year.`,
        source: treatyFor("US", "UK").isa?.source ?? "https://www.irs.gov/forms-pubs/about-form-8621",
      });
    }
    if (holdings.some((h) => h.kind === "pension")) {
      notes.push({
        text: "Pensions held outside the US count toward Form 8938. Whether one also goes on the FBAR, and how its growth is taxed, depends on the plan and the treaty: check the FBAR instructions and the treaty's pension article.",
        source: "https://www.irs.gov/businesses/small-businesses-self-employed/report-of-foreign-bank-and-financial-accounts-fbar",
      });
    }
    if (holdings.some((h) => h.joint)) {
      notes.push({
        text: "A joint account counts in full for each owner's FBAR. On a joint return, Form 8938's thresholds apply to both spouses' assets together.",
        source: "https://www.irs.gov/instructions/i8938",
      });
    }
    out.push({ memberId: m.id, name: m.name, citizen, residence, livesAbroad, taxYear, through, holdings, reporting, missingRates, notes, packVersion: pack?.version ?? null });
  }
  return out;
}
