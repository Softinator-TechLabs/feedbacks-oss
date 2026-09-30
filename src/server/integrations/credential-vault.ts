import { randomBytes, randomUUID, createCipheriv, createDecipheriv } from "node:crypto";
import type { Config } from "../config.js";
import type { AssetStore } from "../assets.js";
import { fail } from "../errors.js";

export type CredentialScope = Readonly<{
  provider: string;
  identity: string;
  objectPrefix: string;
}>;
export type EncryptedCredential = {
  version: 1;
  iv: string;
  tag: string;
  ciphertext: string;
};
export function credentialScope(
  config: Config,
  provider: string,
  connectionId: string,
): CredentialScope {
  if (
    !/^[a-z][a-z0-9-]{0,39}$/.test(provider) ||
    !connectionId ||
    connectionId.length > 256
  )
    fail("INTEGRATION_CREDENTIAL_INVALID", "Invalid integration credential identity");
  const base = `feedbacks/${config.production ? "production" : "development"}/organizations/${config.organizationId}/server-secrets/`;
  return {
    provider,
    identity: config.organizationId + ":" + connectionId,
    objectPrefix:
      base + (provider === "github" ? "github-apps/" : `integrations/${provider}/`),
  };
}
const aad = (scope: CredentialScope) =>
  Buffer.from(JSON.stringify([1, scope.provider, scope.identity]));
export async function sealCredential(
  store: AssetStore,
  scope: CredentialScope,
  plaintext: string,
) {
  if (!plaintext || Buffer.byteLength(plaintext, "utf8") > 65536)
    fail(
      "INTEGRATION_CREDENTIAL_INVALID",
      "Integration credentials must fit within 64 KB",
    );
  const key = randomBytes(32),
    iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad(scope));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const objectKey = scope.objectPrefix + randomUUID() + ".key";
  try {
    await store.put(objectKey, key, "application/octet-stream");
    if (!(await store.get(objectKey)).equals(key)) throw new Error();
  } catch {
    fail(
      "INTEGRATION_STORAGE_UNAVAILABLE",
      "Private credential storage is unavailable",
      503,
    );
  }
  return {
    objectKey,
    envelope: {
      version: 1 as const,
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    },
  };
}
export async function openCredential(
  store: AssetStore | undefined,
  scope: CredentialScope,
  objectKey: string,
  envelope: EncryptedCredential,
) {
  try {
    if (
      !store ||
      envelope.version !== 1 ||
      !objectKey.startsWith(scope.objectPrefix) ||
      !/^[0-9a-f-]{36}\.key$/.test(objectKey.slice(scope.objectPrefix.length))
    )
      throw new Error();
    const key = await store.get(objectKey);
    if (key.length !== 32) throw new Error();
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(envelope.iv, "base64"),
    );
    decipher.setAAD(aad(scope));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    fail(
      "INTEGRATION_STORAGE_UNAVAILABLE",
      "Private credentials could not be opened. Restore private storage or replace the credential.",
      503,
    );
  }
}
