import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import type { Dataset } from "@cuntas/ledger";
import { useEffect, useRef, useState } from "react";
import { today } from "@cuntas/rules";
import { useRulePrompts } from "../lib/rulepacks";
import { switchHousehold, useDataset, useStore } from "../lib/store";
import { setTheme, useTheme, type ThemePreference } from "../lib/theme";
import { setDisplayLocale } from "../lib/format";
import { involves, termsFor, type Terms } from "../lib/region";
import { openQuickAdd, QuickAddHost } from "./QuickAdd";
import { cx } from "./ui";

type NavItem = { to: string; label: string; icon: string; adminOnly?: boolean; badge?: "rules"; sub?: boolean; when?: (ds: Dataset) => boolean };

// The everyday pages first; the rest sits under "More", collapsed until opened or until one of its pages is open.
const MAIN: NavItem[] = [
  { to: "/", label: "Overview", icon: "◎" },
  { to: "/transactions", label: "Transactions", icon: "≡" },
  { to: "/import", label: "Import", icon: "⇪" },
  { to: "/accounts", label: "Accounts", icon: "▣" },
  { to: "/budgets", label: "Budgets", icon: "▤" },
  { to: "/plan", label: "Next steps", icon: "↗" },
  { to: "/bills", label: "Bills", icon: "↻", sub: true },
  { to: "/debts", label: "Debts", icon: "↘", sub: true },
  { to: "/goals", label: "Goals", icon: "◆", sub: true },
  { to: "/tax", label: "Tax centre", icon: "§" },
];

const MORE: NavItem[] = [
  { to: "/pensions", label: "Pensions", icon: "☂" },
  { to: "/retirement", label: "Retirement", icon: "◔" },
  // Wrapper comparisons cover Irish and UK wrappers only.
  { to: "/investing", label: "Compare wrappers", icon: "⚖", when: (ds) => involves(ds, "IE") || involves(ds, "UK") },
  { to: "/what-if", label: "What if we moved", icon: "⇄" },
  { to: "/tax-rules", label: "Tax rules", icon: "¶", badge: "rules" },
  { to: "/household", label: "Household", icon: "⌂" },
  { to: "/households", label: "Households", icon: "⌘" },
  { to: "/account", label: "Account & sync", icon: "⇅" },
  { to: "/settings", label: "Settings", icon: "⚙" },
  { to: "/guide", label: "Guide", icon: "?" },
  { to: "/admin", label: "Server admin", icon: "⛭", adminOnly: true },
];

const MORE_KEY = "cuntas:nav-more";

const THEMES: { value: ThemePreference; label: string; icon: string }[] = [
  { value: "light", label: "Light", icon: "☀" },
  { value: "system", label: "System", icon: "◐" },
  { value: "dark", label: "Dark", icon: "☾" },
];

export function ThemeSwitch({ className }: { className?: string }) {
  const { preference } = useTheme();
  return (
    <div role="radiogroup" aria-label="Colour theme" className={cx("inline-flex rounded-lg border border-stone-200 p-0.5 dark:border-stone-700", className)}>
      {THEMES.map((t) => (
        <button
          key={t.value}
          type="button"
          role="radio"
          aria-checked={preference === t.value}
          title={`${t.label} theme`}
          aria-label={`${t.label} theme`}
          onClick={() => setTheme(t.value)}
          className={cx(
            "rounded-md px-2 py-1 text-xs",
            preference === t.value ? "bg-stone-100 font-medium text-stone-900 dark:bg-stone-700 dark:text-stone-50" : "text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-100",
          )}
        >
          <span aria-hidden>{t.icon}</span> {t.label}
        </button>
      ))}
    </div>
  );
}

/** The sidebar header: the open household, and a menu to switch, add or manage households. */
function HouseholdSwitcher({ onNavigate }: { onNavigate: () => void }) {
  const { dataset, households, activeId } = useStore();
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [menu]);
  const item = "block w-full rounded-md px-3 py-1.5 text-left text-sm hover:bg-stone-100 dark:hover:bg-stone-800";
  return (
    <div ref={ref} className="relative mb-6">
      <button type="button" aria-haspopup="menu" aria-expanded={menu} aria-label={`Household: ${dataset?.household.name ?? ""}. Switch household`} onClick={() => setMenu(!menu)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left hover:bg-stone-100 dark:hover:bg-stone-800">
        <img src="/icon.svg" alt="" className="h-8 w-8" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold leading-tight">Cúntas</div>
          <div className="truncate text-xs text-stone-500">{dataset?.household.name}</div>
        </div>
        <span aria-hidden className="text-xs text-stone-400">▾</span>
      </button>
      {menu && (
        <div role="menu" className="absolute inset-x-0 top-full z-50 mt-1 rounded-lg border border-stone-200 bg-white p-1 shadow-lg dark:border-stone-700 dark:bg-stone-900">
          {households.map((h) => (
            <button key={h.id} type="button" role="menuitemradio" aria-checked={h.id === activeId} className={cx(item, "flex items-center justify-between gap-2")} onClick={() => { setMenu(false); onNavigate(); void switchHousehold(h.id); }}>
              <span className="truncate">{h.name}</span>
              {h.id === activeId && <span aria-hidden className="text-brand-700 dark:text-brand-500">✓</span>}
            </button>
          ))}
          <div className="my-1 border-t border-stone-100 dark:border-stone-800" />
          <Link to="/households" role="menuitem" className={item} onClick={() => { setMenu(false); onNavigate(); }}>Add or manage households</Link>
        </div>
      )}
    </div>
  );
}

