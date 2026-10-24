import type { CapacitorConfig } from "@capacitor/cli";

// Native wrapper for iOS and Android. The app inside is the same local-first PWA build
// (`pnpm --filter @cuntas/web build:native`), without the service worker.
const config: CapacitorConfig = {
  appId: "ie.cuntas.app",
  appName: "Cúntas",
  webDir: "dist",
  android: { allowMixedContent: false },
  ios: { contentInset: "automatic" },
  server: { androidScheme: "https" },
};

export default config;
