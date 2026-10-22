import { Link, Outlet } from "@tanstack/react-router";
import { useState } from "react";
import { useStore } from "../lib/store";
import { cx } from "./ui";

const NAV = [
  { to: "/", label: "Overview", icon: "◎" },
  { to: "/plan", label: "Next steps", icon: "↗" },
  { to: "/transactions", label: "Transactions", icon: "≡" },
  { to: "/budgets", label: "Budgets", icon: "▤" },
  { to: "/accounts", label: "Accounts", icon: "▣" },
  { to: "/import", label: "Import", icon: "⇪" },
  { to: "/debts", label: "Debts", icon: "↘" },
  { to: "/goals", label: "Goals", icon: "◆" },
  { to: "/pensions", label: "Pensions", icon: "☂" },
  { to: "/tax", label: "Tax centre", icon: "§" },
  { to: "/household", label: "Household", icon: "⌂" },
  { to: "/settings", label: "Data & sync", icon: "⚙" },
] as const;

export function Layout() {
  const { dataset, sync } = useStore();
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-screen md:flex">
      <aside className={cx("fixed inset-y-0 left-0 z-40 w-60 transform border-r border-stone-200 bg-white p-4 transition md:static md:translate-x-0 dark:border-stone-800 dark:bg-stone-900", open ? "translate-x-0" : "-translate-x-full")}>
        <div className="mb-6 flex items-center gap-2 px-2">
          <img src="/icon.svg" alt="" className="h-8 w-8" />
          <div>
            <div className="font-semibold leading-tight">Cúntas</div>
            <div className="max-w-[10rem] truncate text-xs text-stone-500">{dataset?.household.name}</div>
          </div>
        </div>
        <nav className="space-y-0.5" aria-label="Main">
          {NAV.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-stone-700 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800"
              activeProps={{ className: "bg-brand-50 font-medium text-brand-700 dark:bg-brand-900/40 dark:text-brand-100" }}
              activeOptions={{ exact: n.to === "/" }}
            >
              <span aria-hidden className="w-4 text-center text-stone-400">{n.icon}</span>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="absolute bottom-4 left-4 right-4 text-xs text-stone-500">
          {sync ? (sync.dirty ? "● Changes not yet synced" : "✓ Synced") : "Stored on this device only"}
        </div>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-black/30 md:hidden" onClick={() => setOpen(false)} />}
      <div className="flex-1">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-stone-200 bg-white/90 px-4 py-3 backdrop-blur md:hidden dark:border-stone-800 dark:bg-stone-900/90">
          <button type="button" aria-label="Open menu" className="rounded p-1 text-xl" onClick={() => setOpen(true)}>☰</button>
          <span className="font-semibold">Cúntas</span>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
