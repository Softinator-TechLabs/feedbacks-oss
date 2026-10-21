import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";
import { GithubApp, GithubCommentError, githubRepo } from "../src/server/github-app.js";
import { processGithubComments } from "../src/server/github/comments.js";

const issueUrl = "https://github.com/acme/site/issues/13";
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const config: any = {
  githubAppId: "123",
  githubAppSlug: "feedbacks-test",
  githubAppPrivateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
};
function provider() {
  const comments: any[] = [];
  const state = {
    issueBody: "Reviewed Issue",
    posts: 0,
    failWrite: false,
    failReadback: false,
    rejectWrite: false,
    rejectStatus: 429,
    retryAfter: "60",
    beforeToken: undefined as undefined | (() => Promise<void>),
    permissions: [] as string[],
    requested: [] as string[],
  };
  const record = (id: number, body: string) => ({
    id,
    html_url: `${issueUrl}#issuecomment-${id}`,
    issue_url: "https://api.github.com/repos/acme/site/issues/13",
    body,
    created_at: "2026-10-21T10:00:00Z",
    user: { login: "feedbacks-test[bot]" },
  });
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input)),
      path = url.pathname;
    assert.equal(url.origin, "https://api.github.com");
    assert.equal(init?.redirect, "error");
    state.requested.push(`${init?.method} ${path}${url.search}`);
    if (path.endsWith("/installation")) return Response.json({ id: 91 });
    if (path.endsWith("/access_tokens")) {
      state.permissions.push(JSON.parse(String(init?.body)).permissions.issues);
      await state.beforeToken?.();
      return Response.json({ token: "synthetic-installation-token" });
    }
    if (path.endsWith("/issues") && init?.method === "POST") {
      state.issueBody = JSON.parse(String(init.body)).body;
      return Response.json({ number: 13 }, { status: 201 });
    }
    if (path.endsWith("/issues/13"))
      return Response.json({
        html_url: issueUrl,
        number: 13,
        state: "open",
        body: state.issueBody,
      });
    if (path.endsWith("/issues/13/comments")) {
      if (init?.method === "POST") {
        state.posts++;
        if (state.rejectWrite)
          return Response.json(
            {},
            { status: state.rejectStatus, headers: { "Retry-After": state.retryAfter } },
          );
        const comment = record(100 + state.posts, JSON.parse(String(init.body)).body);
        comments.push(comment);
        if (state.failWrite) throw new Error("Synthetic lost response");
        return Response.json(comment, { status: 201 });
      }
      assert.equal(url.searchParams.get("per_page"), "20");
      const page = Number(url.searchParams.get("page"));
      return Response.json(comments.slice((page - 1) * 20, page * 20));
    }
    if (path.includes("/issues/comments/")) {
      if (state.failReadback) return Response.json({}, { status: 401 });
      const found = comments.find((entry) => entry.id === Number(path.split("/").at(-1)));
      return found ? Response.json(found) : Response.json({}, { status: 404 });
    }
    throw new Error(`Unexpected synthetic endpoint ${path}`);
  };
  return { state, comments, record, fetcher };
}
async function fixture() {
  const pg = new PGlite(),
    db = new Database(pg as any),
    remote = provider(),
    client = new GithubApp(config, remote.fetcher);
  await migrate(db);
  const ops = new Operations(db, {} as any, config, client);
  const owner = await ops.auth.bootstrap(
    "owner@example.test",
    "Owner",
    "Correct-Horse-Battery-123",
  );
  const project = await ops.executeOperation(owner, "projects.create", {
    name: "Site",
    origins: ["https://example.test"],
    repositoryUrl: "https://github.com/acme/site",
  });
  await ops.executeOperation(owner, "github.connect", {
    projectId: project.id,
    revision: project.revision,
  });
  const original = await ops.executeOperation(owner, "threads.create", {
    projectId: project.id,
    body: "Review checkout",
    context: {
      url: "https://example.test/checkout",
      viewport: { width: 1200, height: 800 },
    },
    idempotencyKey: "github-comment-thread",
  });
  const thread = await ops.executeOperation(owner, "github.issueCreate", {
    threadId: original.id,
    revision: original.revision,
    reviewed: true,
    title: "Review checkout",
    body: "Reviewed Issue",
    idempotencyKey: "github-comment-issue",
  });
  const queue = (idempotencyKey: string, body = "Reviewed discussion reply") =>
    ops.executeOperation(owner, "github.commentQueue", {
      threadId: thread.id,
      revision: thread.revision,
      issueUrl,
      reviewed: true,
      body,
      idempotencyKey,
    });
  const run = () => processGithubComments(db, config, client);
  const job = (id: string) =>
    db.one("SELECT * FROM github_comment_jobs WHERE id=$1", [id]);
  return { pg, db, ops, owner, project, thread, remote, client, queue, run, job };
}

