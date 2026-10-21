import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";
import { configFromEnv } from "../src/server/config.js";
import {
  trackerConfiguration,
  trackerCredential,
  type TrackerProvider,
} from "../src/shared/contracts/domains/trackers.js";
import {
  TrackerClient,
  TrackerError,
} from "../src/server/integrations/trackers/providers.js";
import { trackerOperation } from "../src/server/integrations/trackers/operations.js";
import {
  processTrackerJobs,
  pollTrackerLinks,
} from "../src/server/integrations/trackers/worker.js";

const configuration = (provider: TrackerProvider) =>
  trackerConfiguration.parse({
    targetId: "123",
    workspaceId: "org123",
    secondaryId: "description",
    site: "synthetic",
    cloudId: "b59926c7-6474-4931-8cc2-34af0d589444",
    issueTypeId: "10001",
    states: [
      { local: "open", remote: "open" },
      { local: "resolved", remote: "completed" },
    ],
    poll: true,
  });
const response = (data: any, status = 200) =>
  new Response(JSON.stringify(data), { status });
const credential = trackerCredential.parse({
  token: "synthetic-token",
  key: "synthetic-key",
  auth: "oauth",
});

test("all eight tracker adapters build provider-specific create, comment and status requests without sending credentials to configurable origins", async () => {
  for (const provider of [
    "jira",
    "linear",
    "asana",
    "clickup",
    "monday",
    "trello",
    "productive",
    "teamwork",
  ] as const) {
    const calls: { url: string; method: string; body: any }[] = [];
    const raw: Record<TrackerProvider, any> = {
      jira: {
        id: "456",
        key: "QA-1",
        fields: {
          summary: "Synthetic task",
          status: { id: "open" },
          project: { id: "123" },
        },
      },
      linear: {
        id: "456",
        title: "Synthetic task",
        url: "https://linear.app/synthetic/issue/QA-1",
        state: { id: "open" },
        team: { id: "123" },
      },
      asana: {
        gid: "456",
        name: "Synthetic task",
        completed: false,
        permalink_url: "https://app.asana.com/0/123/456",
        projects: [{ gid: "123" }],
      },
      clickup: {
        id: "456",
        name: "Synthetic task",
        status: { status: "open" },
        list: { id: "123" },
        url: "https://app.clickup.com/t/456",
      },
      monday: {
        id: "456",
        name: "Synthetic task",
        url: "https://synthetic.monday.com/boards/123/pulses/456",
        board: { id: "123" },
        column_values: [{ id: "status", text: "open" }],
      },
      trello: {
        id: "456",
        name: "Synthetic task",
        url: "https://trello.com/c/abcdef",
        idList: "open",
        idBoard: "org123",
      },
      productive: {
        id: "456",
        attributes: { title: "Synthetic task" },
        relationships: {
          task_list: { data: { id: "123" } },
          workflow_status: { data: { id: "open" } },
        },
      },
      teamwork: {
        id: "456",
        content: "Synthetic task",
        completed: false,
        "todo-list-id": "123",
      },
    };
    const transport = async (url: string, init: RequestInit) => {
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method: init.method!, body });
      assert.equal(new URL(url).protocol, "https:");
      assert.ok(!url.includes("synthetic-token"));
      if (body?.query?.includes("issueCreate"))
        return response({
          data: { issueCreate: { success: true, issue: { id: "456" } } },
        });
      if (body?.query?.includes("commentCreate"))
        return response({ data: { commentCreate: { success: true } } });
      if (body?.query?.includes("issueUpdate"))
        return response({ data: { issueUpdate: { success: true } } });
      if (body?.query?.includes("issue(id"))
        return response({ data: { issue: raw.linear } });
      if (body?.query?.includes("create_item"))
        return response({ data: { create_item: { id: "456" } } });
      if (body?.query?.includes("create_update"))
        return response({ data: { create_update: { id: "comment1" } } });
      if (body?.query?.includes("change_column_value"))
        return response({ data: { change_column_value: { id: "456" } } });
      if (body?.query?.includes("items(ids"))
        return response({ data: { items: [raw.monday] } });
      if (init.method === "GET")
        return response(
          provider === "asana" || provider === "productive"
            ? { data: raw[provider] }
            : provider === "teamwork"
              ? { "todo-item": raw[provider] }
              : raw[provider],
        );
      return response(
        provider === "asana"
          ? { data: { gid: "456" } }
          : provider === "productive"
            ? { data: { id: "456" } }
            : { id: "456" },
      );
    };
    const client = new TrackerClient(
      provider,
      configuration(provider),
      credential,
      transport,
    );
    assert.equal(
      (await client.create("Synthetic task", "Reviewed description <script>bad</script>"))
        .id,
      "456",
    );
    await client.comment("456", "Reviewed comment <script>bad</script>");
    await client.setState(
      "456",
      ["asana", "teamwork"].includes(provider) ? "completed" : "done",
      "31",
    );
    assert.ok(calls.length >= 4, provider);
    const comment = calls.find((call) =>
      JSON.stringify(call.body ?? {}).includes("Reviewed comment"),
    );
    assert.ok(comment, provider);
    if (["monday", "productive"].includes(provider))
      assert.ok(JSON.stringify(comment.body).includes("&lt;script&gt;"), provider);
    if (provider === "jira") assert.equal(calls[0].body.fields.description.type, "doc");
    if (provider === "clickup") assert.match(calls[0].url, /\/list\/123\/task$/);
    if (provider === "monday")
      assert.equal(
        calls[0].body.variables.values,
        JSON.stringify({ description: "Reviewed description <script>bad</script>" }),
      );
    await assert.rejects(
      new TrackerClient(provider, configuration(provider), credential, async () =>
        response({}, 401),
      ).read("456"),
      { code: "TRACKER_AUTH_REVOKED" },
    );
  }
});

