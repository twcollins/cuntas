# Cúntas: iOS and Android apps

2026-10-25 · Design and implementation plan. Status: phases 1-3 built 2026-10-27, not yet run on a device; phases 4-7 to do.

The iOS and Android apps are the same React app inside a Capacitor shell, with a thin platform layer that swaps in native storage, files, app lock and notifications. All data stays on the phone; signing in to a self-hosted server stays optional. This follows the decisions in [design-and-working-doc.md](design-and-working-doc.md) (Mobile section, decided 2026-10-24).

## Decisions this design builds on

| Decision | Consequence for the apps |
| --- | --- |
| Personal tool, data on the device only | No hosted backend, no analytics, no crash reporter that sends data. Store privacy labels declare no data collected. |
| Self-hosted server optional | Sign-in, sync, sharing and bank connections are hidden until the user adds a server. |
| US launches on web and both stores at once, after USA phase 3 | Phase 3 is done, so the apps are now on the critical path for the US launch. |
| You check tax figures yourself and load rule files | Rule files must open from Files / Downloads and the share sheet. They are data, not code (Apple 2.5.2). |
| Guidance, not advice | Store listings and in-app copy keep naming no products. |

## Where the code is today

| Area | Today | File |
| --- | --- | --- |
| Shell | Capacitor 8, `appId` `ie.cuntas.app`, `webDir: dist`, no service worker in native builds | `apps/web/capacitor.config.ts`, `vite.config.ts` |
| Targets | iOS 15.0 (Swift Package Manager); Android minSdk 24, target/compile 36 | `ios/App`, `android/variables.gradle` |
| Native code | Android back button only | `src/lib/native.ts` |
| Storage | IndexedDB via `idb-keyval`: `cuntas:households:v2`, `cuntas:account:v2`, `cuntas:household:<id>`, `cuntas:rulepacks:v1` | `src/lib/store.ts`, `src/lib/rulepacks.ts` |
| Export | `<a download>` with a blob URL; does nothing useful in a web view | `src/lib/format.ts` |
| Import | `<input type="file">` on Import, Tax rules, Settings restore; works in both web views | pages |
| Backup | AES-GCM, PBKDF2-SHA256 (310,000 rounds), `.cuntas` file | `src/lib/backup.ts` |
| Server sign-in | Browser WebAuthn (`@simplewebauthn/browser`); the API also supports TOTP but the web app has no TOTP screen; session cookie; CORS `EXTRA_ORIGINS`, `CROSS_SITE_COOKIES` already exist for the apps | `src/lib/api.ts`, `apps/api/src/config.ts` |
| Layout | Sidebar plus hamburger; `viewport` without `viewport-fit=cover`; no safe-area insets | `src/components/Layout.tsx`, `index.html` |
| Build | `pnpm --filter @cuntas/web build:native` builds and runs `cap sync` | `package.json` |

## Architecture

One web bundle runs everywhere. Code that touches the platform goes through `src/lib/platform/`, which picks a web or native implementation once at start-up using `isNative`.

```
apps/web/src/lib/platform/
  index.ts        // export const platform: Platform = isNative ? native : web
  types.ts        // the interfaces below
  web.ts          // idb-keyval, <a download>, Notification API no-op, no lock
  native.ts       // Capacitor plugins
  fake.ts         // in-memory, for Vitest and Playwright
```

```ts
export interface Platform {
  kv: KeyValueStore;        // get/set/del/keys of JSON values
  files: FileGateway;       // saveFile(name, mime, data), openedFiles() stream
  lock: AppLock;            // available(), enabled, authenticate(reason)
  notify: LocalNotifier;    // schedule(list), cancelAll()
  share: (text: string, url?: string) => Promise<void>;
  haptics: (kind: "success" | "warning") => void;
}
```

`store.ts` and `rulepacks.ts` stop importing `idb-keyval` and call `platform.kv`; nothing else in the app changes. The ledger, rules and engine packages are untouched.

## Storage

The phone is the only copy for most people, so native storage replaces IndexedDB in the apps.