test("GitHub comments require reviewed human maintainer intent, keep one reservation, and verify exact readback", async () => {
  const f = await fixture();
  try {
    const input = {
      threadId: f.thread.id,
      revision: f.thread.revision,
      issueUrl,
      reviewed: true as const,
      body: "Reviewed discussion reply",
      idempotencyKey: "same-comment-intent",
    };
    await assert.rejects(
      f.ops.executeOperation(f.owner, "github.commentQueue", {
        ...input,
        reviewed: false,
      }),
      { code: "VALIDATION" },
    );
    await assert.rejects(
      f.ops.executeOperation({ ...f.owner, kind: "agent" }, "github.commentQueue", input),
      { code: "FORBIDDEN" },
    );
    const invited = await f.ops.executeOperation(f.owner, "members.invite", {
      email: "viewer@example.test",
      projectId: f.project.id,
      role: "viewer",
    });
    await f.ops.auth.acceptInvite(invited.token, "Viewer", "Correct-Horse-Battery-123");
    const viewer = (
      await f.ops.auth.login("viewer@example.test", "Correct-Horse-Battery-123")
    ).actor;
    await assert.rejects(
      f.ops.executeOperation(viewer, "github.comments", {
        threadId: f.thread.id,
        issueUrl,
      }),
      { code: "FORBIDDEN" },
    );
    await assert.rejects(f.ops.executeOperation(viewer, "github.commentQueue", input), {
      code: "FORBIDDEN",
    });
    await assert.rejects(
      f.ops.executeOperation(f.owner, "github.commentQueue", {
        ...input,
        issueUrl: "https://github.com/acme/site/issues/14",
      }),
      { code: "GITHUB_ISSUE_INVALID" },
    );
    const first = await f.ops.executeOperation(f.owner, "github.commentQueue", input);
    assert.equal(first.status, "pending");
    assert.equal(
      (await f.ops.executeOperation(f.owner, "github.commentQueue", input)).id,
      first.id,
    );
    await assert.rejects(
      f.ops.executeOperation(f.owner, "github.commentQueue", {
        ...input,
        body: "Different reply",
      }),
      { code: "IDEMPOTENCY_CONFLICT" },
    );
    assert.equal(f.remote.state.posts, 0);
    await f.run();
    await f.run();
    const saved = await f.job(first.id);
    assert.equal(saved.status, "delivered");
    assert.equal(Number(saved.comment_id), 101);
    assert.equal(f.remote.state.posts, 1);
    const page = await f.ops.executeOperation(f.owner, "github.comments", {
      threadId: f.thread.id,
      issueUrl,
    });
    assert.equal(page.items[0].body, input.body);
    assert.equal(page.page, 1);
    assert.equal(page.hasMore, false);
    assert.equal(f.remote.state.permissions.at(-1), "read");
    const history = await f.ops.executeOperation(f.owner, "github.commentHistory", {
      threadId: f.thread.id,
    });
    assert.equal(history.items[0].commentUrl, `${issueUrl}#issuecomment-101`);
    assert.equal(JSON.stringify(history).includes(input.body), false);
    assert.equal(
      (await f.ops.executeOperation(f.owner, "github.commentQueue", input)).status,
      "delivered",
    );
  } finally {
    await f.pg.close();
  }
});

