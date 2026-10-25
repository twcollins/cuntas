import { addDays, addMonths, type Currency, type IsoDate } from "@cuntas/rules";
import { balancesByAccount, isLiability } from "./balances";
import { FxTable } from "./fx";
import type { Dataset } from "./schema";

export interface NetWorthPoint {
  date: IsoDate;
  assetsMinor: number;
  liabilitiesMinor: number;
  netMinor: number;
  /** Change since the previous point caused only by exchange-rate moves on non-base balances. */
  fxEffectMinor: number;
  missingFx: boolean;
}

function monthEnd(date: IsoDate): IsoDate {
  return addDays(addMonths(`${date.slice(0, 7)}-01`, 1), -1);
}

/** Net worth at each month end in the base currency, with the FX effect shown separately. */
export function netWorthSeries(ds: Dataset, asOf: IsoDate, months = 12): NetWorthPoint[] {
  const fx = new FxTable(ds.fxRates);
  const base = ds.household.baseCurrency;
  const dates = Array.from({ length: months }, (_, i) => monthEnd(addMonths(asOf, i - months + 1)));
  dates[dates.length - 1] = asOf;
  const accounts = ds.accounts.filter((a) => !a.archived);
  let prevForeign: { currency: string; balance: number }[] | null = null;
  let prevDate: IsoDate | null = null;

  const points = dates.map((date) => {
    const balances = balancesByAccount(ds, date);
    let assets = 0;
    let liabilities = 0;
    let missingFx = false;
    const foreign: { currency: string; balance: number }[] = [];
    for (const a of accounts) {
      const bal = balances.get(a.id) ?? 0;
      const converted = fx.tryConvert(bal, a.currency, base, date);
      if (converted === null) {
        missingFx = true;
        continue;
      }
      if (a.currency !== base) foreign.push({ currency: a.currency, balance: bal });
      if (isLiability(a) || converted < 0) liabilities += -converted;
      else assets += converted;
    }
    let fxEffect = 0;
    if (prevForeign && prevDate) {
      for (const f of prevForeign) {
        const now = fx.tryConvert(f.balance, f.currency as Currency, base, date) ?? 0;
        const then = fx.tryConvert(f.balance, f.currency as Currency, base, prevDate) ?? 0;
        fxEffect += now - then;
      }
    }
    prevForeign = foreign;
    prevDate = date;
    return { date, assetsMinor: assets, liabilitiesMinor: liabilities, netMinor: assets - liabilities, fxEffectMinor: fxEffect, missingFx };
  });
  // Drop the empty months before the household's history begins.
  const first = points.findIndex((p) => p.assetsMinor !== 0 || p.liabilitiesMinor !== 0);
  return first <= 0 ? points : points.slice(first);
}
