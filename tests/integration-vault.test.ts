import test from "node:test";
import assert from "node:assert/strict";
import { configFromEnv } from "../src/server/config.js";

test("shared credentials are bound to provider, server and connection and use only the installation prefix", async () => {
  const { credentialScope, sealCredential, openCredential } = await import(
    "../src/server/integrations/credential-vault.js"
  );
  const config = configFromEnv({ DATABASE_URL: "postgres://synthetic" });
  config.production = true;
  const prefix = `feedbacks/production/organizations/${config.organizationId}/`;
  const objects = new Map<string, Buffer>();
  const store = {
    put: async (key: string, bytes: Buffer) => {
      assert.ok(key.startsWith(prefix));
      objects.set(key, bytes);
    },
    get: async (key: string) => {
      const value = objects.get(key);
      if (!value) throw new Error("Synthetic missing object");
      return value;
    },
    remove: async (key: string) => {
      objects.delete(key);
    },
  };
  const scope = credentialScope(config, "gitlab", "connection-1");
  const secret = '{"accessToken":"synthetic-token","refreshToken":"synthetic-refresh"}';
  const sealed = await sealCredential(store, scope, secret);
  assert.equal(sealed.envelope.version, 1);
  assert.equal(
    await openCredential(store, scope, sealed.objectKey, sealed.envelope),
    secret,
  );
  assert.ok(!JSON.stringify(sealed).includes("synthetic-token"));
  for (const changed of [
    { ...scope, provider: "jira" },
    { ...scope, identity: "another-server:connection-1" },
    { ...scope, identity: config.organizationId + ":connection-2" },
  ]) {
    await assert.rejects(
      openCredential(store, changed, sealed.objectKey, sealed.envelope),
      {
        code: "INTEGRATION_STORAGE_UNAVAILABLE",
      },
    );
  }
  await assert.rejects(sealCredential(store, scope, "x".repeat(65537)), {
    code: "INTEGRATION_CREDENTIAL_INVALID",
  });
  assert.throws(() => credentialScope(config, "../github", "connection-1"), {
    code: "INTEGRATION_CREDENTIAL_INVALID",
  });
});
