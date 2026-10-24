import { addDays, addMonths, addYears, daysBetween, type Currency, type IsoDate } from "@cuntas/rules";
import { categoryMap, isCashflow } from "./spending";
import type { Bill, BillCadence, Dataset } from "./schema";

// Recurring-bill detection: groups outgoing payments by payee and looks for a steady rhythm.

/** Day ranges for each rhythm, wide enough for weekends, bank holidays and short months. */
const CADENCE_DAYS: Record<Exclude<BillCadence, "biennial">, [number, number]> = {
  weekly: [6, 8],
  fortnightly: [13, 15],
  monthly: [26, 35],
  quarterly: [84, 98],
  annual: [350, 380],
};
/** Share of gaps that must fit the rhythm. */
const MIN_FIT = 0.75;
/** A rise of more than this share on the previous payment counts as a price change. */
const PRICE_CHANGE = 0.02;
/** Amounts within this share of the median count as a fixed-price bill. */
const FIXED_PRICE = 0.05;
/** Amounts that swing more than this are shopping, not bills, unless the category is essential (energy, say). */
const VARIABLE_BILL_MAX = 0.25;
/** Overdue by this many cadences means the payment has probably stopped. */
const LAPSED_AFTER = 1.6;

export interface RecurringSeries {
  key: string;
  payee: string;
  accountId: string;
  currency: Currency;
  categoryId: string | null;
  cadence: Exclude<BillCadence, "biennial">;
  occurrences: number;
  firstDate: IsoDate;
  lastDate: IsoDate;
  nextDate: IsoDate;
  lastAmountMinor: number;
  typicalAmountMinor: number;
  annualCostMinor: number;
  fixedPrice: boolean;
  priceChange: { fromMinor: number; toMinor: number; rate: number; on: IsoDate } | null;
  status: "active" | "lapsed";
}

/** Normalises a payee so "NETFLIX.COM 0423" and "Netflix" group together. */
export function recurringKey(payee: string, currency: Currency): string {
  const words = payee
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !["com", "ie", "uk", "www", "ltd", "limited", "plc", "dd", "so"].includes(w));
  return `${words.slice(0, 2).join(" ")}|${currency}`;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
};

export function advance(date: IsoDate, cadence: BillCadence, times = 1): IsoDate {
  switch (cadence) {
    case "weekly":
      return addDays(date, 7 * times);
    case "fortnightly":
      return addDays(date, 14 * times);
    case "monthly":
      return addMonths(date, times);
    case "quarterly":
      return addMonths(date, 3 * times);
    case "annual":
      return addYears(date, times);
    case "biennial":
      return addYears(date, 2 * times);
  }
}

export function perYear(cadence: BillCadence): number {
  return { weekly: 52, fortnightly: 26, monthly: 12, quarterly: 4, annual: 1, biennial: 0.5 }[cadence];
}

