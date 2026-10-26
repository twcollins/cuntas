import { useEffect, useMemo, useState, type FormEvent } from "react";
import { addManualTransaction, cashAccount, isLiability, suggestCategory, topCategories, type Account, type ManualEntry } from "@cuntas/ledger";
import { useAsOf, useCategoryName } from "../lib/derived";
import { money } from "../lib/format";
import { update, useDataset } from "../lib/store";
import { Button, Field, Input, Modal, MoneyInput, Select, cx } from "./ui";

// Quick add: record a spend, money received or a move between accounts from any page,
// in four taps for the usual case (amount, category, Save).

type Kind = ManualEntry["kind"];

const KINDS: { value: Kind; label: string }[] = [
  { value: "spent", label: "Spent" },
  { value: "received", label: "Received" },
  { value: "moved", label: "Moved" },
];

/** The Cash account before it exists: chosen in "Paid from", created on first save. */
const NEW_CASH = "cash:new";
const LAST_ACCOUNT_KEY = "cuntas:quickadd:account";
const CHIPS = 6;

const listeners = new Set<(open: boolean) => void>();

/** Open the quick-add sheet from anywhere. */
export function openQuickAdd() {
  for (const l of listeners) l(true);
}

function readLast(householdId: string): string | null {
  try {
    return localStorage.getItem(`${LAST_ACCOUNT_KEY}:${householdId}`);
  } catch {
    return null;
  }
}

function saveLast(householdId: string, accountId: string) {
  try {
    localStorage.setItem(`${LAST_ACCOUNT_KEY}:${householdId}`, accountId);
  } catch {
    // Storage can be blocked; the default just won't be remembered.
  }
}

/** Accounts money is spent from or paid into: not loans, mortgages or valued assets. */
const SPENDABLE: readonly Account["type"][] = ["current", "savings", "creditCard", "cash", "other"];

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

/** Mounted once in the layout: the sheet, and the N shortcut. */
export function QuickAddHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    listeners.add(setOpen);
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "n" || e.key === "N") && !e.metaKey && !e.ctrlKey && !e.altKey && !isTyping(e.target)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      listeners.delete(setOpen);
      window.removeEventListener("keydown", onKey);
    };
  }, []);
  return (
    <Modal open={open} onClose={() => setOpen(false)} title="Add">
      {open && <QuickAddForm onDone={() => setOpen(false)} />}
    </Modal>
  );
}

