import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Pool } from "pg";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";
import { configFromEnv } from "../src/server/config.js";
import { refreshTrackerOAuth } from "../src/server/integrations/trackers/oauth.js";
import { trackerOperation } from "../src/server/integrations/trackers/operations.js";
import {
  credentialScope,
  openCredential,
} from "../src/server/integrations/credential-vault.js";
import {
  pollTrackerLinks,
  processTrackerJobs,
} from "../src/server/integrations/trackers/worker.js";

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
test(
  "native tracker races preserve owner-rotated credentials, current connection health and retired moved links",
  { skip: process.env.FEEDBACKS_NATIVE_POSTGRES !== "1" },
  async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "feedbacks-integrations-")),
      data = path.join(dir, "data");
    let pool: Pool | undefined,
      started = false;
    const originalFetch = globalThis.fetch;
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
          `-k '${dir}' -p 55444 -h ''`,
          "-w",
          "start",
        ],
        { stdio: "pipe" },
      );
      started = true;
      pool = new Pool({
        host: dir,
        port: 55444,
        user: "feedbacks_test",
        database: "postgres",
        max: 8,
      });
      const db = new Database(pool);
      await migrate(db);
      const config = configFromEnv({
        DATABASE_URL: "postgres://synthetic",
        TRACKER_OAUTH_BROKER_URL: "https://broker.example.test",
        TRACKER_OAUTH_INSTALLATION_KEY: "synthetic-installation-key".padEnd(40, "a"),
      });
      const keys = new Map<string, Buffer>(),
        store: any = {
          put: async (key: string, bytes: Buffer) => keys.set(key, bytes),
          get: async (key: string) => keys.get(key)!,
        };
      const ops = new Operations(db, store, config),
        owner = await ops.auth.bootstrap(
          "owner@example.test",
          "Owner",
          "Correct-Horse-Battery-123",
        ),
        project = await ops.executeOperation(owner, "projects.create", {
          name: "Synthetic",
          origins: ["https://example.test"],
        });
      // Both callers finish their read-only verification before racing for the account lock.
      // Only the winning transaction seals a key and creates the remembered connection.
      const bothVerifying = gate(),
        finishVerification = gate();
      let verifications = 0;
      const guidedInput = {
        projectId: project.id,
        provider: "asana",
        label: "Guided retry",
        configuration: {
          targetId: "123",
          statusColumn: "status",
          states: [],
          poll: false,
        },
        credential: { token: "synthetic-guided-token", auth: "token" },
        verifyDestination: true,
        idempotencyKey: "native-guided-save-retry",
      };
      const verifyTransport = async () => {
        if (++verifications === 2) bothVerifying.release();
        await finishVerification.promise;
        return new Response(JSON.stringify({ data: { name: "Synthetic destination" } }));
      };
      const concurrentSaves = [1, 2].map(() =>
        trackerOperation(
          db,
          store,
          config,
          owner,
          "trackers.save",
          guidedInput,
          verifyTransport,
        ),
      );
      try {
        await Promise.race([
          bothVerifying.promise,
          new Promise((_, reject) => {
            const timer = setTimeout(
              () => reject(Error("Guided saves did not reach concurrent verification")),
              5000,
            );
            timer.unref();
          }),
        ]);
      } finally {
        finishVerification.release();
      }
      const [firstSave, secondSave] = await Promise.all(concurrentSaves);
      assert.equal(firstSave.id, secondSave.id);
      assert.equal(keys.size, 1, "concurrent saves seal exactly one private key");
      assert.equal(
        (await db.one("SELECT count(*)::int n FROM tracker_connections")).n,
        1,
      );
      assert.equal(
        (
          await trackerOperation(
            db,
            store,
            config,
            owner,
            "trackers.save",
            guidedInput,
            verifyTransport,
          )
        ).id,
        firstSave.id,
      );
      assert.equal(verifications, 2, "committed retry avoids another provider request");
      await assert.rejects(
        trackerOperation(
          db,
          store,
          config,
          owner,
          "trackers.save",
          { ...guidedInput, label: "Changed" },
          verifyTransport,
        ),
        { code: "IDEMPOTENCY_CONFLICT" },
      );
      const jiraConfiguration = {
        targetId: "QA",
        issueTypeId: "10001",
        cloudId: "b59926c7-6474-4931-8cc2-34af0d589444",
        site: "synthetic",
        statusColumn: "status",
        states: [],
        poll: false,
      };
      const staleCredential = {
        token: "synthetic-expired-token",
        refreshToken: "synthetic-refresh-token",
        expiresAt: "2026-01-01T00:00:00.000Z",
        auth: "oauth",
      };
      for (const action of ["rotate", "disable"] as const) {
        const c = await trackerOperation(db, store, config, owner, "trackers.save", {
          projectId: project.id,
          provider: "jira",
          label: "Synthetic " + action,
          configuration: jiraConfiguration,
          credential: staleCredential,
        });
        const snapshot = await db.one("SELECT * FROM tracker_connections WHERE id=$1", [
            c.id,
          ]),
          entered = gate(),
          proceed = gate();
        globalThis.fetch = (async (url: any) => {
          assert.equal(new URL(String(url)).pathname, "/v1/refresh");
          entered.release();
          await proceed.promise;
          return new Response(
            JSON.stringify({
              access_token: "stale-inflight-refresh-token",
              refresh_token: "stale-inflight-rotated-refresh",
              expires_in: 3600,
            }),
          );
        }) as typeof fetch;
        const refreshing = refreshTrackerOAuth(db, store, config, snapshot).then(
          () => null,
          (error) => error,
        );
        await entered.promise;
        if (action === "rotate")
          await trackerOperation(db, store, config, owner, "trackers.save", {
            projectId: project.id,
            provider: "jira",
            label: c.label,
            connectionId: c.id,
            revision: c.revision,
            configuration: jiraConfiguration,
            credential: {
              token: "owner-replacement-token",
              auth: "oauth",
              expiresAt: "2099-01-01T00:00:00.000Z",
            },
          });
        else
          await trackerOperation(db, store, config, owner, "trackers.enable", {
            connectionId: c.id,
            revision: c.revision,
            enabled: false,
          });
        proceed.release();
        assert.equal((await refreshing)?.code, "TRACKER_CONNECTION_CHANGED");
        const row = await db.one("SELECT * FROM tracker_connections WHERE id=$1", [c.id]),
          saved = JSON.parse(
            await openCredential(
              store,
              credentialScope(config, "jira", c.id),
              row.credential_key,
              row.credential,
            ),
          );
        assert.equal(row.revision, c.revision + 1);
        assert.equal(
          saved.token,
          action === "rotate" ? "owner-replacement-token" : staleCredential.token,
        );
        assert.equal(row.enabled, action !== "disable");
      }
      globalThis.fetch = originalFetch;
      const thread = await ops.executeOperation(owner, "threads.create", {
        projectId: project.id,
        body: "Synthetic polling",
        context: { url: "https://example.test", viewport: { width: 1440, height: 900 } },
        idempotencyKey: "native-polling-thread",
      });
      const asanaConfiguration = {
        targetId: "123",
        statusColumn: "status",
        states: [
          { local: "open", remote: "open" },
          { local: "resolved", remote: "completed" },
        ],
        poll: true,
      };
      const good = async (url: string) =>
        new Response(
          JSON.stringify(
            url.includes("/projects/")
              ? { data: { name: "Synthetic" } }
              : {
                  data: {
                    gid: "456",
                    name: "Synthetic task",
                    completed: false,
                    projects: [{ gid: "123" }],
                  },
                },
          ),
        );
      const c = await trackerOperation(db, store, config, owner, "trackers.save", {
        projectId: project.id,
        provider: "asana",
        label: "Synthetic polling",
        configuration: asanaConfiguration,
        credential: { token: "old-asana-token", auth: "token" },
      });
      await trackerOperation(
        db,
        store,
        config,
        owner,
        "trackers.test",
        { connectionId: c.id },
        good,
      );
      await trackerOperation(
        db,
        store,
        config,
        owner,
        "trackers.link",
        {
          connectionId: c.id,
          threadId: thread.id,
          revision: thread.revision,
          remoteId: "456",
          idempotencyKey: "native-link",
        },
        good,
      );
      await processTrackerJobs(db, store, config, good);
      const entered = gate(),
        proceed = gate();
      const stalePoll = pollTrackerLinks(db, store, config, async () => {
        entered.release();
        await proceed.promise;
        return new Response("{}", { status: 401 });
      });
      await entered.promise;
      const rotated = await trackerOperation(db, store, config, owner, "trackers.save", {
        projectId: project.id,
        provider: "asana",
        label: c.label,
        connectionId: c.id,
        revision: c.revision,
        configuration: asanaConfiguration,
        credential: { token: "new-asana-token", auth: "token" },
      });
      await trackerOperation(
        db,
        store,
        config,
        owner,
        "trackers.test",
        { connectionId: c.id },
        good,
      );
      proceed.release();
      await stalePoll;
      const healthy = await db.one("SELECT * FROM tracker_connections WHERE id=$1", [
        c.id,
      ]);
      assert.equal(healthy.revision, rotated.revision);
      assert.equal(healthy.health, "healthy");
      assert.equal(healthy.error_code, null);
      const destination = await ops.executeOperation(owner, "projects.create", {
        name: "Destination",
        origins: ["https://example.test"],
      });
      await db.query("UPDATE tracker_links SET next_poll_at=now() WHERE thread_id=$1", [
        thread.id,
      ]);
      const moveEntered = gate(),
        moveProceed = gate();
      const movingPoll = pollTrackerLinks(db, store, config, async (url) => {
        moveEntered.release();
        await moveProceed.promise;
        return good(url);
      });
      await moveEntered.promise;
      await db.transaction(async (tx) => {
        await tx.query("UPDATE threads SET project_id=$2 WHERE id=$1", [
          thread.id,
          destination.id,
        ]);
        await tx.query(
          "UPDATE tracker_links SET status='moved',next_poll_at='infinity' WHERE thread_id=$1",
          [thread.id],
        );
      });
      moveProceed.release();
      await movingPoll;
      const retired = await db.one(
        "SELECT status,next_poll_at='infinity' AS retired FROM tracker_links WHERE thread_id=$1",
        [thread.id],
      );
      assert.equal(retired.status, "moved");
      assert.equal(retired.retired, true);
      let reads = 0;
      await pollTrackerLinks(db, store, config, async (url) => {
        reads++;
        return good(url);
      });
      assert.equal(reads, 0);
    } finally {
      globalThis.fetch = originalFetch;
      await pool?.end();
      if (started)
        execFileSync("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"], {
          stdio: "pipe",
        });
      await rm(dir, { recursive: true, force: true });
    }
  },
);
