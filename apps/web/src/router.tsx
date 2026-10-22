import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { Layout } from "./components/Layout";
import { AccountsPage } from "./pages/Accounts";
import { BudgetsPage } from "./pages/Budgets";
import { DebtsPage } from "./pages/Debts";
import { GoalsPage } from "./pages/Goals";
import { HouseholdPage } from "./pages/Household";
import { ImportPage } from "./pages/Import";
import { JoinPage } from "./pages/Join";
import { OverviewPage } from "./pages/Overview";
import { PensionsPage } from "./pages/Pensions";
import { PlanPage } from "./pages/Plan";
import { SettingsPage } from "./pages/Settings";
import { TaxPage } from "./pages/Tax";
import { TransactionsPage } from "./pages/Transactions";

const rootRoute = createRootRoute({ component: Layout });

const pages = [
  ["/", OverviewPage],
  ["/plan", PlanPage],
  ["/transactions", TransactionsPage],
  ["/budgets", BudgetsPage],
  ["/accounts", AccountsPage],
  ["/import", ImportPage],
  ["/debts", DebtsPage],
  ["/goals", GoalsPage],
  ["/pensions", PensionsPage],
  ["/tax", TaxPage],
  ["/household", HouseholdPage],
  ["/settings", SettingsPage],
  ["/join", JoinPage],
] as const;

const routeTree = rootRoute.addChildren(pages.map(([path, component]) => createRoute({ getParentRoute: () => rootRoute, path, component })));

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
