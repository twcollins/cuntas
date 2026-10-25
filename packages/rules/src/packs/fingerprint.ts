/** SHA-256 of a rule file's text, as lowercase hex. Matches the build manifest for built-in packs. */
export async function fingerprint(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