test("tracker schema and provider boundaries reject ambiguity, unsupported Jira token auth and wrong-project links", async () => {
  assert.equal(
    trackerConfiguration.safeParse({
      targetId: "123",
      states: [
        { local: "open", remote: "same" },
        { local: "resolved", remote: "same" },
      ],
    }).success,
    false,
  );
  assert.equal(trackerConfiguration.safeParse({ targetId: "../../host" }).success, false);
  assert.throws(
    () =>
      new TrackerClient("jira", configuration("jira"), { ...credential, auth: "token" }),
    { code: "JIRA_OAUTH_REQUIRED" },
  );
  await assert.rejects(
    new TrackerClient("asana", configuration("asana"), credential, async () =>
      response({
        data: {
          gid: "456",
          name: "Other project",
          completed: false,
          projects: [{ gid: "other" }],
        },
      }),
    ).read("456"),
    { code: "TRACKER_TARGET_MISMATCH" },
  );
  await assert.rejects(
    new TrackerClient("clickup", configuration("clickup"), credential, async () =>
      response({
        id: "456",
        name: "Injected",
        list: { id: "123" },
        status: { status: "open" },
        url: "https://attacker.example/",
      }),
    ).read("456"),
    { code: "TRACKER_INVALID_RESPONSE" },
  );
});

test("Linear personal API keys use raw authorization while OAuth credentials use Bearer", async () => {
  for (const auth of ["token", "oauth"] as const) {
    await new TrackerClient(
      "linear",
      configuration("linear"),
      { ...credential, auth },
      async (_url, init) => {
        assert.equal(
          (init.headers as Record<string, string>).authorization,
          auth === "token" ? credential.token : `Bearer ${credential.token}`,
        );
        return response({
          data: { team: { name: "Synthetic team", states: { nodes: [] } } },
        });
      },
    ).target();
  }
});

