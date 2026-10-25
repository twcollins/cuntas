import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { loadRulePacks, useRulePacks } from "./lib/rulepacks";
import { loadStore, useStore } from "./lib/store";
import { initNative } from "./lib/native";
import { initTheme } from "./lib/theme";
import { JoinPage } from "./pages/Join";
import { Onboarding } from "./pages/Onboarding";
import { router } from "./router";

const queryClient = new QueryClient();
initTheme();
void initNative();

function App() {
  const { status } = useStore();
  const rules = useRulePacks();
  useEffect(() => {
    // Rule files load first so every calculation uses them from the first render.
    void loadRulePacks().then(loadStore);
  }, []);
  if (status === "loading" || rules.status === "loading") return <div className="p-8 text-sm text-stone-500">Loading…</div>;
  if (status === "empty") return window.location.pathname === "/join" ? <JoinPage standalone /> : <Onboarding />;
  return <RouterProvider router={router} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
