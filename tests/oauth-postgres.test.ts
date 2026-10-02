import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Pool } from "pg";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";
import { McpOAuth } from "../src/server/oauth.js";

test(
  "OAuth codes and refresh rotation serialize across PostgreSQL connections",
  { skip: process.env.FEEDBACKS_NATIVE_POSTGRES !== "1" },
  async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "feedbacks-oauth-")),
      data = path.join(dir, "data");
    let started = false,
      pool: Pool | undefined;
    try {
      execFileSync(
        "initdb",
        ["-D", data, "-U", "feedbacks_test", "-A", "trust", "--no-locale", "-E", "UTF8"],
        { stdio: "pipe" },
      );
      execFileSync(
        "pg_ctl",
        [
          "-D",
          data,
          "-l",
          path.join(dir, "postgres.log"),
          "-o",
          `-k '${dir}' -p 55432 -h ''`,
          "-w",
          "start",
        ],
        { stdio: "pipe" },
      );
      started = true;
      pool = new Pool({
        host: dir,
        port: 55432,
        user: "feedbacks_test",
        database: "postgres",
        max: 5,
      });
      const db = new Database(pool);
      await Promise.all([migrate(db), migrate(db)]);
      const config: any = {
        appOrigin: "https://review.example.test",
        mcpOAuthEnabled: true,
      };
      const ops = new Operations(db, {} as any, config),
        oauth = new McpOAuth(db, config);
      const owner = await ops.auth.bootstrap(
        "owner@example.test",
        "Owner",
        "Correct-Horse-Battery-123",
      );
      const login = await ops.auth.login(
        "owner@example.test",
        "Correct-Horse-Battery-123",
      );
      const human = await ops.auth.authenticate(undefined, login.token);
      const project = await ops.executeOperation(owner, "projects.create", {
        name: "Review",
        origins: ["https://example.test"],
      });
      const client = await oauth.register({
        redirect_uris: ["https://client.example.test/callback"],
      });
      const verifier = "v".repeat(64);
      const issue = async () => {
        const location = await oauth.authorize({
          client_id: client.client_id,
          redirect_uri: client.redirect_uris[0],
          response_type: "code",
          resource: oauth.resource,
          code_challenge_method: "S256",
          code_challenge: createHash("sha256").update(verifier).digest("base64url"),
          scope: "feedbacks:read offline_access",
        });
        const consent = await oauth.consent(human, {
          request: new URL(location).searchParams.get("request"),
          approve: true,
          projectIds: [project.id],
        });
        return {
          grant_type: "authorization_code",
          client_id: client.client_id,
          resource: oauth.resource,
          code: new URL(consent.redirect).searchParams.get("code")!,
          redirect_uri: client.redirect_uris[0],
          code_verifier: verifier,
        };
      };
      const code = await issue();
      const exchanges = await Promise.allSettled([oauth.token(code), oauth.token(code)]);
      assert.equal(exchanges.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(exchanges.filter((r) => r.status === "rejected").length, 1);
      const successful = exchanges.find(
        (r) => r.status === "fulfilled",
      ) as PromiseFulfilledResult<any>;
      await assert.rejects(
        ops.auth.authenticate(successful.value.access_token, undefined, oauth.resource),
        /expired or revoked/,
      );
      const fresh = await oauth.token(await issue());
      const refresh = {
        grant_type: "refresh_token",
        client_id: client.client_id,
        resource: oauth.resource,
        refresh_token: fresh.refresh_token,
      };
      const rotations = await Promise.allSettled([
        oauth.token(refresh),
        oauth.token(refresh),
      ]);
      assert.equal(rotations.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(rotations.filter((r) => r.status === "rejected").length, 1);
      const rotated = rotations.find(
        (r) => r.status === "fulfilled",
      ) as PromiseFulfilledResult<any>;
      await assert.rejects(
        ops.auth.authenticate(rotated.value.access_token, undefined, oauth.resource),
        /expired or revoked/,
      );
      await assert.rejects(
        oauth.token({ ...refresh, refresh_token: rotated.value.refresh_token }),
        /revoked/,
      );
    } finally {
      await pool?.end();
      if (started)
        execFileSync("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"], {
          stdio: "pipe",
        });
      await rm(dir, { recursive: true, force: true });
    }
  },
);
