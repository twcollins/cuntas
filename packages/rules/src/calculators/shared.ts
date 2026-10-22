import { applyRate } from "../money";

export interface Band {
  upToMinor: number | null;
  rate: number;
}

/** Applies cumulative bands ("upTo" is the top of each band measured from zero). */
export function bandedTax(amountMinor: number, bands: readonly Band[]) {
  let lower = 0;
  return bands.map((band) => {
    const top = band.upToMinor ?? Number.POSITIVE_INFINITY;
    const portionMinor = Math.max(0, Math.min(amountMinor, top) - lower);
    lower = Math.max(lower, top);
    return { rate: band.rate, portionMinor, taxMinor: applyRate(portionMinor, band.rate) };
  });
}