test("accepted GitHub comment with failed readback and lost write responses stay uncertain until inspected", async () => {
  const f = await fixture();
  try {
    const queued = await f.queue("accepted-readback-unknown");
    f.remote.state.failReadback = true;
    await f.run();
    await f.run();
    assert.equal((await f.job(queued.id)).status, "uncertain");
    assert.equal(Number((await f.job(queued.id)).comment_id), 101);
    assert.equal(f.remote.state.posts, 1);
    await assert.rejects(
      f.ops.executeOperation(f.owner, "threads.move", {
        threadId: f.thread.id,
        revision: f.thread.revision,
        projectId: (
          await f.ops.executeOperation(f.owner, "projects.create", {
            name: "Destination",
            origins: ["https://example.test"],
          })
        ).id,
      }),
      { code: "CONFLICT" },
    );
    await assert.rejects(
      f.ops.executeOperation(f.owner, "threads.delete", {
        projectId: f.project.id,
        threads: [{ threadId: f.thread.id, revision: f.thread.revision }],
        idempotencyKey: "uncertain-comment-delete",
        confirmation: "DELETE",
      }),
      { code: "CONFLICT" },
    );
    f.remote.state.failReadback = false;
    f.remote.comments.push(f.remote.record(999, "Unrelated reply"));
    await assert.rejects(
      f.ops.executeOperation(f.owner, "github.commentReconcile", {
        jobId: queued.id,
        outcome: "delivered",
        commentId: 999,
        confirmed: true,
      }),
      { code: "GITHUB_COMMENT_MISMATCH" },
    );
    const reconciled = await f.ops.executeOperation(f.owner, "github.commentReconcile", {
      jobId: queued.id,
      outcome: "delivered",
      commentId: 101,
      confirmed: true,
    });
    assert.equal(reconciled.status, "delivered");
    const lost = await f.queue("network-lost-write");
    f.remote.state.failWrite = true;
    await f.run();
    await f.run();
    assert.equal((await f.job(lost.id)).status, "uncertain");
    assert.equal(f.remote.state.posts, 2);
    await f.ops.executeOperation(f.owner, "github.commentReconcile", {
      jobId: lost.id,
      outcome: "not_delivered",
      confirmed: true,
    });
    await f.run();
    assert.equal(f.remote.state.posts, 2);
  } finally {
    await f.pg.close();
  }
});

test("queued GitHub comments recheck source access after token acquisition and move safely with historical references", async () => {
  const f = await fixture();
  try {
    const queued = await f.queue("app-disconnected-during-token");
    f.remote.state.beforeToken = async () => {
      await f.db.query(
        "UPDATE projects SET data=jsonb_set(data,'{githubConnected}','false') WHERE id=$1",
        [f.project.id],
      );
    };
    await f.run();
    assert.equal(f.remote.state.posts, 0);
    assert.equal((await f.job(queued.id)).status, "failed");
    f.remote.state.beforeToken = undefined;
    await f.db.query(
      "UPDATE projects SET data=jsonb_set(data,'{githubConnected}','true') WHERE id=$1",
      [f.project.id],
    );
    const pending = await f.queue("pending-before-move");
    const destination = await f.ops.executeOperation(f.owner, "projects.create", {
      name: "Destination",
      origins: ["https://example.test"],
    });
    const moved = await f.ops.executeOperation(f.owner, "threads.move", {
      threadId: f.thread.id,
      revision: f.thread.revision,
      projectId: destination.id,
    });
    assert.equal((await f.job(pending.id)).status, "cancelled");
    await f.run();
    assert.equal(f.remote.state.posts, 0);
    const ownerHistory = await f.ops.executeOperation(f.owner, "github.commentHistory", {
      threadId: moved.id,
    });
    assert.equal(ownerHistory.items.length, 2);
    assert.equal(
      ownerHistory.items.every((j: any) => j.historical),
      true,
    );
    const invite = await f.ops.executeOperation(f.owner, "members.invite", {
      email: "destination@example.test",
      projectId: destination.id,
      role: "maintainer",
    });
    await f.ops.auth.acceptInvite(
      invite.token,
      "Destination maintainer",
      "Correct-Horse-Battery-123",
    );
    const maintainer = (
      await f.ops.auth.login("destination@example.test", "Correct-Horse-Battery-123")
    ).actor;
    assert.equal(
      (
        await f.ops.executeOperation(maintainer, "github.commentHistory", {
          threadId: moved.id,
        })
      ).items.length,
      0,
    );
    await assert.rejects(
      f.ops.executeOperation(maintainer, "github.comments", {
        threadId: moved.id,
        issueUrl,
      }),
      { code: "GITHUB_NOT_CONNECTED" },
    );
    await f.ops.executeOperation(f.owner, "threads.delete", {
      projectId: destination.id,
      threads: [{ threadId: moved.id, revision: moved.revision }],
      idempotencyKey: "moved-comment-delete",
      confirmation: "DELETE",
    });
    assert.equal(await f.job(queued.id), undefined);
  } finally {
    await f.pg.close();
  }
});

