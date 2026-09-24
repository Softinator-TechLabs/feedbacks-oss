import test from "node:test";
import assert from "node:assert/strict";
import { configFromEnv } from "../src/server/config.js";
import { spawnSync } from "node:child_process";

test("production requires explicit organization, HTTPS, complete S3 and bounded proxy/pool configuration", () => {
  const production = {
    NODE_ENV: "production",
    APP_ORIGIN: "https://feedback.example.test",
    DATABASE_URL: "postgres://localhost/fixture",
    ORGANIZATION_ID: "00000000-0000-4000-8000-000000000002",
    S3_ENDPOINT: "https://s3.eu-central-1.wasabisys.com",
    S3_REGION: "eu-central-1",
    S3_BUCKET: "example-private-bucket",
    S3_ACCESS_KEY_ID: "fixture",
    S3_SECRET_ACCESS_KEY: "fixture",
  };
  assert.equal(configFromEnv(production).trustProxyHops, 0);
  assert.equal(
    configFromEnv({ ...production, TRUST_PROXY_HOPS: "1", DATABASE_POOL_MAX: "20" })
      .databasePoolMax,
    20,
  );
  for (const patch of [
    { APP_ORIGIN: "http://feedback.example.test" },
    { APP_ORIGIN: "https://feedback.example.test/path" },
    { ASSET_DRIVER: "local" },
    { ORGANIZATION_ID: "" },
    { S3_SECRET_ACCESS_KEY: "" },
    { S3_ENDPOINT: "http://s3.example.test" },
    { S3_ENDPOINT: "https://user:secret@s3.example.test" },
    { S3_ENDPOINT: "https://s3.example.test?credential=fixture" },
    { TRUST_PROXY_HOPS: "-1" },
    { TRUST_PROXY_HOPS: "11" },
    { DATABASE_POOL_MAX: "0" },
    { DATABASE_POOL_MAX: "101" },
    { PORT: "65536" },
  ])
    assert.throws(() => configFromEnv({ ...production, ...patch }));
  assert.equal(
    configFromEnv({ DATABASE_URL: "postgres://localhost/fixture" }).assetDriver,
    "local",
  );
  assert.throws(() => configFromEnv({ ...production, TURNSTILE_SITE_KEY: "site-only" }));
  assert.throws(() =>
    configFromEnv({
      ...production,
      TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
      TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
    }),
  );
});

test("CLI requires an explicit server and rejects non-local HTTP before sending a credential", () => {
  for (const url of [undefined, "http://public.example.test"]) {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "src/cli/feedbacks.ts", "projects.list"],
      {
        encoding: "utf8",
        input: "{}",
        timeout: 10000,
        env: {
          PATH: process.env.PATH ?? "",
          FEEDBACKS_TOKEN: "fixture",
          ...(url ? { FEEDBACKS_URL: url } : {}),
        },
      },
    );
    assert.equal(result.status, 1);
    const body = JSON.parse(result.stdout);
    assert.equal(body.error.code, "CONFIG");
    assert.match(body.error.message, url ? /HTTPS server origin/ : /Set FEEDBACKS_URL/);
  }
});
