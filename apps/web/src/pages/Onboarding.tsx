import { useState } from "react";
import { Button, Card, Field, Input, Select } from "../components/ui";
import { startDemo, startEmpty } from "../lib/store";

export function Onboarding() {
  const [name, setName] = useState("My household");
  const [currency, setCurrency] = useState<"EUR" | "GBP">("EUR");
  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-4 py-12">
      <div className="mb-8 flex items-center gap-3">
        <img src="/icon.svg" alt="" className="h-12 w-12" />
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Cúntas</h1>
          <p className="text-stone-600 dark:text-stone-400">What should your next euro do? Budgeting and planning built on Irish (and UK) tax rules.</p>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Try the demo household">
          <p className="mb-4 text-sm text-stone-600 dark:text-stone-400">
            A couple in Dublin with six months of transactions, a credit card, a credit union loan, an Irish pension and a UK ISA. Everything stays in this browser.
          </p>
          <Button variant="primary" onClick={startDemo}>Open demo</Button>
        </Card>
        <Card title="Start your own">
          <div className="space-y-3">
            <Field label="Household name">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
            <Field label="Base currency" hint="Net worth and budgets are shown in this currency.">
              {(id) => (
                <Select id={id} value={currency} onChange={(e) => setCurrency(e.target.value as "EUR" | "GBP")} options={[{ value: "EUR", label: "Euro (EUR)" }, { value: "GBP", label: "Sterling (GBP)" }]} />
              )}
            </Field>
            <Button variant="primary" onClick={() => startEmpty(name.trim() || "My household", currency)}>Create household</Button>
          </div>
        </Card>
      </div>
      <p className="mt-8 text-xs text-stone-500">
        Your data is stored locally on this device. Nothing is sent anywhere unless you connect a self-hosted server under Data &amp; sync. This is information, not financial advice.
      </p>
    </div>
  );
}