- **Engine:** SQLite through `@capacitor-community/sqlite`, encrypted with SQLCipher. One table: `kv(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)`. The key names stay exactly as today, so the web and native stores hold the same records.
- **Why not stay on IndexedDB:** the OS can clear web-view storage under storage pressure, and the data can't be encrypted at rest with a key the OS protects.
- **Encryption key:** 256-bit random, made on first launch.
  - iOS: Keychain, `kSecAttrAccessibleAfterFirstUnlock` (not `ThisDeviceOnly`), so an encrypted device backup restores the data to a new phone.
  - Android: wrapped by an Android Keystore key. Keystore keys don't leave the device, so Android cloud backup can't restore the database; set `android:allowBackup="false"` and data-extraction rules that exclude it, and rely on the export reminder below.
- **Writes:** keep `store.ts`'s debounced save. Each save is one SQLite transaction, so a crash mid-save leaves the previous household intact.
- **Migration from IndexedDB** (for anyone who installed a test build): on first native launch, if `kv` is empty and IndexedDB has `cuntas:households:v2`, copy every `cuntas:*` key, read each back, compare, then delete the IndexedDB copies. A failure leaves IndexedDB untouched and shows an error with "Export a backup".
- **Size:** a household with 10 years of transactions is a few MB of JSON; one row per household is fine. Splitting transactions into their own table is deferred until a profile shows a need.

## Files in and out

| Flow | iOS | Android |
| --- | --- | --- |
| Export JSON, CSV, encrypted backup, rule-file draft | Write to the cache directory (`@capacitor/filesystem`), then the share sheet (`@capacitor/share`): Save to Files, AirDrop, Mail | Same; the share sheet offers Drive, Files, email |
| Pick a file (statement, rule file, backup) | Keep `<input type="file">`; WKWebView shows the Files picker | Keep it; Capacitor's web view shows the system picker |
| Open in Cúntas from elsewhere | `CFBundleDocumentTypes` plus exported UTTypes for `.cuntas`, rule `.yaml`; imported types for `.csv`, `.ofx`, `.qfx`, CAMT `.xml` | `intent-filter`s for `ACTION_VIEW` and `ACTION_SEND` with those MIME types and extensions |

Opened files arrive through `@capacitor/app`'s `appUrlOpen` (and Android's send intent). `platform.files.openedFiles()` reads the file and routes by type: a statement goes to Import, a `.yaml` rule file to Tax rules, a `.cuntas` or export to Settings → Restore. Each screen already validates its input, so nothing new is trusted.

**Export reminder:** store `lastExportAt` per household. When it's more than 30 days old and the household has changed since, Overview shows "Back up this household" with one tap to the encrypted backup. It can be hidden for 30 days.

## App lock and privacy screen

- **Lock:** optional Face ID / Touch ID / fingerprint, falling back to the device passcode, using a maintained biometric plugin (for example `@aparajita/capacitor-biometric-auth`). Offered once after the first household is set up; on/off in Settings → Security.
- **When it asks:** on launch, and on resume after 60 seconds in the background (setting: immediately, 1 minute, 5 minutes).
- **Privacy screen:** blur the app-switcher snapshot when lock is on (`@capacitor-community/privacy-screen`); on Android also set `FLAG_SECURE`, which blocks screenshots, so make that its own setting.
- **What it protects:** the UI only. Data at rest is protected by SQLCipher and the OS whether or not the lock is on.
- `NSFaceIDUsageDescription`: "Cúntas uses Face ID to unlock your household data."

## Phone layout

Shared with the PWA, so both get it.

- `index.html`: `viewport-fit=cover`; layout pads with `env(safe-area-inset-*)`.
- Below the `md` breakpoint, a bottom tab bar replaces the hamburger: **Overview, Transactions, Next steps, Plan, More**. More opens a sheet with every other page, grouped as in the Guide.
- Touch targets at least 44 pt; tables become stacked rows under 400 px (Transactions, Bills, Tax rules).
- Native extras: `@capacitor/status-bar` follows the theme; `@capacitor/splash-screen` hides once the store has loaded; `@capacitor/keyboard` resizes the web view so inputs aren't covered.
- Playwright's existing mobile project checks the tab bar, the More sheet and that no page scrolls sideways at 375 px.

## Notifications

Local only; no push service, no server.

