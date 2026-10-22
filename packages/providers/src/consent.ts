import { addDays, type IsoDate } from "@cuntas/rules";

/** PSD2 consent lasts 90 days; remind the user a few days before it lapses. */
export const PSD2_CONSENT_DAYS = 90;

export function consentReminderDate(consentExpiresAt: string, daysAhead: number): IsoDate {
  return addDays(consentExpiresAt.slice(0, 10), -daysAhead);
}

export function consentStatus(consentExpiresAt: string, today: IsoDate, daysAhead: number): "active" | "expiring" | "expired" {
  const expires = consentExpiresAt.slice(0, 10);
  if (today >= expires) return "expired";
  if (today >= consentReminderDate(consentExpiresAt, daysAhead)) return "expiring";
  return "active";
}
