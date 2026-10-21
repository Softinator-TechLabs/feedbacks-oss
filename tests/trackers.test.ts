import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";
import { configFromEnv } from "../src/server/config.js";
import { DomainError } from "../src/server/errors.js";
import {
  trackerConfiguration,
  trackerCredential,
  trackerInstanceOrigin,
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
    ...(provider === "monday" ? { descriptionColumnType: "text" } : {}),
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

const openProjectOrigin = "https://synthetic.openproject.test";
const openProjectConfiguration = () =>
  trackerConfiguration.parse({
    instanceOrigin: openProjectOrigin,
    targetId: "42",
    issueTypeId: "1",
    states: [
      { local: "open", remote: "1" },
      { local: "resolved", remote: "12" },
    ],
  });
const openProjectCredential = trackerCredential.parse({ token: "synthetic-op-token" });
const openProjectProject = {
  id: 42,
  name: "Synthetic project",
  _links: {
    createWorkPackageImmediate: {
      href: "/api/v3/projects/42/work_packages",
      method: "post",
    },
  },
};
const openProjectPackage = (state = "1", lockVersion = 3) => ({
  id: 517,
  subject: "Reviewed task",
  lockVersion,
  _links: {
    project: { href: "/api/v3/projects/42" },
    type: { href: "/api/v3/types/1" },
    status: { href: `/api/v3/statuses/${state}` },
    addComment: { href: "/api/v3/work_packages/517/activities", method: "post" },
  },
});

test("OpenProject requires exact operator-trusted HTTPS origins, API tokens and numeric project/type/status IDs", async () => {
  const config = configFromEnv({
    DATABASE_URL: "postgres://synthetic",
    OPENPROJECT_ALLOWED_ORIGINS: `${openProjectOrigin}, https://openproject.internal:8443`,
  });
  assert.deepEqual(config.openProjectAllowedOrigins, [
    openProjectOrigin,
    "https://openproject.internal:8443",
  ]);
  assert.deepEqual(
    configFromEnv({ DATABASE_URL: "postgres://synthetic" }).openProjectAllowedOrigins,
    [],
  );
  for (const origin of [
    "http://localhost:3000",
    `${openProjectOrigin}/`,
    `${openProjectOrigin}/api/v3`,
    `${openProjectOrigin}?a=1`,
    `${openProjectOrigin}#fragment`,
    "https://user:secret@synthetic.openproject.test",
    "https://synthetic.openproject.test:443",
    "https://synthetic.openproject.test\\@evil.example",
  ]) {
    assert.equal(trackerInstanceOrigin.safeParse(origin).success, false, origin);
    assert.throws(() =>
      configFromEnv({
        DATABASE_URL: "postgres://synthetic",
        OPENPROJECT_ALLOWED_ORIGINS: origin,
      }),
    );
    assert.throws(
      () =>
        new TrackerClient(
          "openproject",
          { ...openProjectConfiguration(), instanceOrigin: origin },
          openProjectCredential,
          undefined,
          [origin],
        ),
      { code: "OPENPROJECT_ORIGIN_NOT_ALLOWED" },
    );
  }
  assert.throws(
    () =>
      new TrackerClient("openproject", openProjectConfiguration(), openProjectCredential),
    { code: "OPENPROJECT_ORIGIN_NOT_ALLOWED" },
  );
  assert.throws(
    () =>
      new TrackerClient(
        "openproject",
        openProjectConfiguration(),
        credential,
        undefined,
        [openProjectOrigin],
      ),
    { code: "OPENPROJECT_API_TOKEN_REQUIRED" },
  );
  for (const value of ["0", "01", "123/../users", "9007199254740992"])
    for (const field of ["targetId", "issueTypeId"])
      assert.throws(
        () =>
          new TrackerClient(
            "openproject",
            { ...openProjectConfiguration(), [field]: value },
            openProjectCredential,
            undefined,
            [openProjectOrigin],
          ),
        { code: "OPENPROJECT_NUMERIC_ID_REQUIRED" },
      );
  assert.throws(
    () =>
      new TrackerClient(
        "openproject",
        { ...openProjectConfiguration(), states: [{ local: "open", remote: "New" }] },
        openProjectCredential,
        undefined,
        [openProjectOrigin],
      ),
    { code: "OPENPROJECT_NUMERIC_ID_REQUIRED" },
  );
  const privateConfiguration = {
    ...openProjectConfiguration(),
    instanceOrigin: "https://10.0.0.7:8443",
  };
  assert.throws(
    () =>
      new TrackerClient(
        "openproject",
        privateConfiguration,
        openProjectCredential,
        undefined,
        [openProjectOrigin],
      ),
    { code: "OPENPROJECT_ORIGIN_NOT_ALLOWED" },
  );
  assert.doesNotThrow(
    () =>
      new TrackerClient(
        "openproject",
        privateConfiguration,
        openProjectCredential,
        undefined,
        [privateConfiguration.instanceOrigin],
      ),
  );
  let requests = 0;
  const client = new TrackerClient(
    "openproject",
    openProjectConfiguration(),
    openProjectCredential,
    async () => {
      requests++;
      return response({});
    },
    [openProjectOrigin],
  );
  client.configuration.instanceOrigin = "https://attacker.example";
  await assert.rejects(client.read("517"), { code: "OPENPROJECT_ORIGIN_NOT_ALLOWED" });
  assert.equal(requests, 0, "mutated origins cannot send credentials");
});

test("OpenProject uses documented work package HAL payloads, safe fixed paths, comments and optimistic status locking", async () => {
  const calls: Array<{ path: string; method: string; body: any }> = [];
  let state = "1",
    lockVersion = 3;
  const client = new TrackerClient(
    "openproject",
    openProjectConfiguration(),
    openProjectCredential,
    async (url, init) => {
      const path = new URL(url).pathname,
        body = init.body ? JSON.parse(String(init.body)) : null;
      calls.push({ path, method: init.method!, body });
      assert.equal(new URL(url).origin, openProjectOrigin);
      assert.equal(init.redirect, "error");
      assert.equal(
        (init.headers as Record<string, string>).authorization,
        `Basic ${Buffer.from(`apikey:${openProjectCredential.token}`).toString("base64")}`,
      );
      assert.ok(!url.includes(openProjectCredential.token));
      if (path === "/api/v3/projects/42") return response(openProjectProject);
      if (path === "/api/v3/projects/42/types")
        return response({ _embedded: { elements: [{ id: 1, name: "Task" }] } });
      if (path === "/api/v3/statuses")
        return response({
          _embedded: {
            elements: [
              { id: 1, name: "New" },
              { id: 12, name: "Closed" },
            ],
          },
        });
      if (path === "/api/v3/work_packages" && init.method === "POST")
        return response(openProjectPackage(), 201);
      if (path.endsWith("/activities"))
        return init.method === "POST"
          ? response({ id: 81 }, 201)
          : response({
              total: 3,
              _embedded: {
                elements: [
                  {
                    id: 80,
                    _links: { workPackage: { href: "/api/v3/work_packages/517" } },
                    details: [],
                    comment: { raw: "" },
                  },
                  {
                    id: 81,
                    _links: {
                      workPackage: { href: "/api/v3/work_packages/517" },
                      user: { title: "A reviewer" },
                    },
                    comment: { raw: "Reviewed comment" },
                    createdAt: "2026-10-21T09:00:00Z",
                  },
                  {
                    id: 82,
                    internal: true,
                    _links: { workPackage: { href: "/api/v3/work_packages/517" } },
                    comment: { raw: "Internal comment" },
                  },
                ],
              },
            });
      if (init.method === "PATCH") {
        if (body.lockVersion !== lockVersion) return response({}, 409);
        state = body._links.status.href.split("/").at(-1);
        lockVersion++;
      }
      return response(openProjectPackage(state, lockVersion));
    },
    [openProjectOrigin],
  );
  assert.deepEqual(await client.target(), {
    name: "Synthetic project",
    states: [
      { id: "1", name: "New" },
      { id: "12", name: "Closed" },
    ],
  });
  assert.deepEqual(
    await client.create("Reviewed task", "Reviewed feedback <script>untrusted</script>"),
    {
      id: "517",
      title: "Reviewed task",
      state: "1",
      url: `${openProjectOrigin}/work_packages/517/activity`,
    },
  );
  assert.deepEqual(calls.find((call) => call.path === "/api/v3/work_packages")?.body, {
    subject: "Reviewed task",
    description: { raw: "Reviewed feedback <script>untrusted</script>" },
    _links: {
      project: { href: "/api/v3/projects/42" },
      type: { href: "/api/v3/types/1" },
      status: { href: "/api/v3/statuses/1" },
    },
  });
  await client.comment("517", "Reviewed comment");
  assert.deepEqual(
    calls.find((call) => call.method === "POST" && call.path.endsWith("/activities"))
      ?.body,
    { comment: { raw: "Reviewed comment" } },
  );
  assert.deepEqual(
    (await client.comments("517")).items.map((item) => item.body),
    ["Reviewed comment"],
  );
  await client.read("517");
  lockVersion++;
  await assert.rejects(client.setState("517", "12"), {
    code: "TRACKER_REMOTE_CONFLICT",
    uncertain: false,
  });
  assert.equal(
    calls.filter((call) => call.method === "PATCH").at(-1)?.body.lockVersion,
    3,
    "use the worker-observed version instead of accepting a concurrent change",
  );
  await client.read("517");
  await client.setState("517", "12");
  assert.equal((await client.read("517")).state, "12");
  const rejection = new TrackerError("TRACKER_CONNECTION_CHANGED");
  client.beforeWrite = async () => {
    throw rejection;
  };
  const writes = calls.filter((call) => call.method !== "GET").length;
  await assert.rejects(
    client.create("Blocked task", "Body"),
    (error) => error === rejection,
  );
  await assert.rejects(
    client.comment("517", "Blocked comment"),
    (error) => error === rejection,
  );
  await assert.rejects(client.setState("517", "1"), (error) => error === rejection);
  assert.equal(calls.filter((call) => call.method !== "GET").length, writes);
});

test("OpenProject rejects missing provider permissions, wrong project/type and untrusted HAL links before a mutation", async () => {
  for (const project of [
    { ...openProjectProject, _links: {} },
    {
      ...openProjectProject,
      _links: {
        createWorkPackageImmediate: {
          href: "https://attacker.example/api/v3/projects/42/work_packages",
          method: "post",
        },
      },
    },
  ]) {
    let writes = 0;
    const client = new TrackerClient(
      "openproject",
      openProjectConfiguration(),
      openProjectCredential,
      async (_url, init) => {
        if (init.method !== "GET") writes++;
        return response(project);
      },
      [openProjectOrigin],
    );
    await assert.rejects(client.create("Task", "Body"), {
      code: "OPENPROJECT_CREATE_PERMISSION_REQUIRED",
    });
    assert.equal(writes, 0);
  }
  const createClient = (raw: any) =>
    new TrackerClient(
      "openproject",
      openProjectConfiguration(),
      openProjectCredential,
      async () => response(raw),
      [openProjectOrigin],
    );
  for (const field of ["project", "type"])
    await assert.rejects(
      createClient({
        ...openProjectPackage(),
        _links: {
          ...openProjectPackage()._links,
          [field]: { href: "/api/v3/projects/999" },
        },
      }).read("517"),
      { code: "TRACKER_TARGET_MISMATCH" },
    );
  await assert.rejects(
    createClient({
      ...openProjectPackage(),
      _links: {
        ...openProjectPackage()._links,
        status: { href: "https://attacker.example/api/v3/statuses/1" },
      },
    }).read("517"),
    { code: "TRACKER_INVALID_RESPONSE" },
  );
  await assert.rejects(
    createClient({
      ...openProjectPackage(),
      _links: { ...openProjectPackage()._links, addComment: null },
    }).comment("517", "Unsent"),
    { code: "OPENPROJECT_COMMENT_PERMISSION_REQUIRED" },
  );
  await assert.rejects(createClient(openProjectPackage()).read("517/../users"), {
    code: "OPENPROJECT_NUMERIC_ID_REQUIRED",
  });
  const missingType = new TrackerClient(
    "openproject",
    openProjectConfiguration(),
    openProjectCredential,
    async (url) =>
      response(
        url.endsWith("/types")
          ? { _embedded: { elements: [{ id: 99, name: "Wrong type" }] } }
          : openProjectProject,
      ),
    [openProjectOrigin],
  );
  await assert.rejects(missingType.target(), { code: "OPENPROJECT_TYPE_NOT_IN_PROJECT" });
});

const firmaoConfiguration = () =>
  trackerConfiguration.parse({
    workspaceId: "synthetic_org",
    targetId: "123",
    assigneeId: "2",
    states: [
      { local: "open", remote: "WAITING" },
      { local: "resolved", remote: "DONE" },
    ],
  });
const firmaoCredential = trackerCredential.parse({
  auth: "basic",
  username: "api-user@example.test",
  token: "generated-api-password",
});
const firmaoProject = {
  id: 123,
  name: "Synthetic CRM project",
  teamMembers: [{ id: 2 }],
  managers: [],
  permissions: { project: ["read"], task: ["read", "create", "update"] },
};
const firmaoTask = (state = "WAITING") => ({
  id: 50017,
  name: "Reviewed CRM task",
  project: { id: 123 },
  status: { key: state, label_en: state },
  permissions: { task: ["read", "update"] },
});

test("OpenProject operation and durable worker enforce the server origin policy before saving and after queueing, and keep tokens encrypted", async () => {
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
      put: async (key: string, value: Buffer) => objects.set(key, value),
      get: async (key: string) => objects.get(key)!,
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
    let requests = 0,
      writes = 0,
      failReadback = false;
    const transport = async (url: string, init: RequestInit) => {
      requests++;
      const path = new URL(url).pathname;
      if (path === "/api/v3/projects/42") return response(openProjectProject);
      if (path.endsWith("/types"))
        return response({ _embedded: { elements: [{ id: 1, name: "Task" }] } });
      if (path === "/api/v3/statuses")
        return response({
          _embedded: {
            elements: [
              { id: 1, name: "New" },
              { id: 12, name: "Closed" },
            ],
          },
        });
      if (init.method === "POST") {
        writes++;
        return response({ id: 517 }, 201);
      }
      return failReadback ? response({}, 401) : response(openProjectPackage());
    };
    const run = (name: string, input: any) =>
      trackerOperation(db, store, config, owner, name, input, transport);
    const save = {
      projectId: project.id,
      provider: "openproject",
      label: "Self-hosted tasks",
      configuration: openProjectConfiguration(),
      credential: openProjectCredential,
    };
    await assert.rejects(run("trackers.save", save), (error) => {
      assert.ok(error instanceof DomainError);
      assert.equal(error.status, 400);
      assert.equal(error.code, "OPENPROJECT_ORIGIN_NOT_ALLOWED");
      assert.match(
        error.message,
        /server operator.*OPENPROJECT_ALLOWED_ORIGINS.*recreate/i,
      );
      assert.ok(!error.message.includes(openProjectOrigin));
      assert.ok(!error.message.includes(openProjectCredential.token));
      return true;
    });
    assert.equal(requests, 0);
    assert.equal(objects.size, 0, "denied origins must not seal or save credentials");
    assert.equal(
      (await db.one("SELECT count(*)::integer n FROM tracker_connections")).n,
      0,
    );
    config.openProjectAllowedOrigins = [openProjectOrigin];
    for (const [invalid, code] of [
      [{ ...save, credential }, "OPENPROJECT_API_TOKEN_REQUIRED"],
      [
        { ...save, configuration: { ...save.configuration, issueTypeId: "not-numeric" } },
        "OPENPROJECT_NUMERIC_ID_REQUIRED",
      ],
      [
        {
          ...save,
          provider: "asana",
          configuration: configuration("asana"),
          credential: { ...openProjectCredential, auth: "basic" },
        },
        "TRACKER_AUTH_INVALID",
      ],
    ] as const) {
      await assert.rejects(run("trackers.save", invalid), (error) => {
        assert.ok(error instanceof DomainError);
        assert.equal(error.status, 400);
        assert.equal(error.code, code);
        assert.equal(
          error.message,
          "Check the provider credentials and destination settings, then save again.",
        );
        assert.ok(!error.message.includes(openProjectCredential.token));
        return true;
      });
    }
    const unexpected = new Error("Unexpected constructor failure");
    await assert.rejects(
      run("trackers.save", {
        ...save,
        configuration: {
          ...save.configuration,
          get targetId() {
            throw unexpected;
          },
        },
      }),
      (error) => error === unexpected,
    );
    assert.equal(requests, 0, "invalid setup must not contact a provider");
    assert.equal(objects.size, 0, "invalid setup must not seal credentials");
    assert.equal(
      (await db.one("SELECT count(*)::integer n FROM tracker_connections")).n,
      0,
    );
    const connection = await run("trackers.save", save);
    const stored = await db.one("SELECT * FROM tracker_connections WHERE id=$1", [
      connection.id,
    ]);
    assert.ok(!JSON.stringify(stored).includes(openProjectCredential.token));
    assert.ok(!JSON.stringify(connection).includes(openProjectCredential.token));
    assert.equal(
      (await run("trackers.test", { connectionId: connection.id })).healthy,
      true,
    );
    const createThread = (key: string) =>
      ops.executeOperation(owner, "threads.create", {
        projectId: project.id,
        body: "Reviewed feedback",
        pageUrl: "https://example.test/",
        idempotencyKey: key,
      });
    const thread = await createThread("op-source-thread-1");
    const input = {
      connectionId: connection.id,
      threadId: thread.id,
      revision: thread.revision,
      idempotencyKey: "op-task-create-idempotency",
      title: "Reviewed task",
      body: "Reviewed body",
    };
    const job = await run("trackers.create", input);
    assert.equal((await run("trackers.create", input)).id, job.id);
    await processTrackerJobs(db, store, config, transport);
    assert.equal(writes, 1);
    assert.equal(
      (await db.one("SELECT status FROM tracker_jobs WHERE id=$1", [job.id])).status,
      "delivered",
    );
    assert.equal(
      (await run("trackers.links", { threadId: thread.id })).links[0].remoteId,
      "517",
    );
    const second = await createThread("op-source-thread-2");
    const denied = await run("trackers.create", {
      ...input,
      threadId: second.id,
      revision: second.revision,
      idempotencyKey: "op-task-revoked-origin",
    });
    const before = requests;
    config.openProjectAllowedOrigins = [];
    await processTrackerJobs(db, store, config, transport);
    assert.equal(
      requests,
      before,
      "origin policy revocation must block a queued worker before HTTP",
    );
    const deniedRow = await db.one(
      "SELECT status,error_code FROM tracker_jobs WHERE id=$1",
      [denied.id],
    );
    assert.equal(deniedRow.status, "failed");
    assert.equal(deniedRow.error_code, "OPENPROJECT_ORIGIN_NOT_ALLOWED");
    config.openProjectAllowedOrigins = [openProjectOrigin];
    const third = await createThread("op-source-thread-3");
    const uncertain = await run("trackers.create", {
      ...input,
      threadId: third.id,
      revision: third.revision,
      idempotencyKey: "op-task-accepted-readback-failed",
    });
    failReadback = true;
    await processTrackerJobs(db, store, config, transport);
    const unknown = await db.one(
      "SELECT status,remote_id FROM tracker_jobs WHERE id=$1",
      [uncertain.id],
    );
    assert.equal(unknown.status, "uncertain");
    assert.equal(unknown.remote_id, "517");
    await processTrackerJobs(db, store, config, transport);
    assert.equal(writes, 2, "uncertain work package creation must not blindly retry");
  } finally {
    await pg.close();
  }
});

