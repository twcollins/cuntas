import { Capacitor } from "@capacitor/core";

/** True inside the iOS or Android app built with Capacitor. */
export const isNative = Capacitor.isNativePlatform();

/** Native-only behaviour: the Android back button walks back through the app before closing it. */
export async function initNative() {
  if (!isNative) return;
  const { App } = await import("@capacitor/app");
  await App.addListener("backButton", ({ canGoBack }) => {
    if (canGoBack) window.history.back();
    else void App.exitApp();
  });
}
