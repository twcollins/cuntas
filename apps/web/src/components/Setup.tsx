import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { confirmYou, hideSetup, isLiability, newId, setupChecklist, starterBudget, UNKNOWN_BIRTH_DATE, type Account, type Member, type SetupItem } from "@cuntas/ledger";
import { COUNTRY_INFO, US_STATES, type Currency, type UsState } from "@cuntas/rules";
import { useAsOf, useCategoryName } from "../lib/derived";
import { currencyOptions, money, monthLabel, usStateOptions } from "../lib/format";
import { countryForCurrency, termsFor } from "../lib/region";
import { update, useDataset } from "../lib/store";
import { openQuickAdd } from "./QuickAdd";
import { SpendingEstimateSheet } from "./SpendingEstimate";
import { Button, Card, cx, Field, Input, Modal, MoneyInput, Select } from "./ui";

// Shown on Overview in place of step 0 until the household is set up: you, accounts, spending, budget.
// Each line acts in place (a sheet, quick add, the estimate) rather than sending the user elsewhere.

const LABELS: Record<SetupItem["key"], string> = { you: "You", accounts: "Accounts", spending: "Spending", budget: "Budget" };

export function useSetupShowing(): boolean {
  return setupChecklist(useDataset()).show;
}

export function SetupChecklist() {
  const ds = useDataset();
  const asOf = useAsOf();
  const catName = useCategoryName(ds);
  const list = setupChecklist(ds);
  const [sheet, setSheet] = useState<"you" | "account" | "estimate" | null>(null);
  const base = ds.household.baseCurrency;
  const next = list.items.find((i) => !i.done)?.key;
  const starter = starterBudget(ds, asOf);
  const btn = "font-medium text-brand-700 underline dark:text-brand-500";

  function makeBudget() {
    const b = starterBudget(ds, asOf);
    if (!b) return;
    const budget = { id: b.id, period: b.period, mode: b.mode, lines: b.lines };
    update((d) => ({ ...d, budgets: [...d.budgets.filter((x) => x.period !== budget.period), budget] }), "setup.budget");
  }

  function line(item: SetupItem): ReactNode {
    switch (item.key) {
      case "you": {
        const me = ds.members[0];
        if (!item.done || !me) {
          const asks = item.missing.includes("person") ? "your name" : [item.missing.includes("birthDate") && "birth date", item.missing.includes("pay") && "pay", item.missing.includes("state") && "state"].filter(Boolean).join(", ").replace(/, ([^,]*)$/, " and $1");
          return <><button type="button" className={btn} onClick={() => (me ? setSheet("you") : undefined)} disabled={!me}>Add your {asks}</button><span className="text-stone-500"> so the plan uses your tax and pay</span></>;
        }
        return <>{youSummary(me, ds.residencePeriods.find((r) => r.memberId === me.id && r.to === null)?.jurisdiction, base)} · <button type="button" className={btn} onClick={() => setSheet("you")}>Edit</button></>;
      }
      case "accounts":
        return item.done ? (
          <span className="text-stone-600 dark:text-stone-400">{item.names.slice(0, 3).join(", ")}{item.names.length > 3 && ` and ${item.names.length - 3} more`}</span>
        ) : (
          <><Link to="/import" className={btn}>Import statements</Link> <span className="text-stone-500">or</span> <button type="button" className={btn} onClick={() => setSheet("account")}>Add an account</button></>
        );
      case "spending":
        return item.done ? (
          <span className="text-stone-600 dark:text-stone-400">{item.source === "transactions" ? `${item.count} transaction${item.count === 1 ? "" : "s"}` : `About ${money(item.monthlyMinor, base)} a month, from your estimate`}</span>
        ) : (
          <><Link to="/import" className={btn}>Import statements</Link><span className="text-stone-500">, </span><button type="button" className={btn} onClick={openQuickAdd}>add a spend</button> <span className="text-stone-500">or</span> <button type="button" className={btn} onClick={() => setSheet("estimate")}>give a rough monthly figure</button></>
        );
      case "budget": {
        if (item.done) {
          const latest = [...ds.budgets].sort((a, b) => b.period.localeCompare(a.period))[0]!;
          return <span className="text-stone-600 dark:text-stone-400">{monthLabel(latest.period)} · <Link to="/budgets" className={btn}>Adjust</Link></span>;
        }
        if (!starter) return <span className="text-stone-500">Made for you from your spending, once there is some</span>;
        const top = starter.lines.slice(0, 2).map((l) => catName(l.categoryId)).join(", ");
        return <><Button variant="primary" className="py-1" onClick={makeBudget}>Make my budget</Button> <span className="text-stone-500">from your {starter.source === "estimate" ? "estimate" : "spending"} ({top}{starter.lines.length > 2 ? "…" : ""}), ready to adjust</span></>;
      }
    }
  }

  return (
    <div role="region" aria-label="Get set up">
    <Card
      title="Get set up"
      actions={
        <div className="flex items-center gap-3 text-sm">
          <span className="text-stone-500">{list.done} of {list.items.length} done</span>
          <button type="button" className="text-stone-500 underline" onClick={() => update((d) => hideSetup(d))}>Hide</button>
        </div>
      }
    >
      <ol className="space-y-3">
        {list.items.map((item) => (
          <li key={item.key} className="flex gap-3 text-sm" aria-label={`${LABELS[item.key]}: ${item.done ? "done" : "to do"}`}>
            <span aria-hidden className={cx("mt-0.5 w-4 shrink-0 text-center", item.done ? "text-brand-600" : item.key === next ? "text-amber-500" : "text-stone-300 dark:text-stone-600")}>{item.done ? "✔" : item.key === next ? "●" : "○"}</span>
            <span className="w-20 shrink-0 font-medium">{LABELS[item.key]}</span>
            <span className="min-w-0 flex-1">{line(item)}</span>
          </li>
        ))}
      </ol>
      {sheet === "you" && ds.members[0] && <YouSheet member={ds.members[0]} onClose={() => setSheet(null)} />}
      {sheet === "account" && <AccountSheet onClose={() => setSheet(null)} />}
      <SpendingEstimateSheet open={sheet === "estimate"} onClose={() => setSheet(null)} />
    </Card>
    </div>
  );
}

