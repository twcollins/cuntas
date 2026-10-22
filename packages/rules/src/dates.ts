/** ISO dates (YYYY-MM-DD) compare correctly as strings; all date logic here works on them. */
export type IsoDate = string;

export const DAYS_PER_WEEK = 7;
export const WEEKS_PER_YEAR = 52;
export const WEEKS_PER_FORTNIGHT = 2;
export const MONTHS_PER_YEAR = 12;
export const MS_PER_DAY = 86_400_000;
export const FRIDAY = 5;

export function parseIso(date: IsoDate): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1));
}

export function toIso(date: Date): IsoDate {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return toIso(new Date(parseIso(date).getTime() + days * MS_PER_DAY));
}

export function addMonths(date: IsoDate, months: number): IsoDate {
  const d = parseIso(date);
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return toIso(target);
}

export function addYears(date: IsoDate, years: number): IsoDate {
  return addMonths(date, years * MONTHS_PER_YEAR);
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((parseIso(to).getTime() - parseIso(from).getTime()) / MS_PER_DAY);
}

export function monthsBetween(from: IsoDate, to: IsoDate): number {
  const a = parseIso(from);
  const b = parseIso(to);
  let months = (b.getUTCFullYear() - a.getUTCFullYear()) * MONTHS_PER_YEAR + (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) months -= 1;
  return months;
}

export function lastDayOfMonth(year: number, monthIndex: number): IsoDate {
  return toIso(new Date(Date.UTC(year, monthIndex + 1, 0)));
}

/** Age in whole years on a given date. */
export function ageOn(dateOfBirth: IsoDate, on: IsoDate): number {
  const b = parseIso(dateOfBirth);
  const d = parseIso(on);
  let age = d.getUTCFullYear() - b.getUTCFullYear();
  if (d.getUTCMonth() < b.getUTCMonth() || (d.getUTCMonth() === b.getUTCMonth() && d.getUTCDate() < b.getUTCDate())) {
    age -= 1;
  }
  return age;
}

/** Resolves a {monthDay, yearOffset} deadline rule for a tax year starting in `year`. */
export function deadlineFor(year: number, rule: { monthDay: string; yearOffset: number }): IsoDate {
  return `${year + rule.yearOffset}-${rule.monthDay}`;
}

export function yearOf(date: IsoDate): number {
  return parseIso(date).getUTCFullYear();
}

/** Calendar month, 1-12. */
export function monthOf(date: IsoDate): number {
  return parseIso(date).getUTCMonth() + 1;
}

export function today(): IsoDate {
  return toIso(new Date());
}
