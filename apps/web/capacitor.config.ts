import type { CapacitorConfig } from "@capacitor/cli";
// Type-only: these bring each plugin's config options into CapacitorConfig without loading plugin code.
import type {} from "@capacitor-community/sqlite";
import type { KeyboardResize } from "@capacitor/keyboard";
import type {} from "@capacitor/splash-screen";

// Native wrapper for iOS and Android. The app inside is the same local-first PWA build
// (`pnpm --filter @cuntas/web build:native`), without the service worker.
const config: CapacitorConfig = {
  appId: "ie.cuntas.app",
  appName: "Cúntas",
  webDir: "dist",
  android: { allowMixedContent: false },
  // The page pads itself with the safe-area insets (viewport-fit=cover), so the web view adds none.
  ios: { contentInset: "never" },
  server: { androidScheme: "https" },
  plugins: {
    // Household data: SQLCipher-encrypted SQLite; the plugin keeps the key in the Keychain / Android Keystore.
    CapacitorSQLite: { iosDatabaseLocation: "Library/CapacitorDatabase", iosIsEncryption: true, iosKeychainPrefix: "cuntas", androidIsEncryption: true },
    // Hidden by the app once its data has loaded (lib/native.ts).
    SplashScreen: { launchAutoHide: false, backgroundColor: "#f8faf9" },
    // The web view shrinks above the keyboard, so inputs near the bottom aren't covered.
    Keyboard: { resize: "native" as KeyboardResize, resizeOnFullScreen: true },
  },
};

export default config;
