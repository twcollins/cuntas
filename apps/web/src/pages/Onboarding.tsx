import { useState } from "react";
import { ServerHouseholdList, ServerSignIn } from "../components/ServerAccess";
import { Button, Card, Field, Input, Select } from "../components/ui";
import type { ServerHousehold } from "../lib/server";
import { startDemo, startEmpty, useStore } from "../lib/store";
import { COUNTRY_INFO, type Currency, type Jurisdiction } from "@cuntas/rules";
import { currencyOptions, taxCountryOptions } from "../lib/format";

export function Onboarding() {
  const [name, setName] = useState("My household");
  const [firstName, setFirstName] = useState("");
  const [home, setHome] = useState<Jurisdiction>("IE");
  const [currency, setCurrency] = useState<Currency>("EUR");
  const { account } = useStore();
  const [serverHouseholds, setServerHouseholds] = useState<ServerHousehold[] | null>(null);
  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-4 py-12">
      <div className="mb-8 flex items-center gap-3">
        <img src="/icon.svg" alt="" className="h-12 w-12" />
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Cúntas</h1>
          <p className="text-stone-600 dark:text-stone-400">What should your next euro (or dollar) do? Budgeting and planning built on Irish, UK and US tax rules.</p>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Card title="Try the demo household">
          <p className="mb-4 text-sm text-stone-600 dark:text-stone-400">
            A couple in Dublin with six months of transactions, a credit card, a credit union loan, an Irish pension and a UK ISA. Everything stays in this browser.
          </p>
          <Button variant="primary" onClick={startDemo}>Open demo</Button>
        </Card>
        <Card title="Start your own">
          <div className="space-y-3">
            <Field label="Your first name">{(id) => <Input id={id} value={firstName} autoComplete="given-name" onChange={(e) => setFirstName(e.target.value)} />}</Field>
            <Field label="Household name">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
            <Field label="Where do you live?" hint="Sets the currency, wording and tax rules to start with. You can add people and change residence later.">
              {(id) => <Select id={id} value={home} onChange={(e) => { const j = e.target.value as Jurisdiction; setHome(j); setCurrency(COUNTRY_INFO[j].currency); }} options={taxCountryOptions()} />}
            </Field>
            <Field label="Base currency" hint="Net worth and budgets are shown in this currency.">
              {(id) => (
                <Select id={id} value={currency} onChange={(e) => setCurrency(e.target.value as Currency)} options={currencyOptions(true)} />
              )}
            </Field>
            <Button variant="primary" onClick={() => startEmpty(name.trim() || "My household", currency, { name: firstName.trim() || "Me", home })}>Create household</Button>
          </div>
        </Card>
        <Card title="I already use Cúntas">
          {account && serverHouseholds ? (
            <>
              <p className="mb-3 text-sm text-stone-600 dark:text-stone-400">Signed in as {account.displayName}. Open a household on this device:</p>
              <ServerHouseholdList apiUrl={account.apiUrl} households={serverHouseholds} />
            </>
          ) : (
            <>
              <p className="mb-4 text-sm text-stone-600 dark:text-stone-400">Sign in to your own Cúntas server to open a household you share or synced from another device.</p>
              <ServerSignIn onSignedIn={setServerHouseholds} />
            </>
          )}
        </Card>
      </div>
      <p className="mt-8 text-xs text-stone-500">
        Your data is stored locally on this device. Nothing is sent anywhere unless you sign in to your own self-hosted server. This is information, not financial advice.
      </p>
    </div>
  );
}
