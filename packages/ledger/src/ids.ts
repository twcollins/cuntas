export function newId(prefix = ""): string {
  const uuid = globalThis.crypto.randomUUID();
  return prefix ? `${prefix}_${uuid}` : uuid;
}