/** Count of tax-rule prompts, shown on the Tax rules item. */
function RulesCount() {
  const { dataset } = useStore();
  const prompts = useRulePrompts(dataset!, today());
  if (prompts.length === 0) return null;
  return <span aria-label={`${prompts.length} to do`} className="ml-auto rounded-full bg-amber-100 px-1.5 text-[11px] font-medium text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">{prompts.length}</span>;
}

function readMore(): boolean {
  try {
    return localStorage.getItem(MORE_KEY) === "1";
  } catch {
    return false;
  }
}

function NavList({ items, terms, onNavigate }: { items: NavItem[]; terms: Terms; onNavigate: () => void }) {
  const { account } = useStore();
  const ds = useDataset();
  const shown = items.filter((n) => (!n.adminOnly || account?.isAdmin) && (!n.when || n.when(ds)));
  return (
    <div className="space-y-0.5">
      {shown.map((n) => (
        <Link
          key={n.to}
          to={n.to}
          onClick={onNavigate}
          className={cx("flex items-center gap-3 rounded-lg px-3 py-1 text-sm text-stone-700 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800", n.sub && "pl-10")}
          activeProps={{ className: "bg-brand-50 font-medium text-brand-700 dark:bg-brand-900/40 dark:text-brand-100" }}
          activeOptions={{ exact: n.to === "/" }}
        >
          {!n.sub && <span aria-hidden className="w-4 text-center text-stone-400">{n.icon}</span>}
          {n.to === "/pensions" ? terms.pensions : n.label}
          {n.badge === "rules" && <RulesCount />}
        </Link>
      ))}
    </div>
  );
}

export function Layout() {
  const { sync } = useStore();
  const terms = termsFor(useDataset());
  // Dates render in the household's style; set before children render.
  setDisplayLocale(terms.locale);
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const [moreSaved, setMoreSaved] = useState(() => readMore());
  const moreOpen = moreSaved || MORE.some((n) => n.to === pathname);
  const toggleMore = (next: boolean) => {
    setMoreSaved(next);
    try {
      localStorage.setItem(MORE_KEY, next ? "1" : "0");
    } catch {
      // Storage can be blocked; the toggle still works for this visit.
    }
  };
  return (
    <div className="min-h-screen md:flex">
      <aside className={cx("fixed inset-y-0 left-0 z-40 flex w-60 transform flex-col border-r border-stone-200 bg-white p-4 transition md:sticky md:top-0 md:h-screen md:translate-x-0 dark:border-stone-800 dark:bg-stone-900", open ? "translate-x-0" : "-translate-x-full")}>
        <HouseholdSwitcher onNavigate={() => setOpen(false)} />
        <button type="button" title="Add a spend, money received or a move (N)" onClick={() => { setOpen(false); openQuickAdd(); }} className="mb-4 hidden w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 md:flex">
          <span aria-hidden>+</span> Add
        </button>
        <nav className="-mx-1 flex-1 space-y-3 overflow-y-auto px-1" aria-label="Main">
          <NavList items={MAIN} terms={terms} onNavigate={() => setOpen(false)} />
          <div>
            <button type="button" aria-expanded={moreOpen} onClick={() => toggleMore(!moreOpen)} className="flex w-full items-center gap-3 rounded-lg px-3 py-1 text-left text-sm text-stone-500 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800">
              <span aria-hidden className="w-4 text-center text-stone-400">{moreOpen ? "▾" : "▸"}</span>
              More
              {!moreOpen && <RulesCount />}
            </button>
            {moreOpen && <NavList items={MORE} terms={terms} onNavigate={() => setOpen(false)} />}
          </div>
        </nav>
        <div className="mt-4 space-y-2 border-t border-stone-100 pt-3 text-xs text-stone-500 dark:border-stone-800">
          <div>{sync ? (sync.dirty ? "● Changes not yet synced" : "✓ Synced") : "Stored on this device only"}</div>
        </div>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-black/30 md:hidden" onClick={() => setOpen(false)} />}
      <div className="flex-1">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-stone-200 bg-white/90 px-4 py-3 backdrop-blur md:hidden dark:border-stone-800 dark:bg-stone-900/90">
          <button type="button" aria-label="Open menu" className="rounded p-1 text-xl" onClick={() => setOpen(true)}>☰</button>
          <span className="font-semibold">Cúntas</span>
        </header>
        <main className="mx-auto max-w-6xl px-4 pb-24 pt-6 md:px-8 md:py-8">
          <Outlet />
        </main>
        <button type="button" aria-label="Add" onClick={openQuickAdd} className="fixed bottom-5 right-5 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-3xl text-white shadow-lg hover:bg-brand-700 md:hidden" style={{ marginBottom: "env(safe-area-inset-bottom)" }}>
          <span aria-hidden>+</span>
        </button>
        <QuickAddHost />
      </div>
    </div>
  );
}