test("Firmao creates a reviewed CRM task using documented Basic auth, organization path, project/assignee fields and CREATE changelog readback", async () => {
  const calls: Array<{ url: URL; method: string; body: any }> = [];
  let state = "WAITING";
  const client = new TrackerClient(
    "firmao",
    firmaoConfiguration(),
    firmaoCredential,
    async (rawUrl, init) => {
      const url = new URL(rawUrl),
        body = init.body ? JSON.parse(String(init.body)) : null;
      calls.push({ url, method: init.method!, body });
      assert.equal(url.origin, "https://system.firmao.pl");
      assert.ok(url.pathname.startsWith("/synthetic_org/svc/v1/"));
      assert.equal(
        (init.headers as Record<string, string>).authorization,
        `Basic ${Buffer.from("api-user@example.test:generated-api-password").toString("base64")}`,
      );
      assert.ok(!rawUrl.includes("api-user"));
      assert.ok(!rawUrl.includes(firmaoCredential.token));
      if (url.pathname.endsWith("/projects")) {
        assert.equal(url.searchParams.get("id(eq)"), "123");
        return response({ data: [firmaoProject] });
      }
      if (init.method === "POST")
        return response(
          {
            changelog: [
              { modification: "CHANGE", objectClass: "project", objectId: 123 },
              { modification: "CREATE", objectClass: "task", objectId: 50017 },
            ],
          },
          201,
        );
      if (init.method === "PUT") {
        state = body.status;
        return response({
          changelog: [{ modification: "CHANGE", objectClass: "task", objectId: 50017 }],
        });
      }
      if (url.searchParams.get("limit") === "50")
        return response({
          data: [firmaoTask("WAITING"), { ...firmaoTask("DONE"), id: 50018 }],
          totalSize: 2,
        });
      assert.equal(url.searchParams.get("id(eq)"), "50017");
      return response({ data: [firmaoTask(state)], totalSize: 1 });
    },
  );
  assert.deepEqual(
    (await client.target()).states.map((item) => item.id),
    ["WAITING", "DONE"],
  );
  const created = await client.create(
    "Reviewed CRM task",
    "Reviewed feedback and source link",
  );
  assert.equal(created.id, "50017");
  assert.equal(
    created.url,
    "https://system.firmao.pl/synthetic_org",
    "only the documented organization login URL is claimed",
  );
  assert.deepEqual(calls.find((call) => call.method === "POST")?.body, {
    taskType: "PROJECT",
    name: "Reviewed CRM task",
    description: "Reviewed feedback and source link",
    project: 123,
    status: "WAITING",
    responsibleUsers: [{ id: 2 }],
  });
  await client.setState("50017", "DONE");
  assert.deepEqual(calls.find((call) => call.method === "PUT")?.body, { status: "DONE" });
  assert.equal((await client.read("50017")).state, "DONE");
  const before = calls.length;
  await assert.rejects(client.comment("50017", "Unsent comment"), {
    code: "FIRMAO_COMMENTS_UNSUPPORTED",
  });
  await assert.rejects(client.comments("50017"), { code: "FIRMAO_COMMENTS_UNSUPPORTED" });
  await assert.rejects(client.read("50017/../users"), {
    code: "FIRMAO_NUMERIC_ID_REQUIRED",
  });
  await assert.rejects(client.setState("50017", "UNMAPPED"), {
    code: "TRACKER_STATE_UNMAPPED",
  });
  assert.equal(
    calls.length,
    before,
    "unsupported capabilities and invalid IDs must not send a remote request",
  );
});