- `@capacitor/local-notifications`, scheduled from data already on the device: bill due dates (Bills calendar), tax deadlines (IE, UK, US federal and estimated-tax installments), the yearly "check your tax figures" prompt (1 Nov / 1 Jan), the export reminder, and bank-consent expiry for self-hosters.
- Rescheduled after each save, keeping the next 60 (iOS keeps at most 64 pending).
- Permission asked the first time someone turns on a reminder in Settings → Notifications, never at launch.
- Texts carry no amounts or merchant names: "A bill is due tomorrow", so nothing private shows on the lock screen.

## Network

The apps make two kinds of request, both optional:

1. **Exchange rates** from `api.frankfurter.app` (ECB data). Works from both web views today.
2. **A self-hosted Cúntas server**, only after the user adds one.

## Self-hosted sign-in (optional)

Cookies and WebAuthn don't suit a web view talking to an arbitrary server: WKWebView blocks third-party cookies, and passkeys in an app need an associated domain fixed at build time, which a self-hosted server can't provide. So the apps sign in through the system browser and use a bearer token.

1. The app opens `https://<server>/app-sign-in?state=<random>` in `ASWebAuthenticationSession` (iOS) or a Custom Tab (Android), via `@capacitor/browser`.
2. The web app on the server signs in as today (passkey; TOTP once it has a screen), on the server's own domain, so passkeys work unchanged.
3. The server redirects to `cuntas://auth?code=<one-time code>&state=<random>`.
4. The app checks `state` and posts the code to `POST /auth/app/exchange`, getting a token valid for 90 days, stored in the Keychain / Keystore.
5. `api.ts` sends `Authorization: Bearer <token>` when native, and the cookie otherwise.

API work: the exchange endpoint, an `app_tokens` table (hashed token, user, device name, expiry, last used) with row-level security, `requireUser` accepting either the cookie or a bearer token, and a "Signed-in devices" list with revoke. `CROSS_SITE_COOKIES` stops being needed for the apps.

**Invites and bank consent** use the same `cuntas://` scheme: the server's invite page shows "Open in the app" (`cuntas://join?server=…#token`), and the bank callback redirects to `cuntas://accounts?bank=connected`. Universal Links and App Links are left out: they need one known domain, and self-hosted servers each have their own.

**Delete my account:** `DELETE /me` (removes the user, their tokens, and households where they are the only owner, after a typed confirmation) and a button on Account & sync. Apple requires it in any app where an account can be created.

## Store submission

| Item | iOS | Android |
| --- | --- | --- |
| Publisher account | Apple Developer Program; an organisation account is expected for finance apps (check before enrolling) | Google Play Console; a new personal account must run a closed test with testers for a set period before production |
| Privacy | App Privacy: Data Not Collected; privacy manifest (`PrivacyInfo.xcprivacy`) listing required-reason APIs used by plugins (e.g. `UserDefaults`, file timestamps) | Data safety: no data collected or shared; encryption at rest; deletion available |
| Category | Finance | Finance; complete the financial features declaration (personal budgeting, no lending or payments) |
| Age rating | 4+ | Everyone |
| Review risk | Guideline 4.2 (minimum functionality): native storage, file handling, app lock and notifications are the native value. 2.5.2: rule files are data. | Play policy on financial apps: no loans, so the personal-loan rules don't apply |
| Testing | TestFlight | Internal testing, then closed testing |
| Listing | Name "Cúntas: budget and tax", subtitle, keywords, 6.9" and 6.5" iPhone screenshots from the demo household, iPad optional | Short and full description, phone screenshots, feature graphic 1024×500 |
| URLs | Privacy policy and support pages (from the website brief) | Same |
| Regions | Ireland, UK, US first | Same |

Store rules here come from memory; check each against Apple's App Review Guidelines and Google Play policy pages before submitting.

## Build and release

- **Versions:** one version for web and apps from `apps/web/package.json`; `scripts/bump-native.ts` writes `CFBundleShortVersionString` / `versionName`, and a build number from the CI run number.
- **Icons and splash:** generated from `public/icon.svg` with `@capacitor/assets`.
- **CI** (GitHub Actions):
  - Every PR: unit tests, lint, typecheck, Playwright (desktop and mobile), `build:native`, then `xcodebuild build` for the simulator (macOS runner) and `./gradlew assembleDebug` (Ubuntu). Catches native build breaks early.
  - Tag `v*`: signed builds via fastlane; upload to TestFlight and the Play internal track. Signing keys and the App Store Connect API key live in GitHub secrets.
