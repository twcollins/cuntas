import { addDays, chartDefaults, daysBetween } from "@cuntas/rules";
import { formatDate } from "./format";

export function consentStatusLabel(status: string, expiresAt: string | null, today: string): string {
  if (status !== "active" || !expiresAt) return status === "expired" ? "Consent expired: reconnect" : status;
  const days = daysBetween(today, expiresAt.slice(0, 10));
  const remind = addDays(expiresAt.slice(0, 10), -chartDefaults().reminders.consentDaysAhead);
  if (days <= 0) return "Consent expired: reconnect";
  if (today >= remind) return `Consent expires in ${days} days: renew now`;
  return `Consent until ${formatDate(expiresAt.slice(0, 10))}`;
}
