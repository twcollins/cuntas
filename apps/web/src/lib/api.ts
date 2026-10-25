import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import type { Dataset } from "@cuntas/ledger";
import type { Currency, Jurisdiction } from "@cuntas/rules";

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly body?: unknown) {
    super(message);
  }
}

export function apiClient(baseUrl: string) {
  async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, {
      credentials: "include",
      ...init,
      headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    });
    const body = res.headers.get("content-type")?.includes("json") ? await res.json() : await res.text();
    if (!res.ok) throw new ApiError((body as { error?: string })?.error ?? res.statusText, res.status, body);
    return body as T;
  }
  return {
    me: () => call<{ user: { id: string; displayName: string; isAdmin: boolean }; households: { id: string; name: string; baseCurrency: string; role: string; suspended: boolean }[] }>("/me"),
    async register(displayName: string) {
      const options = await call<Parameters<typeof startRegistration>[0]["optionsJSON"]>("/auth/passkey/register/options", { method: "POST", body: JSON.stringify({ displayName }) });
      const response = await startRegistration({ optionsJSON: options });
      return call<{ ok: boolean }>("/auth/passkey/register/verify", { method: "POST", body: JSON.stringify(response) });
    },
    async signIn() {
      const options = await call<Parameters<typeof startAuthentication>[0]["optionsJSON"]>("/auth/passkey/login/options", { method: "POST" });
      const response = await startAuthentication({ optionsJSON: options });
      return call<{ ok: boolean }>("/auth/passkey/login/verify", { method: "POST", body: JSON.stringify(response) });
    },
    logout: () => call("/auth/logout", { method: "POST" }),
    createHousehold: (name: string, baseCurrency: string) => call<{ id: string }>("/households", { method: "POST", body: JSON.stringify({ name, baseCurrency }) }),
    getDocument: (hh: string) => call<{ version: number; dataset: Dataset | null }>(`/households/${hh}/document`),
    putDocument: (hh: string, baseVersion: number, dataset: Dataset) => call<{ version: number }>(`/households/${hh}/document`, { method: "PUT", body: JSON.stringify({ baseVersion, dataset }) }),
    deleteHousehold: (hh: string) => call<{ ok: boolean }>(`/households/${hh}`, { method: "DELETE" }),
    invite: (hh: string, role: "owner" | "member" = "member") => call<{ url: string }>(`/households/${hh}/invites?role=${role}`, { method: "POST" }),
    members: (hh: string) => call<HouseholdMember[]>(`/households/${hh}/members`),
    setMemberRole: (hh: string, userId: string, role: "owner" | "member") => call<{ ok: boolean }>(`/households/${hh}/members/${userId}`, { method: "PATCH", body: JSON.stringify({ role }) }),
    removeMember: (hh: string, userId: string) => call<{ ok: boolean }>(`/households/${hh}/members/${userId}`, { method: "DELETE" }),
    admin: {
      households: () => call<AdminHousehold[]>("/admin/households"),
      create: (body: { name: string; baseCurrency: Currency; joinAsOwner: boolean }) => call<{ id: string; name: string; ownerInviteUrl: string | null }>("/admin/households", { method: "POST", body: JSON.stringify(body) }),
      update: (hh: string, body: { name?: string; suspended?: boolean }) => call<{ ok: boolean }>(`/admin/households/${hh}`, { method: "PATCH", body: JSON.stringify(body) }),
      remove: (hh: string) => call<{ ok: boolean }>(`/admin/households/${hh}`, { method: "DELETE" }),
      members: (hh: string) => call<HouseholdMember[]>(`/admin/households/${hh}/members`),
      setRole: (hh: string, userId: string, role: "owner" | "member") => call<{ ok: boolean }>(`/admin/households/${hh}/members/${userId}`, { method: "PATCH", body: JSON.stringify({ role }) }),
      removeMember: (hh: string, userId: string) => call<{ ok: boolean }>(`/admin/households/${hh}/members/${userId}`, { method: "DELETE" }),
      invite: (hh: string, role: "owner" | "member") => call<{ url: string }>(`/admin/households/${hh}/invites`, { method: "POST", body: JSON.stringify({ role }) }),
      users: () => call<{ id: string; displayName: string; isAdmin: boolean; createdAt: string }[]>("/admin/users"),
    },
    acceptInvite: (token: string) => call<{ householdId: string }>("/invites/accept", { method: "POST", body: JSON.stringify({ token }) }),
    institutions: (hh: string, country: Jurisdiction) => call<{ id: string; name: string; country: string }[]>(`/households/${hh}/institutions?country=${country}`),
    connect: (hh: string, body: { institutionId: string; institutionName: string; country: Jurisdiction }) => call<{ url: string }>(`/households/${hh}/connections`, { method: "POST", body: JSON.stringify(body) }),
    connections: (hh: string) => call<{ id: string; institutionName: string; status: string; consentExpiresAt: string | null; lastSyncedAt: string | null; accounts: { ref: string; name: string; currency: string }[] }[]>(`/households/${hh}/connections`),
    syncConnection: (hh: string, id: string) => call<{ fetched: number; status: string }>(`/households/${hh}/connections/${id}/sync`, { method: "POST" }),
    connectionTransactions: (hh: string, id: string, since: string) => call<{ accountRef: string; transaction: import("@cuntas/importers").ParsedTransaction }[]>(`/households/${hh}/connections/${id}/transactions?since=${since}`),
    revokeConnection: (hh: string, id: string) => call(`/households/${hh}/connections/${id}`, { method: "DELETE" }),
    fx: (from: string, to: string) => call<import("@cuntas/ledger").FxRate[]>(`/fx?from=${from}&to=${to}`),
  };
}

export type Api = ReturnType<typeof apiClient>;

export interface HouseholdMember {
  userId: string;
  displayName: string;
  role: string;
  joinedAt: string;
}

export interface AdminHousehold {
  id: string;
  name: string;
  baseCurrency: string;
  createdAt: string;
  suspendedAt: string | null;
  memberCount: number;
  ownerNames: string[];
  documentVersion: number | null;
  documentUpdatedAt: string | null;
  connectionCount: number;
}

/** Runs an API call; if the server asks for fresh authentication, signs in with a passkey and retries once. */
export async function withReauth<T>(api: Api, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ApiError && e.status === 403 && /re-authenticate/i.test(e.message)) {
      await api.signIn();
      return fn();
    }
    throw e;
  }
}