function QuickAddForm({ onDone }: { onDone: () => void }) {
  const ds = useDataset();
  const asOf = useAsOf();
  const catName = useCategoryName(ds);
  const hid = ds.household.id;
  const accounts = useMemo(() => ds.accounts.filter((a) => !a.archived && SPENDABLE.includes(a.type) && !(isLiability(a) && a.type !== "creditCard")), [ds.accounts]);
  const cash = cashAccount(ds);
  const fromOptions = [...accounts.map((a) => ({ value: a.id, label: a.name })), ...(cash ? [] : [{ value: NEW_CASH, label: "Cash" }])];
  const defaultFrom = () => {
    const last = readLast(hid);
    return last && fromOptions.some((o) => o.value === last) ? last : (cash?.id ?? NEW_CASH);
  };

  const [kind, setKind] = useState<Kind>("spent");
  const [amount, setAmount] = useState(0);
  const [payee, setPayee] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [picked, setPicked] = useState(false);
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState("");
  const [date, setDate] = useState(asOf);
  const [monthly, setMonthly] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped after "Save and add another" to remount the amount field, which refocuses it.
  const [round, setRound] = useState(0);

  const catKind = kind === "received" ? "income" : "expense";
  const chips = useMemo(() => topCategories(ds, catKind, CHIPS, asOf), [ds, catKind, asOf]);
  const shownChips = categoryId && !chips.includes(categoryId) ? [...chips.slice(0, CHIPS - 1), categoryId] : chips;
  const allOptions = [{ value: "", label: "More…" }, ...ds.categories.filter((c) => c.kind === catKind).map((c) => ({ value: c.id, label: `${c.group}: ${c.name}` }))];
  const toOptions = [{ value: "", label: "Choose an account" }, ...ds.accounts.filter((a) => !a.archived && a.id !== from && a.tracksBalance !== false).map((a) => ({ value: a.id, label: a.name }))];
  const currency = ds.accounts.find((a) => a.id === from)?.currency ?? ds.household.baseCurrency;
  const canSave = amount > 0 && (kind !== "moved" || (to !== "" && from !== NEW_CASH));

  const chooseKind = (k: Kind) => {
    setKind(k);
    setCategoryId(null);
    setPicked(false);
    if (k === "moved") {
      setMonthly(false);
      if (from === NEW_CASH) setFrom(accounts[0]?.id ?? NEW_CASH);
    }
  };

  const onPayee = (value: string) => {
    setPayee(value);
    if (!picked) setCategoryId(suggestCategory(ds, value));
  };

  const save = (another: boolean) => {
    if (!canSave) return;
    const entry: ManualEntry = {
      kind,
      amountMinor: amount,
      date,
      accountId: from === NEW_CASH ? null : from,
      toAccountId: kind === "moved" ? to : null,
      payee,
      categoryId: kind === "moved" ? null : categoryId,
      monthly,
    };
    let recordedOn = from;
    try {
      update((d) => {
        const r = addManualTransaction(d, entry);
        recordedOn = r.accountId;
        return r.dataset;
      });
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    saveLast(hid, recordedOn);
    const what = kind === "moved" ? "Moved" : kind === "received" ? "Received" : "Spent";
    const label = kind === "moved" ? "" : ` · ${catName(categoryId)}`;
    if (!another) {
      onDone();
      return;
    }
    setMessage(`${what} ${money(amount, currency, true)}${label}${monthly ? " · added to Bills" : ""}. Add another:`);
    setError(null);
    setAmount(0);
    setPayee("");
    setCategoryId(null);
    setPicked(false);
    setMonthly(false);
    setFrom(recordedOn);
    setRound(round + 1);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    save(false);
  };

  return (
    <form onSubmit={onSubmit} onKeyDown={(e) => { if (e.key === "Enter" && e.shiftKey) { e.preventDefault(); save(true); } }} className="space-y-4">
      {message && <p role="status" className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-700 dark:bg-brand-900/40 dark:text-brand-100">{message}</p>}
      <div role="radiogroup" aria-label="Kind" className="grid grid-cols-3 rounded-lg border border-stone-200 p-0.5 dark:border-stone-700">
        {KINDS.map((k) => (
          <button key={k.value} type="button" role="radio" aria-checked={kind === k.value} onClick={() => chooseKind(k.value)} className={cx("rounded-md py-1.5 text-sm", kind === k.value ? "bg-brand-600 font-medium text-white" : "text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800")}>
            {k.label}
          </button>
        ))}
      </div>

      <Field key={round} label={`Amount (${currency})`}>{(id) => <MoneyInput id={id} autoFocus value={amount} onChange={setAmount} placeholder="0.00" className="text-2xl font-semibold tabular-nums" />}</Field>

      {kind !== "moved" && (
        <>
          <Field label={kind === "spent" ? "What for (optional)" : "From (optional)"}>{(id) => <Input id={id} value={payee} onChange={(e) => onPayee(e.target.value)} placeholder={kind === "spent" ? "Coffee, Tesco, rent…" : "Who paid you"} autoComplete="off" />}</Field>
          <div>
            <div className="mb-1 text-xs font-medium text-stone-600 dark:text-stone-400">Category</div>
            <div role="group" aria-label="Category" className="flex flex-wrap gap-1.5">
              {shownChips.map((id) => (
                <button key={id} type="button" aria-pressed={categoryId === id} onClick={() => { setCategoryId(categoryId === id ? null : id); setPicked(true); }} className={cx("rounded-full border px-3 py-1 text-sm", categoryId === id ? "border-brand-600 bg-brand-600 text-white" : "border-stone-300 hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800")}>
                  {catName(id)}
                </button>
              ))}
              <Select aria-label="More categories" value="" onChange={(e) => { if (e.target.value) { setCategoryId(e.target.value); setPicked(true); } }} options={allOptions} className="w-36 py-1" />
            </div>
          </div>
        </>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label={kind === "received" ? "Paid into" : "From"}>{(id) => <Select id={id} value={from} onChange={(e) => setFrom(e.target.value)} options={kind === "moved" ? fromOptions.filter((o) => o.value !== NEW_CASH) : fromOptions} />}</Field>
        {kind === "moved" ? (
          <Field label="To">{(id) => <Select id={id} value={to} onChange={(e) => setTo(e.target.value)} options={toOptions} />}</Field>
        ) : (
          <Field label="Date">{(id) => <Input id={id} type="date" value={date} max={asOf} onChange={(e) => setDate(e.target.value || asOf)} />}</Field>
        )}
      </div>
      {kind === "moved" && <Field label="Date">{(id) => <Input id={id} type="date" value={date} max={asOf} onChange={(e) => setDate(e.target.value || asOf)} />}</Field>}
      {kind === "moved" && accounts.length < 2 && <p className="text-sm text-stone-500">Add a second account on the Accounts page to record money moved between them.</p>}

      {kind !== "moved" && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={monthly} onChange={(e) => setMonthly(e.target.checked)} />
          This happens every month (adds it to Bills)
        </label>
      )}

      {error && <p role="alert" className="text-sm text-rose-700 dark:text-rose-400">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={() => save(true)} disabled={!canSave} title="Shift+Enter">Save and add another</Button>
        <Button type="submit" variant="primary" disabled={!canSave}>Save</Button>
      </div>
    </form>
  );
}
