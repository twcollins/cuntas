import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decrypt, encrypt, newDataKey, parseKek, unwrapDataKey } from "../src";

describe("envelope encryption", () => {
  it("round-trips through a wrapped data key and detects tampering", () => {
    const kek = parseKek(randomBytes(32).toString("base64"));
    const { dek, dekEncrypted } = newDataKey(kek);
    const token = encrypt(dek, "hello household");
    expect(decrypt(unwrapDataKey(kek, dekEncrypted), token)).toBe("hello household");
    const parts = token.split(".");
    parts[3] = Buffer.from("tampered").toString("base64");
    expect(() => decrypt(dek, parts.join("."))).toThrow();
  });
});
