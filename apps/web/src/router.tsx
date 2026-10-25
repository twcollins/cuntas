import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { Layout } from "./components/Layout";
import { AccountPage } from "./pages/Account";
import { AccountsPage } from "./pages/Accounts";
import { AdminPage } from "./pages/Admin";
import { BillsPage } from "./pages/Bills";
import { InvestingPage } from "./pages/Investing";
import { RetirementPage } from "./pages/Retirement";
import { WhatIfPage } from "./pages/WhatIf";
import { BudgetsPage } from "./pages/Budgets";
import { DebtsPage } from "./pages/Debts";
import { GoalsPage } from "./pages/Goals";
import { GuidePage } from "./pages/Guide";
import { HouseholdPage } from "./pages/Household";
import { HouseholdsPage } from "./pages/Households";
import { ImportPage } from "./pages/Import";
import { JoinPage } from "./pages/Join";
import { OverviewPage } from "./pages/Overview";
import { PensionsPage } from "./pages/Pensions";
import { PlanPage } from "./pages/Plan";
import { SettingsPage } from "./pages/Settings";
import { TaxPage } from "./pages/Tax";
import { TaxRulesPage } from "./pages/TaxRules";
import { TransactionsPage } from "./pages/Transactions";

const rootRoute = createRootRoute({ component: Layout });

const pages = [
  ["/", OverviewPage],
  ["/plan", PlanPage],
  ["/transactions", TransactionsPage],
  ["/budgets", BudgetsPage],
  ["/bills", BillsPage],
  ["/accounts", AccountsPage],
  ["/import", ImportPage],
  ["/debts", DebtsPage],
  ["/goals", GoalsPage],
  ["/pensions", PensionsPage],
  ["/retirement", RetirementPage],
  ["/investing", InvestingPage],
  ["/tax", TaxPage],
  ["/tax-rules", TaxRulesPage],
  ["/what-if", WhatIfPage],
  ["/household", HouseholdPage],
  ["/households", HouseholdsPage],
  ["/account", AccountPage],
  ["/settings", SettingsPage],
  ["/guide", GuidePage],
  ["/admin", AdminPage],
  ["/join", JoinPage],
] as const;

const routeTree = rootRoute.addChildren(pages.map(([path, component]) => createRoute({ getParentRoute: () => rootRoute, path, component })));

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
