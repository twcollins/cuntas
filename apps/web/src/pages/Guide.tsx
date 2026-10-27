import { Link } from "@tanstack/react-router";
import { Card, PageHeader } from "../components/ui";

type Topic = { to: string; label: string; body: string };

const SECTIONS: { title: string; intro: string; topics: Topic[] }[] = [
  {
    title: "Get started",
    intro: "Three steps give the planner enough to work with. Everything stays on this device unless you connect a server. The sidebar keeps the everyday pages at the top; the rest are under More.",
    topics: [
      { to: "/household", label: "Household", body: "You're added when you create the household, resident where you said you live; add your pay and date of birth, and anyone else in the household, with their tax residence. Pay drives take-home, pension relief and the next-step checks. For someone in the US, also set their state, filing status and HSA coverage, and their county in Indiana." },
      { to: "/accounts", label: "Accounts", body: "Add current and savings accounts, cards, loans, pensions and property, in EUR, GBP or USD. Tick the ones that hold your emergency fund." },
      { to: "/import", label: "Import", body: "Load CSV, OFX, QFX or CAMT.053 files from your bank, several at once, or drop them on any page. Irish, UK and major US banks and card issuers are recognised, and each file goes to the account it went to last time, or a new one named after the bank. Any other layout is mapped once and remembered. Re-importing the same file never adds duplicates." },
    ],
  },
  {
    title: "Day to day",
    intro: "Where the money goes, and what is coming up.",
    topics: [
      { to: "/", label: "Overview", body: "Net worth, emergency fund, debt, what is left to spend this period, and your next step at a glance." },
      { to: "/transactions", label: "Add a spend", body: "Press + Add (or N on a keyboard) on any page to record a cash spend, money received or a move between your accounts: amount, category, Save. Tick \"every month\" to add it to Bills as well. If the same payment later arrives in a bank import, it's matched to your entry instead of counted twice." },
      { to: "/transactions", label: "Transactions", body: "Search and categorise. Correct one transaction and you'll be offered a rule for the rest from that merchant." },
      { to: "/budgets", label: "Budgets", body: "Envelope or cap budgets per category. Periods run from your payday, set on the Household page. No transactions yet? Give a rough monthly figure and start a budget from it." },
      { to: "/", label: "Rough monthly spending", body: "Seven lines, from rent to everything else. Until you have two months of transactions, the estimate sets your essential spending, the payday waterfall and, while no pay is recorded, the emergency-fund target. Change it from the Emergency fund figure on Overview." },
      { to: "/bills", label: "Bills", body: "Subscriptions and bills found in your transactions, price rises flagged, plus a calendar of the yearly ones that are easy to forget." },
    ],
  },
  {
    title: "Plan",
    intro: "What should your next euro, pound or dollar do? The planner follows the r/irishpersonalfinance flowchart, or r/personalfinance for US households.",
    topics: [
      { to: "/plan", label: "Next steps", body: "Each flowchart step, checked against your data: the r/irishpersonalfinance flowchart, or the r/personalfinance order (emergency fund, match, debt, HSA, IRA, 401(k)) when everyone lives in the US. The first unmet step is your next step; open it to see why and the rules behind it." },
      { to: "/debts", label: "Debts", body: "List your debts, then compare avalanche (highest rate first) and snowball (smallest balance first) payoff plans." },
      { to: "/goals", label: "Goals", body: "Emergency fund, required purchases and longer goals, each with the monthly amount it needs." },
      { to: "/pensions", label: "Pensions", body: "Every pension in one register, with employer match and the tax relief headroom left for your age band. US households record 401(k)s, IRAs, Roth IRAs and HSAs here." },
      { to: "/retirement", label: "Retirement", body: "Pots grown to retirement age and turned into income alongside the State Pensions, in today's money, across three scenarios." },
      { to: "/investing", label: "Compare wrappers", body: "The same yearly amount in each wrapper open to you, compared after tax." },
    ],
  },
  {
    title: "Tax",
    intro: "Calculators built on versioned Irish, UK and US rule packs, with a pack for every US state and D.C. Each figure shows the pack and source it came from.",
    topics: [
      { to: "/tax", label: "Tax centre", body: "Take-home pay (Irish, UK, or US federal plus state, with Indiana county tax; other local income taxes are noted but not included), a payslip check, self-assessment for the self-employed, US contribution limits and quarterly estimated tax, UK ISA allowance and pension annual allowance, deemed-disposal dates and tax deadlines." },
      { to: "/what-if", label: "What if we moved", body: "See what would change tax treatment if someone moved between Ireland, the UK and the US. Your declared residence isn't changed." },
      { to: "/tax-rules", label: "Tax rules", body: "The tax figures behind every result, including each US state in its own group. Download a draft for next year, check each figure against its source, load the file, and tick each section once it matches." },
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
        <p className="text-xs text-stone-500">Cúntas gives guidance, not financial advice. Provisional rule packs reflect Budget announcements not yet law; check figures with Revenue, HMRC, the IRS or your state tax department before relying on them.</p>
      </div>
    </div>
  );
}
