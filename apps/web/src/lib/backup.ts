// Encrypted backups: AES-GCM with a key derived from a passphrase (PBKDF2-SHA256), all in the browser.

const ITERATIONS = 310_000;
const enc = new TextEncoder();

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>) {
  const base = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function encryptBackup(json: string, passphrase: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const body = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(json)));
  return JSON.stringify({ format: "cuntas-backup", v: 1, kdf: "PBKDF2-SHA256", iterations: ITERATIONS, salt: b64(salt), iv: b64(iv), data: b64(body) });
}

export async function decryptBackup(text: string, passphrase: string): Promise<string> {
  const f = JSON.parse(text) as { format: string; salt: string; iv: string; data: string };
  if (f.format !== "cuntas-backup") throw new Error("Not a Cúntas backup file");
  const key = await deriveKey(passphrase, unb64(f.salt));
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(f.iv) }, key, unb64(f.data));
    return new TextDecoder().decode(plain);
  } catch {
    throw new Error("Wrong passphrase or damaged file");
  }
}
