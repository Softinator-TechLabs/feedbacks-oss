import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { once } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import { Pool } from "pg";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Auth, accountLock } from "../src/server/auth.js";
import { createApp } from "../src/server/app.js";

test(
  "concurrent password failures share the IP lock across app replicas",
  { skip: process.env.FEEDBACKS_NATIVE_POSTGRES !== "1" },
  async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "feedbacks-login-throttle-"));
    const data = path.join(dir, "data");
    const probe = createServer().listen(0, "127.0.0.1");
    await once(probe, "listening");
    const port = (probe.address() as { port: number }).port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    let postgresStarted = false;
    let pool: Pool | undefined;
    const servers: Array<ReturnType<ReturnType<typeof createApp>["listen"]>> = [];
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
          `-k '${dir}' -p ${port} -h ''`,
          "-w",
          "start",
        ],
        { stdio: "pipe" },
      );
      postgresStarted = true;
      pool = new Pool({
        host: dir,
        port,
        user: "feedbacks_test",
        database: "postgres",
        max: 5,
      });
      const db = new Database(pool);
      await migrate(db);
      await new Auth(db).bootstrap(
        "owner@example.test",
        "Owner",
        "Correct-Horse-Battery-123",
      );
      const config: any = {
        appOrigin: "http://localhost:3000",
        production: false,
        organizationId: "00000000-0000-4000-8000-000000000001",
        trustProxyHops: 0,
      };
      for (let n = 0; n < 2; n++) {
        const server = createApp(config, db, {} as any).listen(0, "127.0.0.1");
        await once(server, "listening");
        servers.push(server);
      }
      const login = (server: (typeof servers)[number], password: string) =>
        fetch(
          `http://127.0.0.1:${(server.address() as { port: number }).port}/api/auth.login`,
          {
            method: "POST",
            headers: { Origin: config.appOrigin, "Content-Type": "application/json" },
            body: JSON.stringify({ email: "owner@example.test", password }),
          },
        );

      const attempts = await Promise.all([
        login(servers[0], "incorrect-password"),
        login(servers[1], "incorrect-password"),
        login(servers[0], "incorrect-password"),
      ]);
      assert.deepEqual(
        attempts.map((response) => response.status).sort(),
        [401, 401, 429],
      );
      const locked = await login(servers[1], "Correct-Horse-Battery-123");
      assert.equal(locked.status, 429);
      assert.ok(Number(locked.headers.get("Retry-After")) > 0);

      let releaseBlocker!: () => void;
      let lockAcquired!: () => void;
      const release = new Promise<void>((resolve) => (releaseBlocker = resolve));
      const acquired = new Promise<void>((resolve) => (lockAcquired = resolve));
      const blocker = db.transaction(async (tx) => {
        await accountLock(tx);
        lockAcquired();
        await release;
      });
      await acquired;
      const pendingLogin = login(servers[0], "Correct-Horse-Battery-123");
      try {
        let waiting = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          const activity = await db.one(
            "SELECT count(*)::integer AS waiting FROM pg_stat_activity WHERE wait_event_type='Lock' AND wait_event='advisory'",
          );
          if (activity.waiting > 0) {
            waiting = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        assert.ok(waiting, "login transaction began before the block expired");
        await db.query(
          "UPDATE login_ip_failures SET blocked_until=statement_timestamp()-interval '1 second',expires_at=statement_timestamp()-interval '1 second'",
        );
      } finally {
        releaseBlocker();
      }
      await blocker;
      assert.equal((await pendingLogin).status, 200);
    } finally {
      for (const server of servers)
        await new Promise<void>((resolve) => server.close(() => resolve()));
      await pool?.end();
      if (postgresStarted)
        execFileSync("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"], {
          stdio: "pipe",
        });
      await rm(dir, { recursive: true, force: true });
    }
  },
);
