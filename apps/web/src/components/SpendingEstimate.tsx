import { useState, type FormEvent } from "react";
import { estimateForm, setSpendingEstimate } from "@cuntas/ledger";
import { useAsOf } from "../lib/derived";
import { money } from "../lib/format";
import { update, useDataset } from "../lib/store";
import { Button, Modal, MoneyInput } from "./ui";

// "Roughly what do you spend in a month?": seven lines that stand in for transactions
// until two months of them exist.

export function SpendingEstimateSheet({ open, onClose, saveLabel = "Save", onSaved }: { open: boolean; onClose: () => void; saveLabel?: string; onSaved?: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Monthly spending">
      {open && <EstimateForm onDone={() => { onSaved?.(); onClose(); }} saveLabel={saveLabel} />}
    </Modal>
  );
}

function EstimateForm({ onDone, saveLabel }: { onDone: () => void; saveLabel: string }) {
  const ds = useDataset();
  const asOf = useAsOf();
  const base = ds.household.baseCurrency;
  const [lines, setLines] = useState(() => estimateForm(ds, asOf));
  const total = lines.reduce((a, l) => a + l.amountMinor, 0);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    update((d) => setSpendingEstimate(d, lines, asOf));
    onDone();
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <p className="text-sm text-stone-600 dark:text-stone-400">Roughly what do you spend in a month? A guess is fine. It sets your emergency-fund target and a first budget until you have two months of transactions.</p>
      <div className="space-y-2">
        {lines.map((l, i) => (
          <label key={l.categoryId} className="flex items-center justify-between gap-3 text-sm">
            <span>{l.label}</span>
            <MoneyInput aria-label={l.label} value={l.amountMinor} onChange={(v) => setLines(lines.map((x, j) => (j === i ? { ...x, amountMinor: v } : x)))} placeholder="0" className="w-32 text-right tabular-nums" autoFocus={i === 0} />
          </label>
        ))}
      </div>
      <div className="flex justify-between border-t border-stone-200 pt-2 text-sm font-medium dark:border-stone-700">
        <span>A month</span>
        <span className="tabular-nums" data-testid="estimate-total">{money(total, base)}</span>
      </div>
      <div className="flex justify-end">
        <Button type="submit" variant="primary">{saveLabel}</Button>
      </div>
    </form>
  );
}
