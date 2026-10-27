import { defineConfig } from "vitest/config";

// Unit tests for the app's own logic (storage, routing of opened files). Browser flows are in e2e/ (Playwright).
export default defineConfig({
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});
