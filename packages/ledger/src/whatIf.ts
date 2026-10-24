import { addDays, classify, treaty, type Classification, type CrossBorderItem, type IsoDate, type Jurisdiction, type RelocationNote } from "@cuntas/rules";
import { FxTable } from "./fx";
import { newId } from "./ids";
import type { Dataset, Member } from "./schema";
import { memberPay, residenceOn } from "./snapshot";

export interface WhatIfItem {
  memberId: string;
  label: string;
  before: Classification;
  after: Classification;
  changed: boolean;
}

/** A copy of the dataset with a member resident in `to` from `from` onwards; pay converted to the new currency. */
export function withResidence(ds: Dataset, memberId: string, to: Jurisdiction, from: IsoDate): Dataset {
  const fx = new FxTable(ds.fxRates);
  const current = residenceOn(ds, memberId, from);
  const periods = ds.residencePeriods
    .filter((r) => r.memberId !== memberId || r.from < from)
    .map((r) => (r.memberId === memberId && (r.to === null || r.to >= from) ? { ...r, to: addDays(from, -1) } : r));
  periods.push({ id: newId("rp"), memberId, jurisdiction: to, from, to: null, declaredBy: "what-if" });
  const curFrom = current === "UK" ? "GBP" : "EUR";
  const curTo = to === "UK" ? "GBP" : "EUR";
  const members = ds.members.map((m) => (m.id === memberId && curFrom !== curTo ? { ...m, grossAnnualMinor: fx.tryConvert(m.grossAnnualMinor, curFrom, curTo, from) ?? m.grossAnnualMinor } : m));
  return { ...ds, residencePeriods: periods, members };
}

function itemsFor(ds: Dataset, m: Member, residence: Jurisdiction): { label: string; item: CrossBorderItem }[] {
  const items: { label: string; item: CrossBorderItem }[] = [];
  for (const p of ds.pensionPlans.filter((x) => x.memberId === m.id)) {
    const isState = p.kind === "statePensionIE" || p.kind === "statePensionUK";
    items.push({ label: p.name, item: { kind: isState ? "statePension" : "privatePension", sourceCountry: p.jurisdiction } });
  }
  if ((m.ieContributionYears ?? 0) > 0 && !ds.pensionPlans.some((p) => p.memberId === m.id && p.kind === "statePensionIE")) items.push({ label: "Irish State Pension", item: { kind: "statePension", sourceCountry: "IE" } });
  if ((m.ukQualifyingYears ?? 0) > 0 && !ds.pensionPlans.some((p) => p.memberId === m.id && p.kind === "statePensionUK")) items.push({ label: "UK State Pension", item: { kind: "statePension", sourceCountry: "UK" } });
  for (const a of ds.accounts.filter((x) => x.memberIds.includes(m.id) && !x.archived)) {
    if (a.wrapper === "ISA" || a.wrapper === "LISA") items.push({ label: a.name, item: { kind: "isa" } });
    else if (a.type === "savings" || a.type === "current") items.push({ label: a.name, item: { kind: "deposit", accountCountry: a.jurisdiction } });
  }
  void residence;
  return items;
}

/**
 * Shows what changes if members move: which accounts, pensions and pay change tax treatment, plus
 * the relocation notes from the cross-border rule pack. Residence stays the user's declaration.
 */
export function residenceWhatIf(ds: Dataset, asOf: IsoDate, input: { memberIds: string[]; to: Jurisdiction; keepJob: boolean }) {
  const taxYear = asOf.slice(0, 4);
  let after = ds;
  for (const id of input.memberIds) if (residenceOn(ds, id, asOf) !== input.to) after = withResidence(after, id, input.to, asOf);

  const members = [];
  const items: WhatIfItem[] = [];
  for (const id of input.memberIds) {
    const m = ds.members.find((x) => x.id === id);
    if (!m) continue;
    const from = residenceOn(ds, id, asOf);
    const mAfter = after.members.find((x) => x.id === id)!;
    members.push({ id, name: m.name, from, to: input.to, payBefore: memberPay(ds, m, asOf), payAfter: memberPay(after, mAfter, asOf) });
    if (from === input.to) continue;
    const working = m.employmentType === "employee" || m.employmentType === "selfEmployed";
    const list = itemsFor(ds, m, from);
    if (working) list.unshift({ label: "Employment income", item: { kind: "employment", workCountry: from } });
    for (const { label, item } of list) {
      const afterItem: CrossBorderItem = item.kind === "employment" ? { kind: "employment", workCountry: input.keepJob ? from : input.to } : item;
      const before = classify(item, { residence: from, nationality: m.nationality }, taxYear);
      const next = classify(afterItem, { residence: input.to, nationality: m.nationality }, taxYear);
      const changed = before.method !== next.method || before.taxedBy.join() !== next.taxedBy.join();
      items.push({ memberId: id, label, before, after: next, changed });
    }
  }
  const relocation = treaty().relocation;
  const moving = members.some((m) => m.from !== m.to);
  const notes: RelocationNote[] = moving && relocation ? (input.to === "UK" ? relocation.toUK : relocation.toIE) : [];
  return { members, items, notes };
}