test("GitHub comment client bounds reads, rejects wrong Issue associations, and marks accepted-write failures uncertain", async () => {
  const remote = provider(),
    client = new GithubApp(config, remote.fetcher).forApp("123"),
    repo = githubRepo("https://github.com/acme/site");
  for (let i = 1; i <= 21; i++) remote.comments.push(remote.record(i, "x".repeat(12001)));
  const first = await client.readIssueComments(repo, 13, 1);
  assert.equal(first.items.length, 20);
  assert.equal(first.items[0].body.length, 12000);
  assert.equal(first.hasMore, true);
  assert.equal((await client.readIssueComments(repo, 13, 2)).items.length, 1);
  await assert.rejects(client.readIssueComments(repo, 13, 0), {
    code: "GITHUB_COMMENT_INVALID_PAGE",
  });
  remote.comments[0].issue_url = "https://api.github.com/repos/acme/site/issues/14";
  await assert.rejects(client.readIssueComment(repo, 13, 1), {
    code: "GITHUB_COMMENT_INVALID_RESPONSE",
  });
  remote.state.failReadback = true;
  await assert.rejects(
    client.createIssueComment(repo, 13, "Explicit reviewed text", async () => {}),
    (error: any) =>
      error instanceof GithubCommentError && error.uncertain && error.commentId === 101,
  );
});

test("GitHub comment workers recheck revoked maintainer grants and only retry definite rejections", async () => {
  const f = await fixture();
  try {
    const invite = await f.ops.executeOperation(f.owner, "members.invite", {
      email: "maintainer@example.test",
      projectId: f.project.id,
      role: "maintainer",
    });
    await f.ops.auth.acceptInvite(
      invite.token,
      "Maintainer",
      "Correct-Horse-Battery-123",
    );
    const actor = (
      await f.ops.auth.login("maintainer@example.test", "Correct-Horse-Battery-123")
    ).actor;
    const denied = await f.ops.executeOperation(actor, "github.commentQueue", {
      threadId: f.thread.id,
      revision: f.thread.revision,
      issueUrl,
      reviewed: true,
      body: "Maintainer reviewed text",
      idempotencyKey: "revoked-after-token",
    });
    f.remote.state.beforeToken = async () => {
      await f.db.query(
        "UPDATE grants SET role='viewer' WHERE user_id=$1 AND project_id=$2",
        [actor.userId, f.project.id],
      );
    };
    await f.run();
    assert.equal(f.remote.state.posts, 0);
    assert.equal((await f.job(denied.id)).status, "failed");
    assert.equal((await f.job(denied.id)).error_code, "FORBIDDEN");
    f.remote.state.beforeToken = undefined;
    f.remote.state.rejectWrite = true;
    const retry = await f.queue("rate-limit-definite-rejection");
    await f.run();
    assert.equal((await f.job(retry.id)).status, "pending");
    assert.equal(f.remote.state.posts, 1);
    f.remote.state.rejectWrite = false;
    await f.db.query("UPDATE github_comment_jobs SET next_at=now() WHERE id=$1", [
      retry.id,
    ]);
    await f.run();
    assert.equal((await f.job(retry.id)).status, "delivered");
    assert.equal(f.remote.state.posts, 2);
    assert.equal(f.remote.comments.length, 1);
    const interrupted = await f.queue("interrupted-processing-lease");
    await f.db.query(
      "UPDATE github_comment_jobs SET status='processing',attempts=1,lease_until=now()-interval '1 second' WHERE id=$1",
      [interrupted.id],
    );
    await f.run();
    await f.run();
    assert.equal((await f.job(interrupted.id)).status, "uncertain");
    assert.equal(f.remote.state.posts, 2);
  } finally {
    await f.pg.close();
  }
});

