import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { loadStore, useStore } from "./lib/store";
import { Onboarding } from "./pages/Onboarding";
import { router } from "./router";

const queryClient = new QueryClient();

function App() {
  const { status } = useStore();
  useEffect(() => {
    void loadStore();
  }, []);
  if (status === "loading") return <div className="p-8 text-sm text-stone-500">Loading…</div>;
  if (status === "empty") return <Onboarding />;
  return <RouterProvider router={router} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
