// Files that arrive from outside a page's own picker: dropped on the window, opened in the app from
// Files or the share sheet, or from an installed web app's file handler. Each goes to the page that
// reads that kind of file, which takes it from the queue here and checks it as it would a picked file.

export type OpenedKind = "statement" | "rules" | "backup";

export const OPENED_ROUTE = { statement: "/import", rules: "/tax-rules", backup: "/settings" } as const satisfies Record<OpenedKind, string>;

export function kindOf(name: string): OpenedKind {
  const ext = name.toLowerCase().split(".").at(-1);
  if (ext === "yaml" || ext === "yml") return "rules";
  if (ext === "cuntas" || ext === "json") return "backup";
  return "statement";
}

const queues: Record<OpenedKind, File[]> = { statement: [], rules: [], backup: [] };
const listeners = new Set<() => void>();

/** Queues the files by kind; returns the page to show, for the first file's kind. */
export function openFiles(files: File[]): (typeof OPENED_ROUTE)[OpenedKind] | null {
  if (files.length === 0) return null;
  for (const f of files) queues[kindOf(f.name)].push(f);
  for (const l of listeners) l();
  return OPENED_ROUTE[kindOf(files[0]!.name)];
}

/** Files of this kind waiting since the page last looked; empties that queue. */
export function takeOpened(kind: OpenedKind): File[] {
  const out = queues[kind];
  queues[kind] = [];
  return out;
}

/** Calls back whenever files are queued, for a page that is already open. */
export function onOpened(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
