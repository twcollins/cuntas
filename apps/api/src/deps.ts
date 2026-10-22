import type { Db } from "@cuntas/db";
import type { BankDataProvider } from "@cuntas/providers";

export interface AppDeps {
  db: Db;
  /** Key-encryption key for household data keys and tokens. */
  kek: Buffer;
  provider: BankDataProvider;
  rp: { id: string; name: string; origin: string };
  /** Where the PWA is served, for redirects after bank consent and CORS. */
  webOrigin: string;
  apiOrigin: string;
  secureCookies: boolean;
  rulesSigningKey?: string;
  fetch?: typeof fetch;
  now?: () => Date;
}

export type Env = {
  Variables: {
    deps: AppDeps;
    user: { id: string; displayName: string; sessionId: string; reauthAt: string } | null;
  };
};
