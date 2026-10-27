import { Link } from "@tanstack/react-router";
import { formatDate } from "../lib/format";
import { backupDue, hideBackupReminder, useActiveEntry } from "../lib/store";
import { Button } from "./ui";

// This device is the only copy for most people. A month after the last backup, once the household
// has changed, Overview asks for one.

export function BackupReminder() {
  const entry = useActiveEntry();
  if (!entry || !backupDue(entry, new Date())) return null;
  return (
    <div role="region" aria-label="Back up this household" className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm dark:border-amber-900 dark:bg-amber-900/20">
      <div className="min-w-0 flex-1">
        <p className="font-medium">Back up this household</p>
        <p className="text-stone-600 dark:text-stone-400">
          {entry.backedUpAt ? `Last backed up ${formatDate(entry.backedUpAt.slice(0, 10))}` : "Not backed up yet"}. It lives only on this device, so a lost or reset phone loses it.
        </p>
      </div>
      <Link to="/settings" hash="backup" className="rounded-lg bg-brand-600 px-3 py-2 font-medium text-white hover:bg-brand-700">Back up now</Link>
      <Button variant="ghost" onClick={hideBackupReminder}>Not now</Button>
    </div>
  );
}
