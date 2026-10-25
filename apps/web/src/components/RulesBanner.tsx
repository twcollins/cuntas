import { Link } from "@tanstack/react-router";
import type { Dataset } from "@cuntas/ledger";
import type { IsoDate } from "@cuntas/rules";
import { DISMISS_DAYS, dismissPrompt, useRulePrompts } from "../lib/rulepacks";
import { Button } from "./ui";

/** Prompts to check this year's tax figures, or to add next year's, for the open household. */
export function RulesBanner({ ds, asOf, showLink = true }: { ds: Dataset; asOf: IsoDate; showLink?: boolean }) {
  const prompts = useRulePrompts(ds, asOf);
  if (prompts.length === 0) return null;
  return (
    <div className="mb-4 space-y-2">
      {prompts.map((p) => (
        <div key={p.id} role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-900/30 dark:text-amber-100">
          <span>{p.message}</span>
          <span className="flex gap-2">
            {showLink && <Link to="/tax-rules" className="font-medium underline">Tax rules</Link>}
            {p.dismissible && <Button variant="ghost" className="text-xs" onClick={() => void dismissPrompt(p.id, asOf)}>Hide for {DISMISS_DAYS} days</Button>}
          </span>
        </div>
      ))}
    </div>
  );
}
