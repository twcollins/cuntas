import { useState } from "react";
import { Button, Card, Field, Input, PageHeader } from "../components/ui";
import { apiClient } from "../lib/api";
import { replaceDataset, useStore } from "../lib/store";

/** Accepts a household invite link: /join#<token>. */
export function JoinPage() {
  const { sync } = useStore();
  const [url, setUrl] = useState(sync?.apiUrl ?? "http://localhost:8787");
  const [name, setName] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const token = window.location.hash.slice(1);

  async function join(signIn: "new" | "existing") {
    const api = apiClient(url);
    try {
      if (signIn === "new") await api.register(name);
      else await api.signIn();
      const { householdId } = await api.acceptInvite(token);
      const doc = await api.getDocument(householdId);
      if (doc.dataset) replaceDataset(doc.dataset, { apiUrl: url, householdId, version: doc.version, dirty: false, lastSyncedAt: new Date().toISOString() });
      setStatus("You've joined the household.");
    } catch (e) {
      setStatus(`Could not join: ${(e as Error).message}`);
    }
  }

  return (
    <div>
      <PageHeader title="Join a household" />
      <Card>
        {!token ? <p className="text-sm">This invite link is missing its token.</p> : (
          <div className="space-y-3">
            <Field label="Server URL">{(id) => <Input id={id} value={url} onChange={(e) => setUrl(e.target.value)} />}</Field>
            <Field label="Your name (new account)">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
            <div className="flex gap-2">
              <Button variant="primary" disabled={!name} onClick={() => join("new")}>Create passkey and join</Button>
              <Button onClick={() => join("existing")}>Sign in and join</Button>
            </div>
            <p className="text-xs text-stone-500">Joining replaces the data on this device with the shared household.</p>
          </div>
        )}
        {status && <p className="mt-3 text-sm">{status}</p>}
      </Card>
    </div>
  );
}
