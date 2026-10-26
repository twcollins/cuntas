import { useMemo, useState } from "react";
import { reconcile, removeManualTransaction, suggestRule, type CategoryRule, type Transaction } from "@cuntas/ledger";
import { openQuickAdd } from "../components/QuickAdd";
import { Badge, Button, Card, Empty, Input, PageHeader, Select, Table } from "../components/ui";
import { useCategoryName } from "../lib/derived";
import { formatDate, moneyExact } from "../lib/format";
import { update, useDataset } from "../lib/store";

const PAGE = 100;

export function TransactionsPage() {
  const ds = useDataset();
  const catName = useCategoryName(ds);
  const [account, setAccount] = useState("");
  const [category, setCategory] = useState("");
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [offer, setOffer] = useState<{ rule: CategoryRule; matches: number } | null>(null);
  const accounts = new Map(ds.accounts.map((a) => [a.id, a]));

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
          <Empty title="No transactions">Import a bank file or connect an account.</Empty>
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
    </div>
  );
}
