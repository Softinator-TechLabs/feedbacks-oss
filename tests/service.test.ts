import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";

test("authorization, independent response/work/issue/pins, conflict and retry behavior", async () => {
  const { migrate } = await import("../src/server/migrations.js");
  const { Database } = await import("../src/server/db.js");
  const { Operations } = await import("../src/server/operations.js");
  const pg = new PGlite();
  try {
    const db = new Database(pg as any);
    await migrate(db);
    const ops = new Operations(
      db,
      {} as any,
      { appOrigin: "http://localhost:3000" } as any,
    );
    const owner = await ops.auth.bootstrap(
      "owner@example.test",
      "Owner",
      "Correct-Horse-Battery-123",
    );
    const project = await ops.executeOperation(owner, "projects.create", {
      name: "One",
      origins: ["https://example.test"],
    });
    const other = await ops.executeOperation(owner, "projects.create", {
      name: "Other",
      origins: ["https://other.test"],
    });
    const invite = await ops.executeOperation(owner, "members.invite", {
      email: "reviewer@example.test",
      projectId: project.id,
      role: "reviewer",
    });
    await ops.auth.acceptInvite(invite.token, "Reviewer", "Correct-Horse-Battery-123");
    const reviewer = (
      await ops.auth.login("reviewer@example.test", "Correct-Horse-Battery-123")
    ).actor;
    const context = {
      url: "https://example.test/page?token=secret&variant=b#secret",
      viewport: { width: 1440, height: 900 },
      devicePixelRatio: 1,
    };
    const general = await ops.executeOperation(owner, "projects.create", {
      name: "General",
      origins: [],
      captureMode: "any",
    });
    await assert.rejects(
      ops.executeOperation(reviewer, "threads.create", {
        projectId: general.id,
        body: "No grant",
        context: { ...context, url: "https://outside.example/path" },
        idempotencyKey: "general-no-grant",
      }),
      { code: "FORBIDDEN" },
    );
    await ops.executeOperation(owner, "members.grant", {
      projectId: general.id,
      userId: reviewer.userId,
      role: "reviewer",
    });
    const external = await ops.executeOperation(reviewer, "threads.create", {
      projectId: general.id,
      body: "External site",
      context: { ...context, url: "https://preview.shop.example.co.uk:8443/path" },
      idempotencyKey: "general-external",
    });
    const local = await ops.executeOperation(reviewer, "threads.create", {
      projectId: general.id,
      body: "Local site",
      context: { ...context, url: "http://localhost:4173/path" },
      idempotencyKey: "general-local",
    });
    assert.deepEqual(
      {
        domain: external.context.domain,
        hostname: external.context.hostname,
        subdomain: external.context.subdomain,
        port: external.context.port,
      },
      {
        domain: "example.co.uk",
        hostname: "preview.shop.example.co.uk",
        subdomain: "preview.shop",
        port: "8443",
      },
    );
    assert.deepEqual(
      {
        domain: local.context.domain,
        hostname: local.context.hostname,
        subdomain: local.context.subdomain,
        port: local.context.port,
      },
      { domain: "localhost", hostname: "localhost", subdomain: null, port: "4173" },
    );
    const domainResults = await ops.executeOperation(reviewer, "threads.list", {
      projectId: general.id,
      domain: "example.co.uk",
    });
    assert.deepEqual(
      domainResults.items.map((item: any) => item.id),
      [external.id],
    );
    assert.deepEqual(domainResults.websiteFilters.domains, [
      "example.co.uk",
      "localhost",
    ]);
    const hostnameResults = await ops.executeOperation(reviewer, "threads.list", {
      projectId: general.id,
      hostname: "localhost",
    });
    assert.deepEqual(
      hostnameResults.items.map((item: any) => item.id),
      [local.id],
    );
    await assert.rejects(
      ops.executeOperation(reviewer, "threads.create", {
        projectId: project.id,
        body: "Wrong origin",
        context: { ...context, url: "https://outside.example/path" },
        idempotencyKey: "exact-origin-rejected",
      }),
      { code: "ORIGIN_NOT_ALLOWED" },
    );
    const input = {
      projectId: project.id,
      body: "Please fix",
      context,
      idempotencyKey: "create-one",
    };
    const thread = await ops.executeOperation(reviewer, "threads.create", input);
    assert.equal(
      (await ops.executeOperation(reviewer, "threads.create", input)).id,
      thread.id,
    );
    assert.equal(thread.context.url, "https://example.test/page?variant=b");
    const issue = await ops.executeOperation(owner, "threads.linkIssue", {
      threadId: thread.id,
      revision: thread.revision,
      url: "https://github.com/acme/site/issues/12",
    });
    assert.equal(issue.work.state, "open");
    assert.equal(issue.externalIssues[0].verification, "reported");
    const reply = await ops.executeOperation(owner, "threads.reply", {
      threadId: thread.id,
      revision: issue.revision,
      body: "Working on it",
      intent: "response",
      idempotencyKey: "reply-one",
    });
    assert.equal(reply.response.state, "responded");
    assert.equal(reply.work.state, "open");
    assert.equal(reply.pins.defaultVisible, true);
    await assert.rejects(
      ops.executeOperation(owner, "threads.status", {
        threadId: thread.id,
        revision: 1,
        state: "resolved",
        note: "Done",
      }),
      { code: "CONFLICT" },
    );
    const resolved = await ops.executeOperation(owner, "threads.status", {
      threadId: thread.id,
      revision: reply.revision,
      state: "resolved",
      note: "Checked",
    });
    assert.equal(resolved.pins.defaultVisible, false);
    const reopened = await ops.executeOperation(owner, "threads.status", {
      threadId: thread.id,
      revision: resolved.revision,
      state: "open",
    });
    assert.equal(reopened.pins.defaultVisible, true);
    const hidden = await ops.executeOperation(owner, "threads.create", {
      ...input,
      projectId: other.id,
      context: { ...context, url: "https://other.test/" },
      idempotencyKey: "hidden-one",
    });
    await assert.rejects(
      ops.executeOperation(reviewer, "threads.get", { threadId: hidden.id }),
      { code: "FORBIDDEN" },
    );
    await assert.rejects(
      ops.executeOperation(reviewer, "context.export", { projectId: other.id }),
      { code: "FORBIDDEN" },
    );
    await assert.rejects(
      ops.executeOperation(reviewer, "assets.get", { assetId: hidden.id }),
      { code: "NOT_FOUND" },
    );
    await ops.executeOperation(reviewer, "views.like", {
      projectId: project.id,
      context,
      liked: true,
    });
    await ops.executeOperation(reviewer, "views.like", {
      projectId: project.id,
      context,
      liked: true,
    });
    const likes = await ops.executeOperation(reviewer, "views.get", {
      projectId: project.id,
      context,
    });
    assert.equal(likes.uniqueLikes, 1);
    assert.equal(likes.discussionCount, 2);
  } finally {
    await pg.close();
  }
});
