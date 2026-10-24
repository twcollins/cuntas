import { createEmptyDataset, type Dataset } from "@cuntas/ledger";
import type { Currency } from "@cuntas/rules";
import { apiClient, ApiError, withReauth } from "./api";
import { addHousehold, findSynced, setAccount, setSync, switchHousehold, type ServerAccount, type SyncMeta } from "./store";

// Talking to an optional self-hosted server: signing in, and moving households between this
// device and the server. Nothing here replaces data on the device without the caller asking.

/** The server this build points at; people can change it on the Account screen. */
export const DEFAULT_API_URL: string = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:8787";

export type ServerHousehold = Awaited<ReturnType<ReturnType<typeof apiClient>["me"]>>["households"][number];

export const cleanUrl = (url: string) => url.trim().replace(/\/$/, "");

const syncMeta = (apiUrl: string, householdId: string, version: number): SyncMeta => ({ apiUrl, householdId, version, dirty: false, lastSyncedAt: new Date().toISOString() });

/** Sign in (or create a sign-in) with a passkey, remember the account, and list its households. */
export async function signInToServer(apiUrl: string, mode: { register: string } | "signIn"): Promise<{ account: ServerAccount; households: ServerHousehold[] }> {
  const url = cleanUrl(apiUrl);
  const api = apiClient(url);
  if (mode === "signIn") await api.signIn();
  else await api.register(mode.register);
  return refreshAccount(url);
}

/** Re-read who is signed in; clears the account if the session has gone. */
export async function refreshAccount(apiUrl: string): Promise<{ account: ServerAccount; households: ServerHousehold[] }> {
  try {
    const me = await apiClient(apiUrl).me();
    const account = { apiUrl, userId: me.user.id, displayName: me.user.displayName, isAdmin: me.user.isAdmin };
    setAccount(account);
    return { account, households: me.households };
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) setAccount(null);
    throw e;
  }
}

export async function signOut(apiUrl: string) {
  await apiClient(apiUrl).logout().catch(() => undefined);
  setAccount(null);
}

/**
 * Open a server household on this device. If a copy is already here it is switched to, not
 * replaced; replacing it is a separate, confirmed action (`replaceWithServerCopy`).
 */
export async function openServerHousehold(apiUrl: string, hh: ServerHousehold): Promise<"switched" | "added"> {
  const existing = findSynced(apiUrl, hh.id);
  if (existing) {
    await switchHousehold(existing.id);
    return "switched";
  }
  const api = apiClient(apiUrl);
  const remote = await api.getDocument(hh.id);
  if (remote.dataset) {
    await addHousehold(remote.dataset, syncMeta(apiUrl, hh.id, remote.version));
  } else {
    // A household created on the server (for example by an admin) with no data yet.
    const ds = createEmptyDataset(hh.name, hh.baseCurrency === "GBP" ? "GBP" : "EUR");
    const r = await api.putDocument(hh.id, remote.version, ds);
    await addHousehold(ds, syncMeta(apiUrl, hh.id, r.version));
  }
  return "added";
}

/** Upload the active household as a new server household and start syncing it. */
export async function uploadActiveHousehold(apiUrl: string, ds: Dataset) {
  const api = apiClient(apiUrl);
  const { id } = await api.createHousehold(ds.household.name, ds.household.baseCurrency);
  const r = await api.putDocument(id, 0, ds);
  setSync(syncMeta(apiUrl, id, r.version));
}

/** Start a new household that exists on the server as well as this device. */
export async function createOnServer(apiUrl: string, name: string, currency: Currency) {
  const ds = createEmptyDataset(name, currency);
  const api = apiClient(apiUrl);
  const { id } = await api.createHousehold(name, currency);
  const r = await api.putDocument(id, 0, ds);
  await addHousehold(ds, syncMeta(apiUrl, id, r.version));
}

/** Accept an invite and open the shared household as a new household on this device. */
export async function joinWithInvite(apiUrl: string, token: string, mode: { register: string } | "signIn" | "current") {
  if (mode !== "current") await signInToServer(apiUrl, mode);
  const url = cleanUrl(apiUrl);
  const { householdId } = await apiClient(url).acceptInvite(token);
  const { households } = await refreshAccount(url);
  const hh = households.find((h) => h.id === householdId) ?? { id: householdId, name: "Shared household", baseCurrency: "EUR", role: "member", suspended: false };
  return openServerHousehold(url, hh);
}

/** Deleting on the server needs a recent passkey check; asks for one if the server wants it. */
export async function deleteOnServer(apiUrl: string, householdId: string) {
  const api = apiClient(apiUrl);
  await withReauth(api, () => api.deleteHousehold(householdId));
}
