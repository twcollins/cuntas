import { Capacitor } from "@capacitor/core";
import type { Platform } from "./types";
import { web } from "./web";

export type { FileGateway, KeyValueStore, OutgoingFile, Platform } from "./types";

let current: Platform = web;
let started: Promise<void> | null = null;

/** The device's storage and files: IndexedDB and downloads on the web, SQLite and the share sheet in the apps. */
export const platform = (): Platform => current;

/** Picks the native implementation inside the iOS and Android apps. Runs once, before anything is loaded. */
export function initPlatform(): Promise<void> {
  started ??= (async () => {
    const name = Capacitor.getPlatform();
    if (name !== "ios" && name !== "android") return;
    try {
      const { native } = await import("./native");
      current = await native(name);
    } catch (e) {
      // Without the database the app still runs on the web view's storage, and says so.
      current = { ...web, name, warning: `The app's encrypted storage couldn't be opened (${(e as Error).message}). Your data is kept in the app's web storage for now; export a backup.` };
    }
  })();
  return started;
}

/** For tests. */
export function setPlatform(p: Platform) {
  current = p;
}
