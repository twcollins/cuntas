import { useState } from "react";
import { Button, Card, Field, Input, PageHeader } from "../components/ui";
import { cleanUrl, DEFAULT_API_URL, joinWithInvite } from "../lib/server";
import { useStore } from "../lib/store";

/**
 * Accepts a household invite link: /join#<token>. The shared household is added to this device
 * alongside any others. `standalone` renders it outside the app shell, for a device with no
 * household yet.
 */
export function JoinPage({ standalone = false }: { standalone?: boolean }) {
  const { account } = useStore();
  const [url, setUrl] = useState(account?.apiUrl ?? DEFAULT_API_URL);
  const [name, setName] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const token = window.location.hash.slice(1);

  async function join(mode: { register: string } | "signIn" | "current") {
    try {
      setStatus(null);
      await joinWithInvite(cleanUrl(url), token, mode);
      // Leave /join (the invite is spent) and land on the overview of the joined household.
      window.history.replaceState(null, "", "/");
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch (e) {
      setStatus(`Could not join: ${(e as Error).message}`);
    }
  }

  const body = (
    <Card>
      {!token ? <p className="text-sm">This invite link is missing its token.</p> : (
        <div className="space-y-3">
          <p className="text-sm text-stone-600 dark:text-stone-400">The shared household is added to this device. Any households already here are kept.</p>
          <Field label="Server address">{(id) => <Input id={id} value={url} onChange={(e) => setUrl(e.target.value)} />}</Field>
          {account && cleanUrl(url) === account.apiUrl ? (
            <Button variant="primary" onClick={() => join("current")}>Join as {account.displayName}</Button>
          ) : (
            <>
              <Field label="Your name (new sign-in)">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" disabled={!name.trim()} onClick={() => join({ register: name.trim() })}>Create passkey and join</Button>
                <Button onClick={() => join("signIn")}>Sign in and join</Button>
              </div>
            </>
          )}
        </div>
      )}
      {status && <p className="mt-3 text-sm">{status}</p>}
    </Card>
  );

  return standalone ? (
    <div className="mx-auto max-w-xl px-4 py-12">
      <PageHeader title="Join a household" />
      {body}
    </div>
  ) : (
    <div>
      <PageHeader title="Join a household" />
      {body}
    </div>
  );
}