test("remote discussions retain provider attribution and bounded content without creating local replies", async () => {
  const at = "2026-10-20T12:00:00.000Z";
  const fixtures = {
    jira: {
      total: 1,
      comments: [
        {
          id: "comment1",
          body: {
            type: "doc",
            content: [{ type: "paragraph", content: [{ text: "Remote discussion" }] }],
          },
          author: { displayName: "Provider member" },
          created: at,
        },
      ],
    },
    linear: {
      data: {
        issue: {
          comments: {
            nodes: [
              {
                id: "comment1",
                body: "Remote discussion",
                user: { name: "Provider member" },
                createdAt: at,
              },
            ],
            pageInfo: { hasNextPage: false },
          },
        },
      },
    },
    asana: {
      data: [
        {
          gid: "comment1",
          text: "Remote discussion",
          resource_subtype: "comment_added",
          created_by: { name: "Provider member" },
          created_at: at,
        },
      ],
      next_page: null,
    },
    clickup: {
      comments: [
        {
          id: "comment1",
          comment_text: "Remote discussion",
          user: { username: "Provider member" },
          date: String(Date.parse(at)),
        },
      ],
    },
    monday: {
      data: {
        items: [
          {
            updates: [
              {
                id: "comment1",
                text_body: "Remote discussion",
                creator: { name: "Provider member" },
                created_at: at,
              },
            ],
          },
        ],
      },
    },
    trello: [
      {
        id: "comment1",
        data: { text: "Remote discussion" },
        memberCreator: { fullName: "Provider member" },
        date: at,
      },
    ],
    productive: {
      data: [
        { id: "comment1", attributes: { body: "Remote discussion", created_at: at } },
      ],
      links: {},
    },
    teamwork: {
      comments: [
        {
          id: "comment1",
          body: "Remote discussion",
          "author-fullname": "Provider member",
          datetime: at,
        },
      ],
    },
  };
  for (const provider of Object.keys(fixtures) as TrackerProvider[]) {
    const comments = await new TrackerClient(
      provider,
      configuration(provider),
      credential,
      async () => response(fixtures[provider]),
    ).comments("456");
    assert.equal(comments.items[0].body, "Remote discussion");
    assert.equal(
      comments.items[0].author,
      provider === "productive" ? null : "Provider member",
    );
    assert.equal(comments.hasMore, false);
  }
});

