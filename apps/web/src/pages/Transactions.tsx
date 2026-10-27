import { Link, useSearch } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { reconcile, removeManualTransaction, reviewCount, suggestRule, type CategoryRule, type Transaction } from "@cuntas/ledger";
import { openQuickAdd } from "../components/QuickAdd";
import { Badge, Button, Card, Empty, Input, Modal, PageHeader, Select, Table } from "../components/ui";
import { useCategoryName } from "../lib/derived";
import { formatDate, moneyExact } from "../lib/format";
import { useMedia, WIDE } from "../lib/media";
import { update, useDataset } from "../lib/store";

const PAGE = 100;

export function TransactionsPage() {
  const ds = useDataset();
  const catName = useCategoryName(ds);
  const [account, setAccount] = useState("");
  // Import's "Review now" opens the page filtered to uncategorised rows (?category=__none).
  const search = useSearch({ strict: false }) as { category?: string };
  const [category, setCategory] = useState(search.category ?? "");
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [offer, setOffer] = useState<{ rule: CategoryRule; matches: number } | null>(null);
  // Phones get a list grouped by date; a tapped row opens in a sheet.
  const wide = useMedia(WIDE);
  const [editing, setEditing] = useState<string | null>(null);
  const edited = editing ? ds.transactions.find((t) => t.id === editing) : undefined;
  const accounts = new Map(ds.accounts.map((a) => [a.id, a]));
  const toReview = useMemo(() => reviewCount(ds), [ds]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return ds.transactions
      .filter((t) => (!account || t.accountId === account) && (!category || (category === "__none" ? t.categoryId === null : t.categoryId === category)))
      .filter((t) => !needle || `${t.payee} ${t.rawDescription}`.toLowerCase().includes(needle))
      .sort((a, b) => b.bookedAt.localeCompare(a.bookedAt) || a.id.localeCompare(b.id));
  }, [ds.transactions, account, category, q]);

  const categoryOptions = [{ value: "", label: "Uncategorised" }, ...ds.categories.map((c) => ({ value: c.id, label: `${c.group}: ${c.name}` }))];

  function removeManual(t: Transaction) {
    if (window.confirm(`Delete ${t.payee || "this entry"} (${moneyExact(t.amountMinor, t.currency)})?`)) update((d) => removeManualTransaction(d, t.id));
  }

  function setCategoryFor(t: Transaction, categoryId: string) {
    update((d) => ({ ...d, transactions: d.transactions.map((x) => (x.id === t.id ? { ...x, categoryId: categoryId || null, categorySource: categoryId ? "user" : "none" } : x)) }), "transaction.recategorise");
    if (!categoryId) return;
    const rule = suggestRule(t, categoryId);
    if (!rule) return;
    const matches = ds.transactions.filter((x) => x.id !== t.id && x.categorySource !== "user" && `${x.payee} ${x.rawDescription}`.toLowerCase().includes(rule.match.payeeContains!)).length;
    setOffer({ rule, matches });
  }

  return (
    <div>
      <PageHeader title="Transactions" subtitle={`${ds.transactions.length} transactions. Transfers between your own accounts are matched automatically and not counted as spending.`} actions={<Button variant="primary" onClick={openQuickAdd}>Add transaction</Button>} />
      {toReview > 0 && !offer && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-900/20">
          <span>{toReview} transaction{toReview === 1 ? " needs" : "s need"} a category.</span>
          <Link to="/review" className="font-medium text-brand-700 underline dark:text-brand-500">Review them by merchant</Link>
        </div>
      )}
      {offer && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-200 bg-brand-50 p-4 text-sm dark:border-brand-900 dark:bg-brand-900/30">
          <span>
            Always categorise payees containing “<strong>{offer.rule.match.payeeContains}</strong>” as <strong>{catName(offer.rule.categoryId)}</strong>?{" "}
            {offer.matches > 0 && `This updates ${offer.matches} other transaction${offer.matches === 1 ? "" : "s"}.`}
          </span>
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => { update((d) => reconcile({ ...d, categoryRules: [...d.categoryRules, offer.rule] }), "rule.create"); setOffer(null); }}>Create rule</Button>
            <Button onClick={() => setOffer(null)}>Just this one</Button>
          </div>
        </div>
      )}
      <Card>
        <div className="mb-4 grid gap-2 sm:grid-cols-3">
          <Input placeholder="Search payee or description" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
          <Select aria-label="Account" value={account} onChange={(e) => setAccount(e.target.value)} options={[{ value: "", label: "All accounts" }, ...ds.accounts.map((a) => ({ value: a.id, label: a.name }))]} />
          <Select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)} options={[{ value: "", label: "All categories" }, { value: "__none", label: "Uncategorised" }, ...ds.categories.map((c) => ({ value: c.id, label: c.name }))]} />
        </div>
        {rows.length === 0 ? (
          ds.transactions.length === 0 ? (
            <Empty title="No transactions yet">
              <p>Import a statement from your bank, or add a spend by hand.</p>
              <div className="mt-3 flex justify-center gap-2">
                <Link to="/import" className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700">Import statements</Link>
                <Button onClick={openQuickAdd}>Add a spend</Button>
              </div>
            </Empty>
          ) : (
            <Empty title="Nothing matches">
              <Button className="mt-2" onClick={() => { setQ(""); setAccount(""); setCategory(""); }}>Clear search and filters</Button>
            </Empty>
          )
        ) : !wide ? (
          <PhoneList rows={rows.slice(0, limit)} catName={catName} otherSide={(t) => accounts.get(ds.transactions.find((x) => x.id === t.transferPairId)?.accountId ?? "")?.name ?? "matched"} onOpen={setEditing} />
        ) : (
          <Table head={["Date", "Payee", "Account", "Category", "Amount"]}>
            {rows.slice(0, limit).map((t) => {
              const acc = accounts.get(t.accountId);
              return (
                <tr key={t.id} className="align-middle">
                  <td className="whitespace-nowrap px-2 py-2 text-stone-500">{formatDate(t.bookedAt)}</td>
                  <td className="px-2 py-2">
                    <div className="font-medium">{t.payee || t.rawDescription || "Added by hand"}</div>
                    <div className="flex items-center gap-1">
                      {t.source === "manual" && <Badge>by hand</Badge>}
                      {t.source === "manual" && <button type="button" className="text-xs text-stone-500 underline hover:text-rose-700" aria-label={`Delete ${t.payee || "entry"} on ${formatDate(t.bookedAt)}`} onClick={() => removeManual(t)}>Delete</button>}
                      {t.transferPairId && <Badge tone="info">Transfer · {accounts.get(ds.transactions.find((x) => x.id === t.transferPairId)?.accountId ?? "")?.name ?? "matched"}</Badge>}
                      {t.categorySource === "dictionary" && <Badge>auto</Badge>}
                      {t.categorySource === "rule" && <Badge>rule</Badge>}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-stone-500">{acc?.name}</td>
                  <td className="min-w-[12rem] px-2 py-2">
                    <Select aria-label={`Category for ${t.payee}`} value={t.categoryId ?? ""} onChange={(e) => setCategoryFor(t, e.target.value)} options={categoryOptions} className="py-1 text-xs" />
                  </td>
                  <td className={`whitespace-nowrap px-2 py-2 text-right tabular-nums ${t.amountMinor > 0 ? "text-brand-700 dark:text-brand-500" : ""}`}>{moneyExact(t.amountMinor, t.currency)}</td>
                </tr>
              );
            })}
          </Table>
        )}
        {rows.length > limit && (
          <div className="mt-4 text-center"><Button onClick={() => setLimit(limit + PAGE)}>Show more ({rows.length - limit} left)</Button></div>
        )}
      </Card>
      {edited && (
        <Modal open onClose={() => setEditing(null)} title={edited.payee || "Added by hand"}>
          <div className="space-y-3 text-sm">
            <div className={`text-2xl font-semibold tabular-nums ${edited.amountMinor > 0 ? "text-brand-700 dark:text-brand-500" : ""}`}>{moneyExact(edited.amountMinor, edited.currency)}</div>
            <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1">
              <dt className="text-stone-500">Date</dt><dd>{formatDate(edited.bookedAt)}</dd>
              <dt className="text-stone-500">Account</dt><dd>{accounts.get(edited.accountId)?.name}</dd>
              {edited.rawDescription && edited.rawDescription !== edited.payee && <><dt className="text-stone-500">Bank text</dt><dd className="break-words">{edited.rawDescription}</dd></>}
              {edited.transferPairId && <><dt className="text-stone-500">Transfer</dt><dd>{accounts.get(ds.transactions.find((x) => x.id === edited.transferPairId)?.accountId ?? "")?.name ?? "matched"}</dd></>}
            </dl>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-stone-600 dark:text-stone-400">Category</span>
              <Select aria-label={`Category for ${edited.payee}`} value={edited.categoryId ?? ""} onChange={(e) => { setCategoryFor(edited, e.target.value); setEditing(null); }} options={categoryOptions} className="w-full" />
            </label>
            <div className="flex justify-between gap-2 pt-2">
              {edited.source === "manual" ? <Button variant="danger" onClick={() => { removeManual(edited); setEditing(null); }}>Delete</Button> : <span />}
              <Button onClick={() => setEditing(null)}>Close</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Phone transactions: one row per transaction under its date, payee and category on the left, amount on the right. */
function PhoneList({ rows, catName, otherSide, onOpen }: { rows: Transaction[]; catName: (id: string | null) => string; otherSide: (t: Transaction) => string; onOpen: (id: string) => void }) {
  const days: { date: string; rows: Transaction[] }[] = [];
  for (const t of rows) {
    const last = days[days.length - 1];
    if (last?.date === t.bookedAt) last.rows.push(t);
    else days.push({ date: t.bookedAt, rows: [t] });
  }
  return (
    <div className="-mx-5">
      {days.map((d) => (
        <section key={d.date}>
          <h3 className="bg-stone-50 px-5 py-1 text-xs font-medium text-stone-500 dark:bg-stone-800/60">{formatDate(d.date)}</h3>
          <ul className="divide-y divide-stone-100 dark:divide-stone-800">
            {d.rows.map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => onOpen(t.id)} className="flex min-h-14 w-full items-center gap-3 px-5 py-2 text-left active:bg-stone-100 dark:active:bg-stone-800">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{t.payee || t.rawDescription || "Added by hand"}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-1 text-xs">
                      <span className={t.transferPairId ? "text-sky-700 dark:text-sky-400" : t.categoryId ? "text-stone-600 dark:text-stone-400" : "text-amber-700 dark:text-amber-400"}>{t.transferPairId ? `Transfer · ${otherSide(t)}` : catName(t.categoryId)}</span>
                      {t.source === "manual" && <Badge>by hand</Badge>}
                    </span>
                  </span>
                  <span className={`shrink-0 tabular-nums ${t.amountMinor > 0 ? "text-brand-700 dark:text-brand-500" : ""}`}>{moneyExact(t.amountMinor, t.currency)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