test("Firmao rejects credential/origin injection, missing project permissions, unrelated tasks and unknown assignees before writing", async () => {
  for (const workspaceId of [
    "../admin",
    "https://attacker.example",
    "synthetic%2fadmin",
    "synthetic.org",
    "a".repeat(101),
  ])
    assert.throws(
      () =>
        new TrackerClient(
          "firmao",
          { ...firmaoConfiguration(), workspaceId },
          firmaoCredential,
        ),
      { code: "FIRMAO_ORGANIZATION_REQUIRED" },
    );
  for (const targetId of ["0", "00123", "abc", "9007199254740992"])
    assert.throws(
      () =>
        new TrackerClient(
          "firmao",
          { ...firmaoConfiguration(), targetId },
          firmaoCredential,
        ),
      { code: "FIRMAO_NUMERIC_ID_REQUIRED" },
    );
  assert.throws(() => new TrackerClient("firmao", firmaoConfiguration(), credential), {
    code: "FIRMAO_API_LOGIN_REQUIRED",
  });
  assert.throws(() =>
    trackerCredential.parse({ ...firmaoCredential, username: "user:password" }),
  );
  assert.throws(
    () => new TrackerClient("asana", configuration("asana"), firmaoCredential),
    { code: "TRACKER_AUTH_INVALID" },
  );
  let writes = 0;
  const denied = new TrackerClient(
    "firmao",
    firmaoConfiguration(),
    firmaoCredential,
    async (_url, init) => {
      if (init.method !== "GET") writes++;
      return response({ data: [{ ...firmaoProject, permissions: { task: ["read"] } }] });
    },
  );
  await assert.rejects(denied.create("Task", "Body"), {
    code: "FIRMAO_PROJECT_PERMISSION_REQUIRED",
  });
  const noAssignee = new TrackerClient(
    "firmao",
    firmaoConfiguration(),
    firmaoCredential,
    async (_url, init) => {
      if (init.method !== "GET") writes++;
      return response({ data: [{ ...firmaoProject, teamMembers: [] }] });
    },
  );
  await assert.rejects(noAssignee.create("Task", "Body"), {
    code: "FIRMAO_ASSIGNEE_NOT_IN_PROJECT",
  });
  assert.equal(writes, 0);
  await assert.rejects(
    new TrackerClient("firmao", firmaoConfiguration(), firmaoCredential, async () =>
      response({ data: [{ ...firmaoTask(), project: { id: 999 } }] }),
    ).read("50017"),
    { code: "TRACKER_TARGET_MISMATCH" },
  );
  await assert.rejects(
    new TrackerClient("firmao", firmaoConfiguration(), firmaoCredential, async () =>
      response({ data: [{ ...firmaoTask(), permissions: { task: ["read"] } }] }),
    ).setState("50017", "DONE"),
    { code: "FIRMAO_TASK_PERMISSION_REQUIRED" },
  );
  await assert.rejects(
    new TrackerClient("firmao", firmaoConfiguration(), firmaoCredential, async () =>
      response({}, 401),
    ).target(),
    { code: "TRACKER_AUTH_REVOKED", uncertain: false },
  );
  const malformed = new TrackerClient(
    "firmao",
    firmaoConfiguration(),
    firmaoCredential,
    async (_url, init) =>
      init.method === "GET"
        ? response({ data: [firmaoProject] })
        : response(
            {
              changelog: [
                { modification: "CREATE", objectClass: "customer", objectId: 12 },
              ],
            },
            201,
          ),
  );
  await assert.rejects(malformed.create("Task", "Body"), {
    code: "FIRMAO_CREATE_ID_MISSING",
    uncertain: true,
  });
});

