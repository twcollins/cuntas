import { Capacitor } from "@capacitor/core";
import { onThemeChange, resolvedTheme } from "./theme";

/** True inside the iOS or Android app built with Capacitor. */
export const isNative = Capacitor.isNativePlatform();

/** Native-only behaviour: the back button, the status bar, and the keyboard. */
export async function initNative() {
  if (!isNative) return;
  const [{ App }, { StatusBar, Style }, { Keyboard }] = await Promise.all([import("@capacitor/app"), import("@capacitor/status-bar"), import("@capacitor/keyboard")]);

  // Android: the back button walks back through the app before closing it.
  await App.addListener("backButton", ({ canGoBack }) => {
    if (canGoBack) window.history.back();
    else void App.exitApp();
  });

  // The page draws under the status bar (it pads with the safe-area insets); the bar's text follows the theme.
  const style = () => void StatusBar.setStyle({ style: resolvedTheme() === "dark" ? Style.Dark : Style.Light }).catch(() => undefined);
  await StatusBar.setOverlaysWebView({ overlay: true }).catch(() => undefined);
  style();
  onThemeChange(style);

  // The web view shrinks above the keyboard (capacitor.config); keep the focused field in view as it does.
  await Keyboard.addListener("keyboardDidShow", () => {
    const el = document.activeElement;
    if (el instanceof HTMLElement) el.scrollIntoView({ block: "center", behavior: "smooth" });
  });
}

/** The native splash screen stays up until the store has loaded, so the app opens on content, not "Loading…". */
export async function hideSplash() {
  if (!isNative) return;
  const { SplashScreen } = await import("@capacitor/splash-screen");
  await SplashScreen.hide({ fadeOutDuration: 150 });
}