function youSummary(m: Member, home: string | undefined, base: Currency): string {
  const where = home === "US" && m.usState ? `US (${US_STATES[m.usState as UsState]})` : home ? COUNTRY_INFO[home as keyof typeof COUNTRY_INFO]?.name ?? home : "";
  const pay = m.grossAnnualMinor > 0 ? `${money(m.grossAnnualMinor, base)} a year` : m.employmentType === "retired" ? "retired" : m.employmentType === "notWorking" ? "not working" : "";
  return [m.name, where, pay].filter(Boolean).join(", ");
}

function YouSheet({ member, onClose }: { member: Member; onClose: () => void }) {
  const ds = useDataset();
  const us = ds.residencePeriods.some((r) => r.memberId === member.id && r.to === null && r.jurisdiction === "US");
  const [birth, setBirth] = useState(member.dateOfBirth === UNKNOWN_BIRTH_DATE && !ds.household.setup.youConfirmedAt ? "" : member.dateOfBirth);
  const [work, setWork] = useState<Member["employmentType"]>(member.employmentType);
  const [pay, setPay] = useState(member.grossAnnualMinor);
  const [state, setState] = useState<string>(member.usState ?? "");
  const earns = work === "employee" || work === "selfEmployed";
  const ready = !!birth && (!earns || pay > 0) && (!us || !!state);
  function save() {
    update((d) => confirmYou(d, member.id, { dateOfBirth: birth, employmentType: work, grossAnnualMinor: earns ? pay : 0, ...(us ? { usState: state as UsState } : {}) }));
    onClose();
  }
  return (
    <Modal open onClose={onClose} title={`About you, ${member.name}`}>
      <div className="space-y-3">
        <Field label="Date of birth" hint="For pension and retirement limits that depend on age.">{(id) => <Input id={id} type="date" value={birth} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setBirth(e.target.value)} />}</Field>
        <Field label="Work">{(id) => <Select id={id} value={work} onChange={(e) => setWork(e.target.value as Member["employmentType"])} options={[{ value: "employee", label: "Employed" }, { value: "selfEmployed", label: "Self-employed" }, { value: "notWorking", label: "Not working" }, { value: "retired", label: "Retired" }]} />}</Field>
        {earns && <Field label={work === "selfEmployed" ? "Profit a year, before tax" : "Pay a year, before tax"}>{(id) => <MoneyInput id={id} value={pay} onChange={setPay} placeholder="0" />}</Field>}
        {us && <Field label="State" hint="Your state's income tax comes off your pay.">{(id) => <Select id={id} value={state} onChange={(e) => setState(e.target.value)} options={usStateOptions("Choose a state")} />}</Field>}
        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!ready} onClick={save}>Save</Button>
        </div>
      </div>
    </Modal>
  );
}

type NewType = "current" | "savings" | "creditCard";

function AccountSheet({ onClose }: { onClose: () => void }) {
  const ds = useDataset();
  const asOf = useAsOf();
  const terms = termsFor(ds);
  const [name, setName] = useState("");
  const [type, setType] = useState<NewType>("current");
  const [currency, setCurrency] = useState<Currency>(ds.household.baseCurrency);
  const [balance, setBalance] = useState(0);
  const draft: Account = { id: newId("acc"), name: name.trim(), memberIds: ds.members.map((m) => m.id), type, currency, institutionId: null, wrapper: "none", jurisdiction: countryForCurrency(ds, currency), openingBalanceMinor: 0, openingDate: asOf, valuations: [], isEmergencyFund: false, archived: false };
  const owed = isLiability(draft);
  function save() {
    update((d) => ({ ...d, accounts: [...d.accounts, { ...draft, openingBalanceMinor: owed ? -Math.abs(balance) : balance }] }), "setup.account");
    onClose();
  }
  return (
    <Modal open onClose={onClose} title="Add an account">
      <div className="space-y-3">
        <Field label="Name">{(id) => <Input id={id} value={name} autoFocus onChange={(e) => setName(e.target.value)} placeholder={terms.us ? "Chase checking" : "AIB current account"} />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">{(id) => <Select id={id} value={type} onChange={(e) => setType(e.target.value as NewType)} options={[{ value: "current", label: terms.currentAccount }, { value: "savings", label: "Savings" }, { value: "creditCard", label: "Credit card" }]} />}</Field>
          <Field label="Currency">{(id) => <Select id={id} value={currency} onChange={(e) => setCurrency(e.target.value as Currency)} options={currencyOptions()} />}</Field>
        </div>
        <Field label={owed ? "Owed today" : "Balance today"} hint="Importing a statement later adds its transactions to this account.">{(id) => <MoneyInput id={id} value={balance} onChange={setBalance} placeholder="0.00" />}</Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!name.trim()} onClick={save}>Add account</Button>
        </div>
      </div>
    </Modal>
  );
}
