import { useMemo } from "react";
import { evaluate } from "@cuntas/engine";
import { balancesByAccount, buildSnapshot, FxTable, type Dataset } from "@cuntas/ledger";
import { packOn, today } from "@cuntas/rules";

export function useAsOf() {
  return today();
}

/** Engine output and household snapshot, recomputed when the dataset changes. */
export function usePlan(ds: Dataset) {
  const asOf = useAsOf();
  return useMemo(() => {
    const snapshot = buildSnapshot(ds, asOf);
    const pack = packOn("IE", asOf);
    return { snapshot, pack, result: evaluate(snapshot, pack), asOf };
  }, [ds, asOf]);
}

export function useBalances(ds: Dataset) {
  const asOf = useAsOf();
  return useMemo(() => {
    const fx = new FxTable(ds.fxRates);
    const native = balancesByAccount(ds, asOf);
    const base = new Map<string, number | null>();
    for (const a of ds.accounts) base.set(a.id, fx.tryConvert(native.get(a.id) ?? 0, a.currency, ds.household.baseCurrency, asOf));
    return { native, base, fx };
  }, [ds, asOf]);
}

export function useCategoryName(ds: Dataset) {
  return useMemo(() => {
    const m = new Map(ds.categories.map((c) => [c.id, c.name]));
    return (id: string | null) => (id ? (m.get(id) ?? "Unknown") : "Uncategorised");
  }, [ds]);
}