test("Firmao credential vault and job queue preserve task idempotency, denied writes and uncertain create readback", async () => {
  const pg = new PGlite();
  try {
    const db = new Database(pg as any);
    await migrate(db);
    const config = configFromEnv({
      DATABASE_URL: "postgres://synthetic",
      APP_ORIGIN: "https://feedback.example.test",
    });
    const objects = new Map<string, Buffer>(),
      store: any = {
        put: async (key: string, value: Buffer) => objects.set(key, value),
        get: async (key: string) => objects.get(key)!,
      };
    const ops = new Operations(db, store, config),
      owner = await ops.auth.bootstrap(
        "owner@example.test",
        "Owner",
        "Correct-Horse-Battery-123",
      );
    const project = await ops.executeOperation(owner, "projects.create", {
      name: "Synthetic",
      origins: ["https://example.test"],
    });
    let writes = 0,
      requests = 0,
      denied = false,
      failReadback = false;
    const transport = async (rawUrl: string, init: RequestInit) => {
      requests++;
      const url = new URL(rawUrl);
      if (url.pathname.endsWith("/projects"))
        return response({
          data: [
            {
              ...firmaoProject,
              permissions: { task: denied ? ["read"] : ["read", "create", "update"] },
            },
          ],
        });
      if (init.method === "POST") {
        writes++;
        return response(
          {
            changelog: [{ modification: "CREATE", objectClass: "task", objectId: 50017 }],
          },
          201,
        );
      }
      if (failReadback && url.searchParams.get("limit") === "1") return response({}, 401);
      return response({
        data: [
          firmaoTask("WAITING"),
          ...(url.searchParams.get("limit") === "50"
            ? [{ ...firmaoTask("DONE"), id: 50018 }]
            : []),
        ],
      });
    };
    const run = (actor: any, name: string, input: any) =>
      trackerOperation(db, store, config, actor, name, input, transport);
    const connection = await run(owner, "trackers.save", {
      projectId: project.id,
      provider: "firmao",
      label: "CRM tasks",
      configuration: firmaoConfiguration(),
      credential: firmaoCredential,
    });
    assert.ok(!JSON.stringify(connection).includes(firmaoCredential.username!));
    assert.ok(
      !JSON.stringify(
        await db.one("SELECT * FROM tracker_connections WHERE id=$1", [connection.id]),
      ).includes(firmaoCredential.token),
    );
    assert.equal(
      (await run(owner, "trackers.test", { connectionId: connection.id })).healthy,
      true,
    );
    const thread = await ops.executeOperation(owner, "threads.create", {
      projectId: project.id,
      body: "Reviewed feedback",
      pageUrl: "https://example.test/",
      idempotencyKey: "firmao-source-thread",
    });
    const input = {
      connectionId: connection.id,
      threadId: thread.id,
      revision: thread.revision,
      idempotencyKey: "firmao-create-retry",
      title: "Reviewed CRM task",
      body: "Reviewed body",
    };
    const invitation = await ops.executeOperation(owner, "members.invite", {
      email: "crm-viewer@example.test",
      projectId: project.id,
      role: "viewer",
    });
    await ops.auth.acceptInvite(
      invitation.token,
      "CRM viewer",
      "Correct-Horse-Battery-123",
    );
    const viewer = (
      await ops.auth.login("crm-viewer@example.test", "Correct-Horse-Battery-123")
    ).actor;
    await assert.rejects(run(viewer, "trackers.create", input), { code: "FORBIDDEN" });
    const queued = await run(owner, "trackers.create", input);
    assert.equal((await run(owner, "trackers.create", input)).id, queued.id);
    await processTrackerJobs(db, store, config, transport);
    assert.equal(writes, 1);
    assert.equal(
      (await db.one("SELECT status FROM tracker_jobs WHERE id=$1", [queued.id])).status,
      "delivered",
    );
    const linked = (await run(owner, "trackers.links", { threadId: thread.id })).links[0];
    assert.equal(linked.remoteId, "50017");
    const beforeUnsupported = requests;
    const beforeUnsupportedJobs = (
      await db.one(
        "SELECT count(*)::integer AS total FROM tracker_jobs WHERE connection_id=$1",
        [connection.id],
      )
    ).total;
    await assert.rejects(
      run(owner, "trackers.comments", {
        connectionId: connection.id,
        threadId: thread.id,
        remoteId: "50017",
      }),
      { code: "FEATURE_UNAVAILABLE", status: 409 },
    );
    await assert.rejects(
      run(owner, "trackers.comment", {
        ...input,
        linkId: linked.id,
        idempotencyKey: "firmao-comments-not-supported",
        body: "Do not send",
      }),
      { code: "FEATURE_UNAVAILABLE", status: 409 },
    );
    assert.equal(
      requests,
      beforeUnsupported,
      "unsupported Firmao comments must not contact the API",
    );
    assert.equal(
      (
        await db.one(
          "SELECT count(*)::integer AS total FROM tracker_jobs WHERE connection_id=$1",
          [connection.id],
        )
      ).total,
      beforeUnsupportedJobs,
      "unsupported comments must not reserve jobs",
    );
    const secondThread = await ops.executeOperation(owner, "threads.create", {
      projectId: project.id,
      body: "Second reviewed feedback",
      pageUrl: "https://example.test/",
      idempotencyKey: "firmao-second-source",
    });
    const blocked = await run(owner, "trackers.create", {
      ...input,
      threadId: secondThread.id,
      revision: secondThread.revision,
      idempotencyKey: "firmao-denied-current-permission",
    });
    denied = true;
    await processTrackerJobs(db, store, config, transport);
    assert.equal(
      (await db.one("SELECT status FROM tracker_jobs WHERE id=$1", [blocked.id])).status,
      "failed",
    );
    assert.equal(writes, 1, "revoked create permission must not send POST");
    denied = false;
    const thirdThread = await ops.executeOperation(owner, "threads.create", {
      projectId: project.id,
      body: "Third reviewed feedback",
      pageUrl: "https://example.test/",
      idempotencyKey: "firmao-third-source",
    });
    const uncertain = await run(owner, "trackers.create", {
      ...input,
      threadId: thirdThread.id,
      revision: thirdThread.revision,
      idempotencyKey: "firmao-accepted-readback-failed",
    });
    failReadback = true;
    await processTrackerJobs(db, store, config, transport);
    const unknown = await db.one(
      "SELECT status,remote_id FROM tracker_jobs WHERE id=$1",
      [uncertain.id],
    );
    assert.equal(unknown.status, "uncertain");
    assert.equal(unknown.remote_id, "50017");
    await processTrackerJobs(db, store, config, transport);
    assert.equal(writes, 2, "uncertain creation must never be blindly retried");
  } finally {
    await pg.close();
  }
});

