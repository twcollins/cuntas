import { useMemo } from "react";
import { evaluate, evaluateUs } from "@cuntas/engine";
import { balancesByAccount, buildSnapshot, FxTable, type Dataset } from "@cuntas/ledger";
import { figuresNote, packOn, today } from "@cuntas/rules";
import { useRulePacks } from "./rulepacks";

export function useAsOf() {
  return today();
}

/** Engine output and household snapshot, recomputed when the dataset changes. */
export function usePlan(ds: Dataset) {
  const asOf = useAsOf();
  const rules = useRulePacks();
  const plan = useMemo(() => {
    const snapshot = buildSnapshot(ds, asOf);
    // The Irish pack serves the Irish/UK screens (pension relief, MyFutureFund) whichever ladder runs.
    const pack = packOn("IE", asOf);
    const result = snapshot.plan === "US" ? evaluateUs(snapshot, packOn("US", asOf)) : evaluate(snapshot, pack);
    return { snapshot, pack, result, asOf };
    // rules.revision: a loaded rule file can replace the pack in use.
  }, [ds, asOf, rules.revision]);
  /** "Figures not checked …" when the plan uses unchecked or last year's figures. */
  const ladder = plan.snapshot.plan;
  const figures = useMemo(() => figuresNote(ladder, asOf, rules.checks).label, [ladder, asOf, rules.checks, rules.revision]);
  return { ...plan, figures };
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
