import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Pool } from "pg";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";
import { GithubApp } from "../src/server/github-app.js";
import { processGithubComments } from "../src/server/github/comments.js";
import { accountLock } from "../src/server/auth.js";

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
test(
  "native GitHub comment workers claim once and preserve uncertainty when a grant is revoked after accepted send",
  { skip: process.env.FEEDBACKS_NATIVE_POSTGRES !== "1", timeout: 90000 },
  async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "feedbacks-github-comments-")),
      data = path.join(dir, "data");
    let started = false,
      pool: Pool | undefined;
    const entered = gate(),
      proceed = gate();
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
          `-k '${dir}' -p 55447 -h ''`,
          "-w",
          "start",
        ],
        { stdio: "pipe" },
      );
      started = true;
      pool = new Pool({
        host: dir,
        port: 55447,
        user: "feedbacks_test",
        database: "postgres",
        max: 8,
      });
      const db = new Database(pool);
      await migrate(db);
      const config: any = {
        githubAppId: "123",
        githubAppSlug: "feedbacks-test",
        githubAppPrivateKey: generateKeyPairSync("rsa", { modulusLength: 2048 })
          .privateKey.export({ type: "pkcs8", format: "pem" })
          .toString(),
      };
      const issueUrl = "https://github.com/acme/site/issues/13",
        comments: any[] = [];
      let issueBody = "",
        posts = 0,
        hold = false;
      const client = new GithubApp(config, async (input, init) => {
        const url = new URL(String(input));
        assert.equal(url.origin, "https://api.github.com");
        const p = url.pathname;
        if (p.endsWith("/installation")) return Response.json({ id: 91 });
        if (p.endsWith("/access_tokens"))
          return Response.json({ token: "synthetic-installation-token" });
        if (p.endsWith("/issues") && init?.method === "POST") {
          issueBody = JSON.parse(String(init.body)).body;
          return Response.json({ number: 13 }, { status: 201 });
        }
        if (p.endsWith("/issues/13"))
          return Response.json({ html_url: issueUrl, state: "open", body: issueBody });
        if (p.endsWith("/issues/13/comments") && init?.method === "POST") {
          posts++;
          const record = {
            id: 100 + posts,
            html_url: `${issueUrl}#issuecomment-${100 + posts}`,
            issue_url: "https://api.github.com/repos/acme/site/issues/13",
            body: JSON.parse(String(init.body)).body,
            created_at: "2026-10-21T10:00:00Z",
            user: { login: "test[bot]" },
          };
          comments.push(record);
          if (hold) {
            entered.release();
            await proceed.promise;
          }
          return Response.json(record, { status: 201 });
        }
        if (p.includes("/issues/comments/"))
          return Response.json(
            comments.find((row) => row.id === Number(p.split("/").at(-1))),
          );
        throw Error(`Unexpected synthetic request ${p}`);
      });
      const ops = new Operations(db, {} as any, config, client),
        owner = await ops.auth.bootstrap(
          "owner@example.test",
          "Owner",
          "Correct-Horse-Battery-123",
        );
      const project = await ops.executeOperation(owner, "projects.create", {
        name: "Synthetic",
        origins: ["https://example.test"],
        repositoryUrl: "https://github.com/acme/site",
      });
      await ops.executeOperation(owner, "github.connect", {
        projectId: project.id,
        revision: project.revision,
      });
      const raw = await ops.executeOperation(owner, "threads.create", {
        projectId: project.id,
        body: "Synthetic discussion",
        context: { url: "https://example.test", viewport: { width: 1200, height: 800 } },
        idempotencyKey: "github-native-thread",
      });
      const thread = await ops.executeOperation(owner, "github.issueCreate", {
        threadId: raw.id,
        revision: raw.revision,
        reviewed: true,
        title: "Reviewed",
        body: "Reviewed",
        idempotencyKey: "github-native-issue",
      });
      const member = await ops.executeOperation(owner, "members.create", {
        name: "Maintainer",
        email: "member@example.test",
        password: "Correct-Horse-Battery-123",
        grants: [{ projectId: project.id, role: "maintainer" }],
      });
      await db.query("UPDATE users SET must_change_password=false WHERE id=$1", [
        member.id,
      ]);
      const actor = (
        await ops.auth.login("member@example.test", "Correct-Horse-Battery-123")
      ).actor;
      const input = {
        threadId: thread.id,
        revision: thread.revision,
        issueUrl,
        body: "Reviewed native comment",
        reviewed: true as const,
        idempotencyKey: "github-native-concurrent-intent",
      };
      const reservations = await Promise.all([
        ops.executeOperation(actor, "github.commentQueue", input),
        ops.executeOperation(actor, "github.commentQueue", input),
      ]);
      assert.equal(reservations[0].id, reservations[1].id);
      hold = true;
      const first = processGithubComments(db, config, client);
      await entered.promise;
      await processGithubComments(db, config, client);
      assert.equal(posts, 1);
      const destination = await ops.executeOperation(owner, "projects.create", {
        name: "Destination",
        origins: ["https://example.test"],
      });
      await assert.rejects(
        ops.executeOperation(owner, "threads.move", {
          threadId: thread.id,
          revision: thread.revision,
          projectId: destination.id,
        }),
        { code: "CONFLICT" },
      );
      await db.transaction(async (tx) => {
        await accountLock(tx);
        await tx.query("DELETE FROM grants WHERE user_id=$1 AND project_id=$2", [
          actor.userId,
          project.id,
        ]);
      });
      proceed.release();
      await first;
      await processGithubComments(db, config, client);
      const job = await db.one("SELECT * FROM github_comment_jobs WHERE id=$1", [
        reservations[0].id,
      ]);
      assert.equal(posts, 1);
      assert.equal(job.status, "uncertain");
      assert.equal(job.error_code, "FORBIDDEN");
      assert.equal(Number(job.comment_id), 101);
      const fixed = await ops.executeOperation(owner, "github.commentReconcile", {
        jobId: job.id,
        outcome: "delivered",
        commentId: 101,
        confirmed: true,
      });
      assert.equal(fixed.status, "delivered");
      const lost = await ops.executeOperation(owner, "github.commentQueue", {
        ...input,
        idempotencyKey: "github-native-expired-lease",
      });
      await db.query(
        "UPDATE github_comment_jobs SET status='processing',attempts=2,lease_until=now()-interval '1 second' WHERE id=$1",
        [lost.id],
      );
      await Promise.all([
        processGithubComments(db, config, client),
        processGithubComments(db, config, client),
      ]);
      assert.equal(
        (await db.one("SELECT status FROM github_comment_jobs WHERE id=$1", [lost.id]))
          .status,
        "uncertain",
      );
      assert.equal(posts, 1);
    } finally {
      proceed.release();
      await pool?.end();
      if (started)
        execFileSync("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"], {
          stdio: "pipe",
        });
      await rm(dir, { recursive: true, force: true });
    }
  },
);