test("tracker write boundary blocks Firmao mutations after preflight and treats GraphQL reads as reads", async () => {
  let writes = 0;
  const firmao = new TrackerClient(
    "firmao",
    firmaoConfiguration(),
    firmaoCredential,
    async (url, init) => {
      if (init.method !== "GET") writes++;
      return response({
        data: url.includes("/projects?") ? [firmaoProject] : [firmaoTask()],
      });
    },
  );
  const rejection = new TrackerError("TRACKER_CONNECTION_CHANGED");
  firmao.beforeWrite = async () => {
    throw rejection;
  };
  await assert.rejects(firmao.create("Reviewed", "Body"), (error) => error === rejection);
  await assert.rejects(firmao.setState("50017", "DONE"), (error) => error === rejection);
  assert.equal(writes, 0);

  for (const provider of ["linear", "monday"] as const) {
    let mutations = 0;
    const client = new TrackerClient(
      provider,
      configuration(provider),
      credential,
      async (_url, init) => {
        const query = JSON.parse(String(init.body)).query;
        assert.ok(query.startsWith("query"));
        return response(
          provider === "linear"
            ? { data: { team: { name: "Synthetic", states: { nodes: [] } } } }
            : {
                data: {
                  boards: [
                    {
                      name: "Synthetic",
                      columns: [
                        {
                          id: "description",
                          type: "text",
                          title: "Description",
                          settings: {},
                        },
                        {
                          id: "status",
                          type: "status",
                          title: "Status",
                          settings: { labels: [] },
                        },
                      ],
                    },
                  ],
                },
              },
        );
      },
    );
    client.beforeWrite = async () => {
      mutations++;
      throw rejection;
    };
    await client.target();
    await assert.rejects(
      client.comment("456", "Reviewed"),
      (error) => error === rejection,
    );
    assert.equal(mutations, 1, "only the mutation invokes the authorization boundary");
    const offline = new TrackerClient(
      provider,
      configuration(provider),
      credential,
      async () => {
        throw Error("Offline");
      },
    );
    await assert.rejects(offline.target(), { code: "TRACKER_NETWORK", uncertain: false });
  }
});

