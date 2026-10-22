import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// Envelope encryption: each household has its own data key (DEK), stored encrypted under the
// server's key-encryption key (KEK) from the platform vault. AES-256-GCM throughout.

const IV_BYTES = 12;
const KEY_BYTES = 32;

export function parseKek(base64: string | undefined): Buffer {
  if (!base64) throw new Error("CUNTAS_KEK is not set (32 random bytes, base64)");
  const key = Buffer.from(base64, "base64");
  if (key.length !== KEY_BYTES) throw new Error("CUNTAS_KEK must decode to 32 bytes");
  return key;
}

export function encrypt(key: Buffer, plaintext: string | Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), body.toString("base64")].join(".");
}

export function decryptBuffer(key: Buffer, token: string): Buffer {
  const [v, iv, tag, body] = token.split(".");
  if (v !== "v1" || !iv || !tag || body === undefined) throw new Error("Unrecognised ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]);
}

export function decrypt(key: Buffer, token: string): string {
  return decryptBuffer(key, token).toString("utf8");
}

export function newDataKey(kek: Buffer): { dek: Buffer; dekEncrypted: string } {
  const dek = randomBytes(KEY_BYTES);
  return { dek, dekEncrypted: encrypt(kek, dek) };
}

export function unwrapDataKey(kek: Buffer, dekEncrypted: string): Buffer {
  return decryptBuffer(kek, dekEncrypted);
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}
