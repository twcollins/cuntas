import { useEffect, useId, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";
import type { RuleRef } from "@cuntas/rules";
import { minorToInput, parseMoneyInput } from "../lib/format";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, children, className, actions }: { title?: ReactNode; children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <section className={cx("rounded-xl border border-stone-200 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-stone-900", className)}>
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="text-base font-semibold">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
      <div className="text-xs font-medium uppercase tracking-wide text-stone-500 dark:text-stone-400">{label}</div>
      <div className={cx("mt-1 text-2xl font-semibold tabular-nums", tone === "good" && "text-brand-600 dark:text-brand-500", tone === "bad" && "text-rose-600 dark:text-rose-400")}>{value}</div>
      {hint && <div className="mt-1 text-xs text-stone-500 dark:text-stone-400">{hint}</div>}
    </div>
  );
}

type Variant = "primary" | "secondary" | "ghost" | "danger";
export function Button({ variant = "secondary", className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const styles: Record<Variant, string> = {
    primary: "bg-brand-600 text-white hover:bg-brand-700 disabled:bg-stone-400",
    secondary: "border border-stone-300 bg-white hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:hover:bg-stone-800",
    ghost: "hover:bg-stone-100 dark:hover:bg-stone-800",
    danger: "bg-rose-600 text-white hover:bg-rose-700 disabled:bg-stone-400",
  };
  return <button type="button" className={cx("inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed", styles[variant], className)} {...props} />;
}

const inputCls = "rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 dark:border-stone-700 dark:bg-stone-900 dark:focus:ring-brand-900";

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-xs font-medium text-stone-600 dark:text-stone-400">{label}</label>
      {children(id)}
      {hint && <p className="text-xs text-stone-500">{hint}</p>}
    </div>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputCls, !props.className?.includes("w-") && "w-full", props.className)} />;
}

export function Select({ options, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string }[] }) {
  return (
    <select {...props} className={cx(inputCls, !props.className?.includes("w-") && "w-full", props.className)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

/** Money input in major units; reports integer minor units. */
export function MoneyInput({ value, onChange, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & { value: number; onChange: (minor: number) => void }) {
  const [text, setText] = useState(minorToInput(value));
  useEffect(() => {
    if (parseMoneyInput(text) !== value) setText(minorToInput(value));
  }, [value]);
  return (
    <Input
      inputMode="decimal"
      {...props}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const v = parseMoneyInput(e.target.value);
        if (v !== null) onChange(v);
      }}
    />
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "warn" | "bad" | "info" }) {
  const t = {
    neutral: "bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300",
    good: "bg-brand-100 text-brand-700 dark:bg-brand-900 dark:text-brand-100",
    warn: "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200",
    bad: "bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-200",
    info: "bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200",
  }[tone];
  return <span className={cx("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", t)}>{children}</span>;
}

export function ProgressBar({ value, max, tone = "brand" }: { value: number; max: number; tone?: "brand" | "warn" | "bad" }) {
  const pctValue = max <= 0 ? 100 : Math.max(0, Math.min(100, (value / max) * 100));
  const color = tone === "brand" ? "bg-brand-500" : tone === "warn" ? "bg-amber-500" : "bg-rose-500";
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800" role="progressbar" aria-valuenow={Math.round(pctValue)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cx("h-full rounded-full transition-all", color)} style={{ width: `${pctValue}%` }} />
    </div>
  );
}

/** "Why" disclosure: every calculated figure links back to the rule, pack version and source. */
export function Why({ sources, children }: { sources: RuleRef[]; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="text-xs">
      <button type="button" className="font-medium text-brand-700 underline-offset-2 hover:underline dark:text-brand-500" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? "Hide why" : "Why?"}
      </button>
      {open && (
        <div className="mt-2 space-y-1 rounded-lg bg-stone-50 p-3 dark:bg-stone-800/60">
          {children}
          <ul className="space-y-0.5">
            {sources.map((s, i) => (
              <li key={i} className="text-stone-600 dark:text-stone-400">
                <code className="text-[11px]">{s.pack}</code> · {s.key}
                {s.value !== undefined && <> = {String(s.value)}</>} ·{" "}
                <a href={s.source} target="_blank" rel="noreferrer" className="underline">source</a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5 shadow-xl dark:bg-stone-900" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <Button variant="ghost" onClick={onClose} aria-label="Close">✕</Button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Disclaimer() {
  return (
    <p className="mt-8 border-t border-stone-200 pt-4 text-xs text-stone-500 dark:border-stone-800">
      This is information, not financial advice. Cúntas explains rules and ranks generic steps; it never recommends a product or provider.
      Rule figures come from versioned rule packs; provisional packs reflect announced Budgets not yet legislated.
    </p>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-stone-300 p-8 text-center dark:border-stone-700">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-2 text-sm text-stone-600 dark:text-stone-400">{children}</div>}
    </div>
  );
}

export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500 dark:border-stone-800">
            {head.map((h, i) => (
              <th key={i} className="px-2 py-2 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100 dark:divide-stone-800">{children}</tbody>
      </table>
    </div>
  );
}