test("Firmao create jobs cannot write after disable, access revocation, rotation or lease expiry during project preflight", async () => {
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
      put: async (key: string, value: Buffer) => objects.set(key, value),
      get: async (key: string) => objects.get(key)!,
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
    const invitation = await ops.executeOperation(owner, "members.invite", {
      email: "crm-maintainer@example.test",
      projectId: project.id,
      role: "maintainer",
    });
    await ops.auth.acceptInvite(
      invitation.token,
      "CRM maintainer",
      "Correct-Horse-Battery-123",
    );
    const actor = (
      await ops.auth.login("crm-maintainer@example.test", "Correct-Horse-Battery-123")
    ).actor;
    for (const scenario of ["disabled", "revoked", "rotated", "expired"] as const) {
      await db.query(
        "UPDATE grants SET role='maintainer' WHERE project_id=$1 AND user_id=$2",
        [project.id, actor.userId],
      );
      let blocking = false,
        writes = 0;
      const entered = Promise.withResolvers<void>(),
        release = Promise.withResolvers<void>();
      const transport = async (rawUrl: string, init: RequestInit) => {
        const url = new URL(rawUrl);
        if (url.pathname.endsWith("/projects")) {
          if (blocking) {
            entered.resolve();
            await release.promise;
          }
          return response({ data: [firmaoProject] });
        }
        if (init.method !== "GET") {
          writes++;
          return response(
            {
              changelog: [
                { modification: "CREATE", objectClass: "task", objectId: 50017 },
              ],
            },
            201,
          );
        }
        return response({
          data: [
            firmaoTask(),
            ...(url.searchParams.get("limit") === "50"
              ? [{ ...firmaoTask("DONE"), id: 50018 }]
              : []),
          ],
        });
      };
      const run = (a: any, name: string, input: any) =>
        trackerOperation(db, store, config, a, name, input, transport);
      const connection = await run(owner, "trackers.save", {
        projectId: project.id,
        provider: "firmao",
        label: `CRM ${scenario}`,
        configuration: firmaoConfiguration(),
        credential: firmaoCredential,
      });
      assert.equal(
        (await run(owner, "trackers.test", { connectionId: connection.id })).healthy,
        true,
      );
      const thread = await ops.executeOperation(owner, "threads.create", {
        projectId: project.id,
        body: "Reviewed feedback",
        pageUrl: "https://example.test/",
        idempotencyKey: `firmao-boundary-${scenario}`,
      });
      const job = await run(actor, "trackers.create", {
        connectionId: connection.id,
        threadId: thread.id,
        revision: thread.revision,
        idempotencyKey: `firmao-boundary-job-${scenario}`,
        title: "Reviewed CRM task",
        body: "Reviewed body",
      });
      blocking = true;
      const processing = processTrackerJobs(db, store, config, transport);
      await entered.promise;
      if (scenario === "disabled")
        await db.query("UPDATE tracker_connections SET enabled=false WHERE id=$1", [
          connection.id,
        ]);
      if (scenario === "revoked")
        await db.query(
          "UPDATE grants SET role='viewer' WHERE project_id=$1 AND user_id=$2",
          [project.id, actor.userId],
        );
      if (scenario === "rotated")
        await db.query("UPDATE tracker_connections SET revision=revision+1 WHERE id=$1", [
          connection.id,
        ]);
      if (scenario === "expired")
        await db.query(
          "UPDATE tracker_jobs SET lease_until=now()-interval '1 second' WHERE id=$1",
          [job.id],
        );
      release.resolve();
      await processing;
      assert.equal(writes, 0, `${scenario} during project GET must prevent task POST`);
      const result = await db.one(
        "SELECT status,error_code FROM tracker_jobs WHERE id=$1",
        [job.id],
      );
      assert.equal(
        result.status,
        "failed",
        `${scenario} before any mutation is a definite failure`,
      );
      assert.equal(
        result.error_code,
        {
          disabled: "TRACKER_DISABLED",
          revoked: "FORBIDDEN",
          rotated: "TRACKER_CONNECTION_CHANGED",
          expired: "TRACKER_LEASE_EXPIRED",
        }[scenario],
      );
    }
  } finally {
    await pg.close();
  }
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
    const raw: Record<Exclude<TrackerProvider, "firmao">, any> = {
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
  for (const provider of Object.keys(fixtures) as Array<keyof typeof fixtures>) {
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
