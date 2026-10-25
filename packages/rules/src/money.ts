/** Supported currencies. ECB reference rates are quoted against EUR, so any pair converts via EUR. */
export const CURRENCIES = ["EUR", "GBP", "USD"] as const;
export type Currency = (typeof CURRENCIES)[number];

export const CURRENCY_NAMES: Record<Currency, string> = { EUR: "Euro", GBP: "Sterling", USD: "US dollar" };

export function isCurrency(value: string): value is Currency {
  return (CURRENCIES as readonly string[]).includes(value);
}

/** Minor units per major unit; 100 for every supported currency. */
export const MINOR_PER_MAJOR = 100;

const PPM = 1_000_000;

/** Converts a rule-pack value in major units (e.g. 46500) to integer minor units. */
export function toMinor(major: number): number {
  return Math.round(major * MINOR_PER_MAJOR);
}

export function toMajor(minor: number): number {
  return minor / MINOR_PER_MAJOR;
}

function roundHalfUpDiv(numerator: number, denominator: number): number {
  const sign = Math.sign(numerator);
  return sign * Math.floor((Math.abs(numerator) + denominator / 2) / denominator);
}

/**
 * Multiplies integer minor units by a decimal rate using integer arithmetic.
 * The rate is snapped to parts-per-million so 0.0435 never becomes 0.043499999.
 */
export function applyRate(amountMinor: number, rate: number): number {
  const ppm = Math.round(rate * PPM);
  return roundHalfUpDiv(amountMinor * ppm, PPM);
}

/** Integer division of minor units, rounding half up. */
export function divideMinor(amountMinor: number, divisor: number): number {
  return roundHalfUpDiv(amountMinor, divisor);
}

/** Splits an amount into n parts that sum exactly to the amount (earlier parts take the remainder cents). */
export function splitEvenly(amountMinor: number, parts: number): number[] {
  const base = Math.floor(amountMinor / parts);
  const remainder = amountMinor - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < remainder ? 1 : 0));
}

export function clampMinor(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function sumMinor(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

const symbols: Record<Currency, string> = { EUR: "€", GBP: "£", USD: "$" };

export function formatMoney(
  minor: number,
  currency: Currency,
  opts: { decimals?: boolean; signed?: boolean } = {},
): string {
  const decimals = opts.decimals ?? true;
  const abs = Math.abs(minor) / MINOR_PER_MAJOR;
  const body = abs.toLocaleString("en-IE", {
    minimumFractionDigits: decimals ? 2 : 0,
    maximumFractionDigits: decimals ? 2 : 0,
  });
  const sign = minor < 0 ? "−" : opts.signed && minor > 0 ? "+" : "";
  return `${sign}${symbols[currency]}${body}`;
}

/** Formats a decimal rate as a percentage, e.g. 0.0435 -> "4.35%". */
export function formatRate(rate: number): string {
  return `${Number((rate * MINOR_PER_MAJOR).toFixed(3))}%`;
}
