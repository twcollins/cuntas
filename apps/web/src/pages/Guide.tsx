import { Link } from "@tanstack/react-router";
import { Card, PageHeader } from "../components/ui";

type Topic = { to: string; label: string; body: string };

const SECTIONS: { title: string; intro: string; topics: Topic[] }[] = [
  {
    title: "Get started",
    intro: "Three steps give the planner enough to work with. Everything stays on this device unless you connect a server.",
    topics: [
      { to: "/household", label: "Household", body: "Add each person with their pay, date of birth and tax residence. Pay drives take-home, pension relief and the next-step checks." },
      { to: "/accounts", label: "Accounts", body: "Add current and savings accounts, cards, loans, pensions and property, in EUR or GBP. Tick the ones that hold your emergency fund." },
      { to: "/import", label: "Import", body: "Load a CSV, OFX or CAMT.053 file from your bank. Pick a preset or map the columns once; re-importing the same file never adds duplicates." },
    ],
  },
  {
    title: "Day to day",
    intro: "Where the money goes, and what is coming up.",
    topics: [
      { to: "/", label: "Overview", body: "Net worth, emergency fund, debt, what is left to spend this period, and your next step at a glance." },
      { to: "/transactions", label: "Transactions", body: "Search and categorise. Correct one transaction and you'll be offered a rule for the rest from that merchant." },
      { to: "/budgets", label: "Budgets", body: "Envelope or cap budgets per category. Periods run from your payday, set on the Household page." },
      { to: "/bills", label: "Bills", body: "Subscriptions and bills found in your transactions, price rises flagged, plus a calendar of the yearly ones that are easy to forget." },
    ],
  },
  {
    title: "Plan",
    intro: "What should your next euro do? The planner follows the r/irishpersonalfinance flowchart.",
    topics: [
      { to: "/plan", label: "Next steps", body: "Each flowchart step, checked against your data. The first unmet one is your next step; open it to see why and the rules behind it." },
      { to: "/debts", label: "Debts", body: "List your debts, then compare avalanche (highest rate first) and snowball (smallest balance first) payoff plans." },
      { to: "/goals", label: "Goals", body: "Emergency fund, required purchases and longer goals, each with the monthly amount it needs." },
      { to: "/pensions", label: "Pensions", body: "Every pension in one register, with employer match and the tax relief headroom left for your age band." },
      { to: "/retirement", label: "Retirement", body: "Pots grown to retirement age and turned into income alongside the State Pensions, in today's money, across three scenarios." },
      { to: "/investing", label: "Compare wrappers", body: "The same yearly amount in each wrapper open to you, compared after tax." },
    ],
  },
  {
    title: "Tax",
    intro: "Calculators built on versioned Irish and UK rule packs. Each figure shows the pack and source it came from.",
    topics: [
      { to: "/tax", label: "Tax centre", body: "Take-home pay, a payslip check, self-assessment for the self-employed, UK ISA allowance and pension annual allowance, deemed-disposal dates and tax deadlines." },
      { to: "/what-if", label: "What if we moved", body: "See what would change tax treatment if someone moved between Ireland and the UK. Your declared residence isn't changed." },
    ],
  },
  {
    title: "Your data and sharing",
    intro: "Local first: nothing leaves this device unless you choose.",
    topics: [
      { to: "/households", label: "Households", body: "Keep several households on this device and switch between them from the menu at the top of the sidebar. Add a new one, open the demo, or join one with an invite link." },
      { to: "/account", label: "Account & sync", body: "Optional. Sign in to your own Cúntas server with a passkey to sync a household, share it, or use bank sync. Nothing is replaced on this device without asking." },
      { to: "/households", label: "Inviting people", body: "For a synced household, owners invite people from the Households page and choose their role. Each person signs in with their own passkey." },
      { to: "/settings", label: "Settings", body: "Export to JSON or CSV, make an encrypted backup, update exchange rates, switch light or dark mode, or delete everything on this device." },
    ],
  },
];

export function GuidePage() {
  return (
    <div>
      <PageHeader title="Guide" subtitle="A short tour of what each part of Cúntas does and where to start." />
      <div className="space-y-4">
        {SECTIONS.map((s) => (
          <Card key={s.title} title={s.title}>
            <p className="mb-3 text-sm text-stone-600 dark:text-stone-400">{s.intro}</p>
            <dl className="grid gap-3 sm:grid-cols-2">
              {s.topics.map((t) => (
                <div key={t.label} className="rounded-lg bg-stone-50 p-3 dark:bg-stone-800/50">
                  <dt><Link to={t.to} className="text-sm font-medium text-brand-700 hover:underline dark:text-brand-500">{t.label} →</Link></dt>
                  <dd className="mt-1 text-sm text-stone-600 dark:text-stone-400">{t.body}</dd>
                </div>
              ))}
            </dl>
          </Card>
        ))}
        <p className="text-xs text-stone-500">Cúntas gives guidance, not financial advice. Provisional rule packs reflect Budget announcements not yet law; check figures with Revenue or HMRC before relying on them.</p>
      </div>
    </div>
  );
}