- **Release order:** web first, then TestFlight / internal testing for a week, then store review.

## Testing

| Layer | How |
| --- | --- |
| Platform layer | Vitest against `fake.ts`; the SQLite store's migration tested with a fake IndexedDB and a fake SQLite (copy, verify, delete; failure leaves the source) |
| Web app | Existing Playwright suite, mobile project extended for the tab bar and More sheet |
| Native | A manual checklist per release on one iPhone and one Android phone: first launch, migration, import a statement from Files, open a rule file from the share sheet, export a backup, restore it, app lock on resume, a scheduled notification, background for an hour and return, delete everything |
| Store builds | TestFlight and closed testing with a few real households before release |

## Phases

The phone layout from phase 2 (safe areas, bottom tabs, More, stacked Transactions rows) shipped in the PWA with UX phase 6 on 2026-10-27; the status bar, splash screen and keyboard items followed with phases 1-3 the same day.

Each phase ends with tests green and the app usable.

1. **Platform layer and storage.** `lib/platform/`, `store.ts` and `rulepacks.ts` on `platform.kv`, SQLite with SQLCipher, migration from IndexedDB. Gate: every current test passes; data survives app kill and reinstall-from-backup.
2. **Phone layout.** Safe areas, bottom tabs, More sheet, status bar, splash, keyboard. Ships to the PWA too.
3. **Files.** Share-sheet export, open-in for statements, rule files and backups, export reminder.
4. **App lock and privacy screen.**
5. **Local notifications.**
6. **Store readiness.** Icons, privacy manifest, listings, screenshots, CI builds, TestFlight and Play closed test. **US launch on both stores after this phase.**
7. **Self-hosted sign-in** (after launch; only self-hosters need it). Browser sign-in with a bearer token, `cuntas://` links, signed-in devices, delete my account.

Phase 7 can move before phase 6 if Apple's review treats the existing server sign-in screen as "account creation" and asks for deletion; hiding Account & sync in the store build until phase 7 avoids that.

## Progress

**Phases 1-3, 2026-10-27.** Built as designed, with these differences:

- `Platform` has `kv`, `files` and an optional `warning`; `lock`, `notify`, `share` and `haptics` arrive with phases 4 and 5. `kv.write(set, del)` replaces separate set and delete so one save is one transaction.
- The SQLite plugin keeps the passphrase itself (`setEncryptionSecret`), so its Keychain accessibility class is the plugin's choice. Check whether it survives an encrypted iPhone backup restore; if not, generate the key in our own Keychain item and pass it as the connection's passphrase.
- If the copy from IndexedDB fails, the app keeps using IndexedDB for that session (rather than stopping) and Settings shows the error with the advice to export.
- Opened files: iOS document types and Android `VIEW` intents. Android `SEND` (sharing a file to Cúntas from another app) needs a send-intent plugin and is not done. The installed PWA gets the same routing through `file_handlers`.
- Exports of several files (CSV) go to one share sheet.
- More opens the existing sidebar drawer rather than a grouped sheet; Bills and Tax rules fit a phone as tables, so no stacked rows.
- The build machine has neither Xcode nor the Android SDK: `cap sync` runs and the projects are updated, but nothing native has been compiled or run. Before phase 4, run the native checklist under Testing on one iPhone and one Android phone, first of all the migration, an app kill straight after a change, and opening a statement from Files.

## Open questions

- Who publishes: an organisation (needs a legal entity and a D-U-N-S number for Apple) or an individual?
- Is `ie.cuntas.app` still the right bundle ID now that the US is in scope? It can't change after the first release.
- Minimum iOS: stay at 15, or move to 16 to match the plugins' support and drop older devices?
- Hide Account & sync in store builds until phase 7, or ship phase 7 first?
- Free, or a one-off price? Affects the listing and the website ("don't say free forever" in the brief).