test("GitHub 403 and 429 rate rejections honor provider backoff while accepted-write readback limits stay uncertain", async () => {
  const f = await fixture();
  try {
    f.remote.state.rejectWrite = true;
    f.remote.state.retryAfter = "600";
    for (const status of [403, 429]) {
      f.remote.state.rejectStatus = status;
      const queued = await f.queue(`provider-rate-limit-${status}`);
      await f.run();
      const row = await f.db.one(
        "SELECT *,extract(epoch FROM next_at-now()) wait FROM github_comment_jobs WHERE id=$1",
        [queued.id],
      );
      assert.equal(row.status, "pending");
      assert.equal(row.error_code, "GITHUB_COMMENT_RATE_LIMIT");
      assert.ok(Number(row.wait) > 598, row.wait);
    }
    const client = new GithubApp(config, async (input, init) => {
      if (String(input).endsWith("/issues/13/comments") && init?.method === "POST")
        return Response.json(
          { message: "You have exceeded a secondary rate limit." },
          { status: 403 },
        );
      return f.remote.fetcher(input, init);
    }).forApp("123");
    await assert.rejects(
      client.createIssueComment(
        githubRepo("https://github.com/acme/site"),
        13,
        "Reviewed",
        async () => {},
      ),
      (error: any) =>
        error instanceof GithubCommentError &&
        error.code === "GITHUB_COMMENT_RATE_LIMIT" &&
        !error.uncertain &&
        error.retryAfterSeconds === 60,
    );
    const resetClient = new GithubApp(config, async (input, init) => {
      if (String(input).endsWith("/issues/13/comments") && init?.method === "POST")
        return Response.json(
          {},
          {
            status: 403,
            headers: {
              "Retry-After": "60",
              "x-ratelimit-remaining": "0",
              "x-ratelimit-reset": String(Math.ceil(Date.now() / 1000) + 700),
            },
          },
        );
      return f.remote.fetcher(input, init);
    }).forApp("123");
    await assert.rejects(
      resetClient.createIssueComment(
        githubRepo("https://github.com/acme/site"),
        13,
        "Reviewed",
        async () => {},
      ),
      (error: any) =>
        error instanceof GithubCommentError && error.retryAfterSeconds >= 699,
    );
    f.remote.state.rejectWrite = false;
    const readback = new GithubApp(config, async (input, init) => {
      if (String(input).includes("/issues/comments/"))
        return Response.json({}, { status: 429, headers: { "Retry-After": "600" } });
      return f.remote.fetcher(input, init);
    });
    const accepted = await f.queue("accepted-readback-rate-limit");
    await processGithubComments(f.db, config, readback);
    await processGithubComments(f.db, config, readback);
    assert.equal((await f.job(accepted.id)).status, "uncertain");
    assert.ok((await f.job(accepted.id)).comment_id);
    assert.equal(f.remote.comments.length, 1);
  } finally {
    await f.pg.close();
  }
});

test("GitHub preflight service failure retries without sending a comment", async () => {
  const f = await fixture();
  try {
    const queued = await f.queue("safe-preflight-service-retry");
    const offline = new GithubApp(config, async (input, init) =>
      String(input).endsWith("/access_tokens")
        ? Response.json({}, { status: 503 })
        : f.remote.fetcher(input, init),
    );
    await processGithubComments(f.db, config, offline);
    assert.equal((await f.job(queued.id)).status, "pending");
    assert.equal(f.remote.state.posts, 0);
    await f.db.query("UPDATE github_comment_jobs SET next_at=now() WHERE id=$1", [
      queued.id,
    ]);
    await f.run();
    assert.equal((await f.job(queued.id)).status, "delivered");
    assert.equal(f.remote.state.posts, 1);
  } finally {
    await f.pg.close();
  }
});