/** Finds subscriptions and bills in the ledger, with their next date and any recent price rise. */
export function detectRecurring(ds: Dataset, asOf: IsoDate): RecurringSeries[] {
  const cats = categoryMap(ds);
  const groups = new Map<string, Dataset["transactions"]>();
  for (const t of ds.transactions) {
    if (t.amountMinor >= 0 || t.bookedAt > asOf || !isCashflow(t, cats)) continue;
    const key = recurringKey(t.payee, t.currency);
    if (key.startsWith("|")) continue;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  const dismissed = new Set(ds.recurringDismissed);
  const out: RecurringSeries[] = [];
  for (const [key, txs] of groups) {
    if (dismissed.has(key)) continue;
    const sorted = [...txs].sort((a, b) => a.bookedAt.localeCompare(b.bookedAt));
    // One payment per date: several on the same day (e.g. split orders) are one occurrence.
    const byDate = new Map<string, number>();
    for (const t of sorted) byDate.set(t.bookedAt, (byDate.get(t.bookedAt) ?? 0) - t.amountMinor);
    const dates = [...byDate.keys()];
    if (dates.length < 2) continue;
    const gaps = dates.slice(1).map((d, i) => daysBetween(dates[i]!, d));
    const typicalGap = median(gaps);
    const cadence = (Object.entries(CADENCE_DAYS) as [RecurringSeries["cadence"], [number, number]][]).find(([, [lo, hi]]) => typicalGap >= lo && typicalGap <= hi)?.[0];
    if (!cadence) continue;
    const [lo, hi] = CADENCE_DAYS[cadence];
    const fit = gaps.filter((g) => g >= lo && g <= hi).length / gaps.length;
    const minOccurrences = cadence === "annual" ? 2 : 3;
    if (dates.length < minOccurrences || fit < MIN_FIT) continue;
    // Groceries and fuel recur weekly but vary too much to be a bill.
    const amounts = [...byDate.values()];
    const typical = median(amounts);
    const spread = Math.max(...amounts.map((a) => Math.abs(a - typical))) / typical;
    if ((cadence === "weekly" || cadence === "fortnightly") && spread > FIXED_PRICE) continue;
    const category = sorted.at(-1)!.categoryId ? cats.get(sorted.at(-1)!.categoryId!) : undefined;
    if (spread > VARIABLE_BILL_MAX && !category?.isEssential) continue;

    const last = amounts.at(-1)!;
    const prev = amounts.at(-2)!;
    const earlier = amounts.slice(0, -1);
    const steadyBefore = earlier.every((a) => Math.abs(a - prev) / prev <= FIXED_PRICE);
    const rise = (last - prev) / prev;
    const lastDate = dates.at(-1)!;
    const changeIndex = amounts.findIndex((a, i) => i > 0 && Math.abs(a - amounts[i - 1]!) / amounts[i - 1]! > PRICE_CHANGE);
    const fixedAfterChange = changeIndex > 0 && amounts.slice(changeIndex).every((a) => Math.abs(a - last) / last <= FIXED_PRICE);
    let priceChange: RecurringSeries["priceChange"] = null;
    if (rise > PRICE_CHANGE && steadyBefore) priceChange = { fromMinor: prev, toMinor: last, rate: rise, on: lastDate };
    else if (fixedAfterChange && amounts[changeIndex]! > amounts[changeIndex - 1]! && amounts.slice(0, changeIndex).every((a) => Math.abs(a - amounts[0]!) / amounts[0]! <= FIXED_PRICE)) {
      const from = amounts[changeIndex - 1]!;
      priceChange = { fromMinor: from, toMinor: last, rate: (last - from) / from, on: dates[changeIndex]! };
    }

    let nextDate = advance(lastDate, cadence);
    const overdueDays = daysBetween(lastDate, asOf);
    const status = overdueDays > typicalGap * LAPSED_AFTER ? "lapsed" : "active";
    while (status === "active" && nextDate < asOf) nextDate = advance(nextDate, cadence);
    const latest = sorted.at(-1)!;
    out.push({
      key,
      payee: latest.payee,
      accountId: latest.accountId,
      currency: latest.currency,
      categoryId: latest.categoryId,
      cadence,
      occurrences: dates.length,
      firstDate: dates[0]!,
      lastDate,
      nextDate,
      lastAmountMinor: last,
      typicalAmountMinor: typical,
      annualCostMinor: Math.round(last * perYear(cadence)),
      fixedPrice: priceChange ? amounts.slice(amounts.lastIndexOf(priceChange.fromMinor) + 1).every((a) => Math.abs(a - last) / last <= FIXED_PRICE) : spread <= FIXED_PRICE,
      priceChange,
      status,
    });
  }
  return out.sort((a, b) => b.annualCostMinor - a.annualCostMinor);
}

export interface BillTemplate {
  id: string;
  name: string;
  jurisdiction: "IE" | "UK";
  cadence: BillCadence;
  categoryId: string;
  note: string;
}

/** Irish and UK household bills that are easy to forget because they come once a year or less. */
export const BILL_TEMPLATES: readonly BillTemplate[] = [
  { id: "ie-lpt", name: "Local Property Tax", jurisdiction: "IE", cadence: "annual", categoryId: "cat_lpt", note: "Pay in one go or spread by direct debit or salary deduction; Revenue sends the valuation band." },
  { id: "ie-tv-licence", name: "TV licence", jurisdiction: "IE", cadence: "annual", categoryId: "cat_tv_subs", note: "Renews on the anniversary of the last licence." },
  { id: "ie-motor-tax", name: "Motor tax", jurisdiction: "IE", cadence: "annual", categoryId: "cat_car", note: "Can also be paid quarterly or half-yearly, at a higher total cost." },
  { id: "ie-nct", name: "NCT", jurisdiction: "IE", cadence: "biennial", categoryId: "cat_car", note: "Every two years for most cars; yearly once a car is ten years old." },
  { id: "ie-car-insurance", name: "Car insurance renewal", jurisdiction: "IE", cadence: "annual", categoryId: "cat_car", note: "Quotes are best compared a few weeks before renewal." },
  { id: "ie-health-insurance", name: "Health insurance renewal", jurisdiction: "IE", cadence: "annual", categoryId: "cat_health_insurance", note: "Insurers must send renewal terms before the renewal date; switching is allowed at renewal." },
  { id: "ie-home-insurance", name: "Home insurance renewal", jurisdiction: "IE", cadence: "annual", categoryId: "cat_home_insurance", note: "" },
  { id: "ie-bins", name: "Bin charges", jurisdiction: "IE", cadence: "monthly", categoryId: "cat_water_bins", note: "Service charge plus lift or weight charges, depending on the provider." },
  { id: "uk-council-tax", name: "Council tax", jurisdiction: "UK", cadence: "monthly", categoryId: "cat_lpt", note: "Usually ten monthly instalments from April; twelve on request." },
  { id: "uk-tv-licence", name: "TV licence", jurisdiction: "UK", cadence: "annual", categoryId: "cat_tv_subs", note: "" },
  { id: "uk-vehicle-tax", name: "Vehicle tax", jurisdiction: "UK", cadence: "annual", categoryId: "cat_car", note: "" },
  { id: "uk-mot", name: "MOT", jurisdiction: "UK", cadence: "annual", categoryId: "cat_car", note: "Yearly once a car is three years old (four in Northern Ireland)." },
];

export interface UpcomingBill {
  date: IsoDate;
  name: string;
  amountMinor: number;
  currency: Currency;
  source: "bill" | "detected";
  billId?: string;
  key?: string;
}

/** The next due date on or after asOf for a bill whose stored due date may be in the past. */
export function nextDueOf(bill: Pick<Bill, "nextDue" | "cadence">, asOf: IsoDate): IsoDate {
  let d = bill.nextDue;
  while (d < asOf) d = advance(d, bill.cadence);
  return d;
}

/** Bills and detected recurring payments due between asOf and asOf + days, soonest first. */
export function upcomingBills(ds: Dataset, asOf: IsoDate, days: number): UpcomingBill[] {
  const until = addDays(asOf, days);
  const out: UpcomingBill[] = [];
  for (const b of ds.bills) {
    for (let d = nextDueOf(b, asOf); d <= until; d = advance(d, b.cadence)) out.push({ date: d, name: b.name, amountMinor: b.amountMinor, currency: b.currency, source: "bill", billId: b.id });
  }
  const linked = new Set(ds.bills.map((b) => b.payeeKey).filter(Boolean));
  for (const r of detectRecurring(ds, asOf)) {
    if (r.status !== "active" || linked.has(r.key)) continue;
    for (let d = r.nextDate; d <= until; d = advance(d, r.cadence)) out.push({ date: d, name: r.payee, amountMinor: r.lastAmountMinor, currency: r.currency, source: "detected", key: r.key });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}