test("tracker queue enforces current authorization, encrypted isolation, idempotency, conflict, polling and uncertain-write reconciliation", async () => {
  const pg = new PGlite();
  try {
    const db = new Database(pg as any);
    await migrate(db);
    const config = configFromEnv({
      DATABASE_URL: "postgres://synthetic",
      APP_ORIGIN: "https://feedback.example.test",
    });
    const objects = new Map<string, Buffer>();
    const store: any = {
      put: async (key: string, bytes: Buffer) => objects.set(key, bytes),
      get: async (key: string) => {
        if (!objects.has(key)) throw Error("Missing private key");
        return objects.get(key)!;
      },
    };
    const ops = new Operations(db, store, config);
    const owner = await ops.auth.bootstrap(
      "owner@example.test",
      "Owner",
      "Correct-Horse-Battery-123",
    );
    const project = await ops.executeOperation(owner, "projects.create", {
      name: "Synthetic",
      origins: ["https://example.test"],
    });
    const thread = await ops.executeOperation(owner, "threads.create", {
      projectId: project.id,
      body: "Synthetic feedback",
      context: {
        url: "https://example.test/",
        viewport: { width: 1440, height: 900 },
        devicePixelRatio: 1,
      },
      idempotencyKey: "synthetic-thread",
    });
    let completed = false,
      creates = 0,
      failWrite = false,
      failReadback = false,
      acceptedStateWrite = false;
    const transport = async (url: string, init: RequestInit) => {
      if (url.includes("/projects/"))
        return response({ data: { name: "Synthetic Asana project" } });
      if (init.method === "POST" && url.endsWith("/tasks")) {
        creates++;
        if (failWrite) throw new TrackerError("TRACKER_NETWORK", true);
        return response({ data: { gid: "456" } });
      }
      if (init.method === "PUT") {
        completed = JSON.parse(String(init.body)).data.completed;
        acceptedStateWrite = true;
        return response({ data: {} });
      }
      if (failReadback && acceptedStateWrite) return response({}, 401);
      return response({
        data: {
          gid: "456",
          name: "Synthetic remote task",
          projects: [{ gid: "123" }],
          completed,
        },
      });
    };
    const run = (actor: any, name: string, input: any) =>
      trackerOperation(db, store, config, actor, name, input, transport);
    const c = await run(owner, "trackers.save", {
      projectId: project.id,
      provider: "asana",
      label: "Synthetic connection",
      configuration: configuration("asana"),
      credential,
    });
    assert.ok(!JSON.stringify(c).includes("synthetic-token"));
    const stored = await db.one("SELECT * FROM tracker_connections WHERE id=$1", [c.id]);
    assert.ok(!JSON.stringify(stored).includes("synthetic-token"));
    const create = {
      connectionId: c.id,
      threadId: thread.id,
      revision: thread.revision,
      idempotencyKey: "synthetic-create",
      title: "Reviewed title",
      body: "Reviewed body",
    };
    await assert.rejects(run(owner, "trackers.create", create), {
      code: "TRACKER_UNVERIFIED",
    });
    assert.equal(
      (await run(owner, "trackers.test", { connectionId: c.id })).healthy,
      true,
    );
    const queued = await run(owner, "trackers.create", create);
    assert.equal((await run(owner, "trackers.create", create)).id, queued.id);
    await assert.rejects(run(owner, "trackers.create", { ...create, title: "changed" }), {
      code: "IDEMPOTENCY_CONFLICT",
    });
    await processTrackerJobs(db, store, config, transport);
    assert.equal(
      (await db.one("SELECT status FROM tracker_jobs WHERE id=$1", [queued.id])).status,
      "delivered",
    );
    assert.equal(creates, 1);
    const links = await run(owner, "trackers.links", { threadId: thread.id });
    assert.equal(links.links.length, 1);
    completed = true;
    const observed = await run(owner, "trackers.refresh", {
      connectionId: c.id,
      threadId: thread.id,
      linkId: links.links[0].id,
    });
    assert.equal(observed.remoteState, "completed");
    assert.equal(
      (await db.one("SELECT remote_state FROM tracker_links WHERE id=$1", [observed.id]))
        .remote_state,
      "open",
    );
    await pollTrackerLinks(db, store, config, transport);
    const resolved = await ops.executeOperation(owner, "threads.get", {
      threadId: thread.id,
    });
    assert.equal(resolved.work.state, "resolved");
    await ops.executeOperation(owner, "threads.status", {
      threadId: thread.id,
      revision: resolved.revision,
      state: "in_progress",
    });
    completed = false;
    await db.query("UPDATE tracker_links SET next_poll_at=now() WHERE thread_id=$1", [
      thread.id,
    ]);
    await pollTrackerLinks(db, store, config, transport);
    assert.equal(
      (await db.one("SELECT status FROM tracker_links WHERE thread_id=$1", [thread.id]))
        .status,
      "conflict",
    );
    const refreshed = await run(owner, "trackers.refresh", {
      connectionId: c.id,
      threadId: thread.id,
      linkId: links.links[0].id,
    });
    assert.equal(refreshed.remoteState, "open");
    const beforeSync = await ops.executeOperation(owner, "threads.get", {
      threadId: thread.id,
    });
    await run(owner, "trackers.sync", {
      connectionId: c.id,
      threadId: thread.id,
      revision: beforeSync.revision,
      idempotencyKey: "resolve-status-conflict",
      linkId: refreshed.id,
      source: "provider",
      expectedRemoteState: refreshed.remoteState,
    });
    await processTrackerJobs(db, store, config, transport);
    assert.equal(
      (await ops.executeOperation(owner, "threads.get", { threadId: thread.id })).work
        .state,
      "open",
    );
    completed = true;
    await run(owner, "trackers.refresh", {
      connectionId: c.id,
      threadId: thread.id,
      linkId: refreshed.id,
    });
    completed = false;
    await db.query("UPDATE tracker_links SET next_poll_at=now() WHERE id=$1", [
      refreshed.id,
    ]);
    await pollTrackerLinks(db, store, config, transport);
    assert.equal(
      (
        await db.one("SELECT observed_remote_state FROM tracker_links WHERE id=$1", [
          refreshed.id,
        ])
      ).observed_remote_state,
      null,
    );
    const beforePush = await ops.executeOperation(owner, "threads.get", {
      threadId: thread.id,
    });
    const localResolved = await ops.executeOperation(owner, "threads.status", {
      threadId: thread.id,
      revision: beforePush.revision,
      state: "resolved",
    });
    const ambiguousStatus = await run(owner, "trackers.sync", {
      connectionId: c.id,
      threadId: thread.id,
      revision: localResolved.revision,
      idempotencyKey: "accepted-status-readback-failed",
      linkId: refreshed.id,
      source: "feedbacks",
      expectedRemoteState: "open",
    });
    failReadback = true;
    await processTrackerJobs(db, store, config, transport);
    assert.equal(
      (await db.one("SELECT status FROM tracker_jobs WHERE id=$1", [ambiguousStatus.id]))
        .status,
      "uncertain",
    );
    failReadback = false;
    await run(owner, "trackers.test", { connectionId: c.id });
    await run(owner, "trackers.reconcile", {
      jobId: ambiguousStatus.id,
      outcome: "confirmed_delivered",
    });
    const invite = await ops.executeOperation(owner, "members.invite", {
      email: "viewer@example.test",
      projectId: project.id,
      role: "viewer",
    });
    await ops.auth.acceptInvite(invite.token, "Viewer", "Correct-Horse-Battery-123");
    const viewer = (
      await ops.auth.login("viewer@example.test", "Correct-Horse-Battery-123")
    ).actor;
    await assert.rejects(run(viewer, "trackers.list", { projectId: project.id }), {
      code: "FORBIDDEN",
    });
    await assert.rejects(
      run({ ...owner, kind: "agent" }, "trackers.list", { projectId: project.id }),
      { code: "FORBIDDEN" },
    );
    const second = await ops.executeOperation(owner, "threads.create", {
      projectId: project.id,
      body: "Second feedback",
      context: {
        url: "https://example.test/second",
        viewport: { width: 1440, height: 900 },
        devicePixelRatio: 1,
      },
      idempotencyKey: "synthetic-second",
    });
    failWrite = true;
    const uncertain = await run(owner, "trackers.create", {
      ...create,
      threadId: second.id,
      revision: second.revision,
      idempotencyKey: "synthetic-uncertain",
    });
    await processTrackerJobs(db, store, config, transport);
    await processTrackerJobs(db, store, config, transport);
    assert.equal(creates, 2);
    assert.equal(
      (await db.one("SELECT status FROM tracker_jobs WHERE id=$1", [uncertain.id]))
        .status,
      "uncertain",
    );
    await run(owner, "trackers.reconcile", {
      jobId: uncertain.id,
      outcome: "linked",
      remoteId: "456",
    });
    await processTrackerJobs(db, store, config, transport);
    assert.equal(
      (await db.one("SELECT status FROM tracker_jobs WHERE id=$1", [uncertain.id]))
        .status,
      "delivered",
    );
    await run(owner, "trackers.enable", {
      connectionId: c.id,
      revision: c.revision,
      enabled: false,
    });
    assert.equal(
      (await run(owner, "trackers.links", { threadId: second.id })).links.length,
      1,
    );
    await assert.rejects(run(owner, "trackers.test", { connectionId: c.id }), {
      code: "TRACKER_DISABLED",
    });
    const movedProject = await ops.executeOperation(owner, "projects.create", {
      name: "Moved destination",
      origins: ["https://example.test"],
    });
    await ops.executeOperation(owner, "members.grant", {
      projectId: movedProject.id,
      userId: viewer.userId,
      role: "maintainer",
    });
    await db.query("UPDATE threads SET project_id=$2 WHERE id=$1", [
      second.id,
      movedProject.id,
    ]);
    const movedLinks = await run(viewer, "trackers.links", { threadId: second.id });
    assert.equal(movedLinks.links.length, 0);
    assert.equal(movedLinks.jobs.length, 0);
    const ownerHistory = await run(owner, "trackers.links", { threadId: second.id });
    assert.equal(ownerHistory.links.length, 1);
    assert.equal(ownerHistory.links[0].historical, true);
    assert.ok(ownerHistory.jobs.every((job: any) => job.historical));
  } finally {
    await pg.close();
  }
});
