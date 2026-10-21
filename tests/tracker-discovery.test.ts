import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";
import { configFromEnv } from "../src/server/config.js";
import { trackerOperation } from "../src/server/integrations/trackers/operations.js";
import { discoverTracker } from "../src/server/integrations/trackers/discovery.js";
import { TrackerClient } from "../src/server/integrations/trackers/providers.js";
import {
  trackerConfiguration,
  trackerCredential,
  trackersInputs,
} from "../src/shared/contracts/domains/trackers.js";
import {
  credentialScope,
  openCredential,
} from "../src/server/integrations/credential-vault.js";

const credential = trackerCredential.parse({ token: "synthetic-discovery-token" });
const response = (data: any, status = 200) =>
  new Response(JSON.stringify(data), { status });

test("ClickUp named hierarchy includes folders and folderless lists, then verifies the selected list without writes", async () => {
  const paths: string[] = [];
  const transport = async (url: string, init: RequestInit) => {
    assert.equal(init.method, "GET");
    assert.equal(init.redirect, "error");
    assert.ok(init.signal);
    assert.equal((init.headers as any).authorization, credential.token);
    assert.equal(new URL(url).origin, "https://api.clickup.com");
    const path = new URL(url).pathname;
    paths.push(path);
    if (path.endsWith("/team"))
      return response({ teams: [{ id: "10", name: "Synthetic workspace" }] });
    if (path.endsWith("/10/space"))
      return response({ spaces: [{ id: "20", name: "Web" }] });
    if (path.endsWith("/20/folder"))
      return response({ folders: [{ id: "30", name: "Design" }] });
    if (path.endsWith("/20/list"))
      return response({ lists: [{ id: "30", name: "Folderless" }] });
    if (path.endsWith("/30/list"))
      return response({ lists: [{ id: "40", name: "Review" }] });
    return response({
      id: "40",
      name: "Review",
      statuses: [{ status: "open" }, { status: "closed" }],
    });
  };
  const discover = (selection: any) =>
    discoverTracker("clickup", selection, credential, undefined, transport);
  const workspaces = await discover({});
  assert.equal(workspaces.step, "workspaces");
  const spaces = await discover(workspaces.choices[0].selection);
  assert.equal(spaces.choices[0].name, "Web");
  const selection = {
    ...workspaces.choices[0].selection,
    ...spaces.choices[0].selection,
  };
  const mixed = await discover(selection);
  assert.deepEqual(
    mixed.choices.map((v) => v.id),
    ["folder_30", "list_30"],
  );
  const lists = await discover({ ...selection, ...mixed.choices[0].selection });
  assert.equal(lists.step, "targets");
  const ready = await discover({
    ...selection,
    ...mixed.choices[0].selection,
    ...lists.choices[0].selection,
  });
  assert.equal(ready.step, "ready");
  assert.equal(ready.configuration?.targetId, "40");
  assert.equal(ready.targetName, "Review");
  assert.deepEqual(ready.configuration?.states, []);
  assert.equal(ready.configuration?.poll, false);
  assert.deepEqual(
    ready.states.map((v) => v.id),
    ["open", "closed"],
  );
  assert.ok(!JSON.stringify(ready).includes(credential.token));
  assert.equal(paths.length, 6);
});

test("non-paginated provider collections paginate locally without losing the 101st destination", async () => {
  const values = Array.from({ length: 125 }, (_, i) => ({
    id: String(i + 1),
    name: `List ${i + 1}`,
  }));
  const transport = async () => response(values);
  const first = await discoverTracker(
    "trello",
    { workspaceId: "board" },
    { ...credential, key: "synthetic-key" },
    undefined,
    transport,
  );
  assert.equal(first.choices.length, 100);
  assert.equal(first.nextCursor, "2");
  const next = await discoverTracker(
    "trello",
    { workspaceId: "board" },
    { ...credential, key: "synthetic-key" },
    first.nextCursor,
    transport,
  );
  assert.equal(next.choices[0].name, "List 101");
  assert.equal(next.choices.length, 25);
  assert.equal(next.hasMore, false);
  await assert.rejects(
    discoverTracker(
      "trello",
      {},
      { ...credential, key: "synthetic-key" },
      "https://evil.test",
      transport,
    ),
    { code: "TRACKER_CURSOR_INVALID" },
  );
});

test("monday uses read-only GraphQL, named text/status columns and current typed settings", async () => {
  const seen: string[] = [];
  const columns = [
    { id: "notes", title: "Description", type: "long_text", settings: {} },
    {
      id: "progress",
      title: "Progress",
      type: "status",
      settings: {
        type: "status",
        labels: [
          { id: 0, label: "Open" },
          { id: 1, label: "Done" },
          { id: 2, label: "Archived label", is_deactivated: true },
        ],
      },
    },
  ];
  const transport = async (url: string, init: RequestInit) => {
    assert.equal(url, "https://api.monday.com/v2");
    assert.equal(init.redirect, "error");
    const body = JSON.parse(String(init.body));
    seen.push(body.query);
    assert.doesNotMatch(body.query, /mutation|settings_str/);
    return body.query.includes("$page")
      ? response({ data: { boards: [{ id: "100", name: "Website" }] } })
      : response({ data: { boards: [{ id: "100", name: "Website", columns }] } });
  };
  const boards = await discoverTracker("monday", {}, credential, undefined, transport);
  assert.equal(boards.choices[0].name, "Website");
  const description = await discoverTracker(
    "monday",
    { targetId: "100" },
    credential,
    undefined,
    transport,
  );
  assert.equal(description.title, "Description column");
  const status = await discoverTracker(
    "monday",
    { targetId: "100", secondaryId: "notes" },
    credential,
    undefined,
    transport,
  );
  assert.equal(status.choices[0].name, "Progress");
  const ready = await discoverTracker(
    "monday",
    { targetId: "100", secondaryId: "notes", statusColumn: "progress" },
    credential,
    undefined,
    transport,
  );
  assert.equal(ready.configuration?.secondaryId, "notes");
  assert.equal(ready.configuration?.descriptionColumnType, "long_text");
  assert.deepEqual(
    ready.states.map((v) => v.id),
    ["Open", "Done"],
  );
  assert.ok(seen.length >= 4);
  const legacy = new TrackerClient(
    "monday",
    trackerConfiguration.parse({
      targetId: "100",
      secondaryId: "notes",
      statusColumn: "progress",
    }),
    credential,
    transport,
  );
  await assert.rejects(legacy.target(), { code: "TRACKER_DESCRIPTION_COLUMN_REQUIRED" });
});

test("monday creates text and long-text descriptions with their documented shapes and rejects excessive long text before a write", async () => {
  for (const type of ["text", "long_text"] as const) {
    let writes = 0;
    const client = new TrackerClient(
      "monday",
      trackerConfiguration.parse({
        targetId: "100",
        secondaryId: "notes",
        descriptionColumnType: type,
      }),
      credential,
      async (_, init) => {
        const body = JSON.parse(String(init.body));
        if (body.query.includes("mutation")) {
          writes++;
          assert.deepEqual(JSON.parse(body.variables.values), {
            notes: type === "text" ? "Reviewed feedback" : { text: "Reviewed feedback" },
          });
          return response({ data: { create_item: { id: "200" } } });
        }
        return response({
          data: {
            items: [
              {
                id: "200",
                name: "Reviewed title",
                url: "https://synthetic.monday.com/boards/100/pulses/200",
                board: { id: "100" },
                column_values: [{ id: "status", text: "Open" }],
              },
            ],
          },
        });
      },
    );
    await client.create("Reviewed title", "Reviewed feedback");
    assert.equal(writes, 1);
    if (type === "long_text") {
      await assert.rejects(client.create("Reviewed title", "x".repeat(2001)), {
        code: "MONDAY_DESCRIPTION_TOO_LONG",
      });
      assert.equal(writes, 1);
    }
  }
});

test("legacy monday connections read the actual description type before creation and retain the final authorization boundary", async () => {
  for (const type of ["text", "long_text"] as const) {
    let writes = 0,
      metadataReads = 0,
      authorizationChecks = 0,
      revokeDuringRead = false;
    const denied = new Error("Synthetic authorization revoked");
    const client = new TrackerClient(
      "monday",
      trackerConfiguration.parse({ targetId: "100", secondaryId: "notes" }),
      credential,
      async (_, init) => {
        const body = JSON.parse(String(init.body));
        if (body.query.includes("columns")) {
          metadataReads++;
          return response({
            data: { boards: [{ id: "100", columns: [{ id: "notes", type }] }] },
          });
        }
        if (body.query.includes("mutation")) {
          writes++;
          assert.deepEqual(JSON.parse(body.variables.values), {
            notes: type === "text" ? "Reviewed" : { text: "Reviewed" },
          });
          return response({ data: { create_item: { id: "200" } } });
        }
        return response({
          data: {
            items: [
              {
                id: "200",
                name: "Review",
                url: "https://synthetic.monday.com/boards/100/pulses/200",
                board: { id: "100" },
                column_values: [{ id: "status", text: "Open" }],
              },
            ],
          },
        });
      },
    );
    client.beforeWrite = async () => {
      authorizationChecks++;
      if (revokeDuringRead) throw denied;
    };
    await client.create("Review", "Reviewed");
    assert.equal(metadataReads, 1);
    assert.equal(writes, 1);
    assert.equal(authorizationChecks, 1);
    if (type === "long_text") {
      await assert.rejects(client.create("Review", "x".repeat(2001)), {
        code: "MONDAY_DESCRIPTION_TOO_LONG",
      });
      assert.equal(writes, 1);
      assert.equal(authorizationChecks, 1);
    }
    revokeDuringRead = true;
    await assert.rejects(
      client.create("Review", "Reviewed"),
      (error) => error === denied,
    );
    assert.equal(writes, 1);
    assert.equal(authorizationChecks, 2);
  }
});

test("Asana and Linear encode opaque pagination tokens and ignore provider next-page URLs", async () => {
  const paths: string[] = [];
  const transport = async (url: string) => {
    paths.push(url);
    return response({
      data: [{ gid: "2", name: "Review" }],
      next_page: { offset: "next/token", uri: "https://evil.test/steal" },
    });
  };
  const first = await discoverTracker("asana", {}, credential, undefined, transport);
  const next = await discoverTracker(
    "asana",
    { workspaceId: "1" },
    credential,
    first.nextCursor,
    transport,
  );
  assert.equal(next.choices[0].name, "Review");
  assert.ok(paths[1].includes("offset=next%2Ftoken"));
  assert.ok(paths.every((v) => new URL(v).origin === "https://app.asana.com"));
  let linearQuery: any;
  const linear = await discoverTracker(
    "linear",
    {},
    credential,
    "cursor_previous",
    async (_, init) => {
      linearQuery = JSON.parse(String(init.body));
      return response({
        data: {
          teams: {
            nodes: [{ id: "team-id", name: "Design" }],
            pageInfo: { hasNextPage: true, endCursor: "cursor_next" },
          },
        },
      });
    },
  );
  assert.equal(linear.nextCursor, "cursor_next");
  assert.equal(linearQuery.variables.after, "cursor_previous");
  assert.doesNotMatch(linearQuery.query, /mutation/);
});

test("discovery rejects untrusted origins, malformed sites, large responses and provider secrets in errors", async () => {
  let calls = 0;
  const transport = async () => {
    calls++;
    return response({ message: credential.token }, 401);
  };
  await assert.rejects(
    discoverTracker(
      "openproject",
      { instanceOrigin: "https://untrusted.example" },
      credential,
      undefined,
      transport,
      [],
    ),
    { code: "OPENPROJECT_ORIGIN_NOT_ALLOWED" },
  );
  await assert.rejects(
    discoverTracker(
      "teamwork",
      { site: "evil.test/path" },
      credential,
      undefined,
      transport,
    ),
  );
  assert.equal(calls, 0);
  await assert.rejects(
    discoverTracker("clickup", {}, credential, undefined, transport),
    (error) => {
      assert.equal((error as any).code, "TRACKER_AUTH_REVOKED");
      assert.ok(!String(error).includes(credential.token));
      return true;
    },
  );
  await assert.rejects(
    discoverTracker(
      "clickup",
      {},
      credential,
      undefined,
      async () => new Response("x".repeat(2_000_001)),
    ),
    { code: "TRACKER_RESPONSE_TOO_LARGE" },
  );
  await assert.rejects(
    discoverTracker("clickup", {}, credential, undefined, async () =>
      response({
        teams: Array.from({ length: 1001 }, (_, i) => ({ id: String(i), name: "X" })),
      }),
    ),
    { code: "TRACKER_INVALID_RESPONSE" },
  );
});

test("remaining adapters discover named destinations through fixed bounded collection routes", async () => {
  const cases: any[] = [
    [
      "teamwork",
      { site: "synthetic" },
      { tasklists: [{ id: "10", name: "Review", projectName: "Website" }] },
      "https://synthetic.teamwork.com/tasklists.json",
      credential,
    ],
    [
      "productive",
      { workspaceId: "7" },
      { data: [{ id: "10", attributes: { title: "Review" } }] },
      "https://api.productive.io/api/v2/task_lists",
      credential,
    ],
    [
      "firmao",
      { workspaceId: "synthetic" },
      { data: [{ id: 10, name: "Review", permissions: { task: ["create", "read"] } }] },
      "https://system.firmao.pl/synthetic/svc/v1/projects",
      { ...credential, username: "synthetic", auth: "basic" },
    ],
    [
      "openproject",
      { instanceOrigin: "https://trusted.example" },
      { total: 1, _embedded: { elements: [{ id: 10, name: "Review" }] } },
      "https://trusted.example/api/v3/projects",
      credential,
    ],
    [
      "jira",
      { site: "synthetic", cloudId: "20f140aa-5455-467d-904b-24c547cf2302" },
      { values: [{ id: "10", name: "Review" }], isLast: true },
      "https://api.atlassian.com/ex/jira/",
      { ...credential, auth: "oauth" },
    ],
  ];
  for (const [provider, selection, payload, prefix, auth] of cases) {
    const result = await discoverTracker(
      provider,
      selection,
      auth,
      undefined,
      async (url, init) => {
        assert.ok(url.startsWith(prefix));
        assert.equal(init.method, "GET");
        return response(payload);
      },
      ["https://trusted.example"],
    );
    assert.equal(result.step, "targets");
    assert.match(result.choices[0].name, /Review/);
    assert.equal(result.choices[0].selection.targetId, "10");
  }
  const deniedRows = Array.from({ length: 50 }, (_, i) => ({
    id: i + 1,
    name: "No task permission",
    permissions: { task: [] },
  }));
  const next = await discoverTracker(
    "firmao",
    { workspaceId: "synthetic" },
    { ...credential, username: "synthetic", auth: "basic" },
    undefined,
    async () => response({ data: deniedRows }),
  );
  assert.equal(next.choices.length, 0);
  assert.equal(next.nextCursor, "2");
});

test("shared schemas require a single credential source and current saved revision", () => {
  const base = { projectId: "08c15bce-7f87-4ba5-b7aa-b947260ec989", provider: "clickup" };
  assert.equal(trackersInputs["trackers.discover"].safeParse(base).success, false);
  assert.equal(
    trackersInputs["trackers.discover"].safeParse({
      ...base,
      credential,
      sourceConnectionId: base.projectId,
      sourceRevision: 1,
    }).success,
    false,
  );
  assert.equal(
    trackersInputs["trackers.discover"].safeParse({
      ...base,
      sourceConnectionId: base.projectId,
    }).success,
    false,
  );
  assert.equal(
    trackersInputs["trackers.discover"].safeParse({
      ...base,
      credential,
      cursor: "https://evil.test?token=x",
    }).success,
    false,
  );
});

test("owner-only discovery and cross-project account reuse recheck current authorization and revision without returning credentials", async () => {
  const pg = new PGlite();
  try {
    const db = new Database(pg as any);
    await migrate(db);
    const config = configFromEnv({
      DATABASE_URL: "postgres://synthetic",
      APP_ORIGIN: "https://feedback.example.test",
      OPENPROJECT_ALLOWED_ORIGINS:
        "https://tracker-one.example,https://tracker-two.example",
    });
    const objects = new Map<string, Buffer>();
    const store: any = {
      put: async (k: string, v: Buffer) => objects.set(k, v),
      get: async (k: string) => objects.get(k)!,
    };
    const ops = new Operations(db, store, config);
    const owner = await ops.auth.bootstrap(
      "owner@example.test",
      "Owner",
      "Correct-Horse-Battery-123",
    );
    const project = await ops.executeOperation(owner, "projects.create", {
      name: "Source",
      origins: ["https://example.test"],
    });
    const destination = await ops.executeOperation(owner, "projects.create", {
      name: "Destination",
      origins: ["https://example.test"],
    });
    const member = await ops.executeOperation(owner, "members.create", {
      name: "Maintainer",
      email: "member@example.test",
      password: "Correct-Horse-Battery-123",
      grants: [{ projectId: destination.id, role: "maintainer" }],
    });
    await db.query("UPDATE users SET must_change_password=false WHERE id=$1", [
      member.id,
    ]);
    const maintainer = (
      await ops.auth.login("member@example.test", "Correct-Horse-Battery-123")
    ).actor;
    let calls = 0;
    let race: undefined | (() => Promise<void>);
    const transport = async (url: string) => {
      calls++;
      await race?.();
      return url.includes("/team")
        ? response({ teams: [{ id: "1", name: "Synthetic workspace" }] })
        : response({
            id: "30",
            name: "Synthetic list",
            statuses: [{ status: "open" }, { status: "closed" }],
          });
    };
    const run = (actor: any, name: string, input: any) =>
      trackerOperation(db, store, config, actor, name, input, transport);
    const source = await run(owner, "trackers.save", {
      projectId: project.id,
      provider: "clickup",
      label: "Existing account",
      configuration: trackerConfiguration.parse({ targetId: "20" }),
      credential,
    });
    const accounts = await run(owner, "trackers.accounts", {
      projectId: destination.id,
      provider: "clickup",
    });
    assert.equal(accounts.accounts[0].connectionId, source.id);
    assert.equal(accounts.accounts[0].projectName, "Source");
    assert.ok(!JSON.stringify(accounts).includes(credential.token));
    for (const actor of [maintainer, { ...owner, kind: "agent" }]) {
      await assert.rejects(
        run(actor, "trackers.accounts", {
          projectId: destination.id,
          provider: "clickup",
        }),
        { code: "FORBIDDEN" },
      );
      await assert.rejects(
        run(actor, "trackers.discover", {
          projectId: destination.id,
          provider: "clickup",
          selection: {},
          credential,
        }),
        { code: "FORBIDDEN" },
      );
    }
    assert.equal(calls, 0);
    const input = {
      projectId: destination.id,
      provider: "clickup",
      sourceConnectionId: source.id,
      sourceRevision: source.revision,
      selection: {},
    };
    const discovered = await run(owner, "trackers.discover", input);
    assert.equal(discovered.choices[0].name, "Synthetic workspace");
    assert.ok(!JSON.stringify(discovered).includes(credential.token));
    await assert.rejects(
      run(owner, "trackers.discover", { ...input, sourceRevision: 2 }),
      { code: "CONFLICT" },
    );
    await assert.rejects(
      run(owner, "trackers.discover", { ...input, provider: "asana" }),
      { code: "CONFLICT" },
    );
    assert.equal(calls, 1);
    const saveInput = {
      projectId: destination.id,
      provider: "clickup",
      label: "Project tasks",
      configuration: trackerConfiguration.parse({ targetId: "30" }),
      reuseConnectionId: source.id,
      reuseRevision: source.revision,
      idempotencyKey: "synthetic-save-retry-key",
    };
    const keysBefore = objects.size;
    const [saved, concurrent] = await Promise.all([
      run(owner, "trackers.save", saveInput),
      run(owner, "trackers.save", saveInput),
    ]);
    assert.equal(saved.id, concurrent.id);
    assert.equal(objects.size, keysBefore + 1);
    const callsAfterSave = calls;
    assert.equal((await run(owner, "trackers.save", saveInput)).id, saved.id);
    assert.equal(calls, callsAfterSave);
    await assert.rejects(
      run(owner, "trackers.save", { ...saveInput, label: "Changed content" }),
      { code: "IDEMPOTENCY_CONFLICT" },
    );
    await assert.rejects(run(maintainer, "trackers.save", saveInput), {
      code: "FORBIDDEN",
    });
    assert.equal(saved.health, "healthy");
    assert.ok(saved.checkedAt);
    assert.ok(!JSON.stringify(saved).includes(credential.token));
    const original = await db.one("SELECT * FROM tracker_connections WHERE id=$1", [
      source.id,
    ]);
    const copy = await db.one("SELECT * FROM tracker_connections WHERE id=$1", [
      saved.id,
    ]);
    assert.notEqual(original.credential_key, copy.credential_key);
    const decoded = JSON.parse(
      await openCredential(
        store,
        credentialScope(config, "clickup", copy.id),
        copy.credential_key,
        copy.credential,
      ),
    );
    assert.equal(decoded.token, credential.token);
    assert.ok(!JSON.stringify(copy).includes(credential.token));
    race = async () => {
      race = undefined;
      await db.query("UPDATE tracker_connections SET revision=revision+1 WHERE id=$1", [
        source.id,
      ]);
    };
    await assert.rejects(run(owner, "trackers.discover", input), { code: "CONFLICT" });
    const fresh = await db.one("SELECT revision FROM tracker_connections WHERE id=$1", [
      source.id,
    ]);
    race = async () => {
      race = undefined;
      await db.query(
        "UPDATE tracker_connections SET enabled=false,revision=revision+1 WHERE id=$1",
        [source.id],
      );
    };
    await assert.rejects(
      run(owner, "trackers.save", {
        projectId: destination.id,
        provider: "clickup",
        label: "Rejected copy",
        configuration: trackerConfiguration.parse({ targetId: "30" }),
        reuseConnectionId: source.id,
        reuseRevision: fresh.revision,
      }),
      { code: "TRACKER_DISABLED" },
    );
    assert.equal((await db.one("SELECT count(*)::int n FROM tracker_connections")).n, 2);
    assert.equal(
      (
        await run(owner, "trackers.accounts", {
          projectId: destination.id,
          provider: "clickup",
        })
      ).accounts.length,
      1,
    );
    // A committed independent connection remains retrievable after its original source is disabled.
    assert.equal((await run(owner, "trackers.save", saveInput)).id, saved.id);
    await db.query("UPDATE tracker_connections SET enabled=false WHERE id=$1", [
      saved.id,
    ]);
    await assert.rejects(run(owner, "trackers.save", saveInput), {
      code: "TRACKER_DISABLED",
    });
    await db.query("UPDATE tracker_connections SET enabled=true WHERE id=$1", [saved.id]);
    const jira = await run(owner, "trackers.save", {
      projectId: project.id,
      provider: "jira",
      label: "Jira",
      configuration: trackerConfiguration.parse({
        targetId: "10",
        issueTypeId: "1",
        site: "synthetic",
        cloudId: "20f140aa-5455-467d-904b-24c547cf2302",
      }),
      credential: { ...credential, auth: "oauth", refreshToken: "synthetic-refresh" },
    });
    assert.deepEqual(
      await run(owner, "trackers.accounts", {
        projectId: destination.id,
        provider: "jira",
      }),
      { accounts: [] },
    );
    await assert.rejects(
      run(owner, "trackers.save", {
        projectId: destination.id,
        provider: "jira",
        label: "Unsafe clone",
        configuration: jira.configuration,
        reuseConnectionId: jira.id,
        reuseRevision: jira.revision,
      }),
      { code: "JIRA_OAUTH_REQUIRED" },
    );
    // Reuse can choose another destination within the saved account, never another
    // operator-allowed origin, site or organization using that account's secret.
    const boundCases = [
      {
        provider: "openproject",
        field: "instanceOrigin",
        original: "https://tracker-one.example",
        changed: "https://tracker-two.example",
        extra: { issueTypeId: "1" },
        auth: credential,
      },
      {
        provider: "teamwork",
        field: "site",
        original: "site-one",
        changed: "site-two",
        extra: {},
        auth: credential,
      },
      {
        provider: "productive",
        field: "workspaceId",
        original: "org-one",
        changed: "org-two",
        extra: {},
        auth: credential,
      },
      {
        provider: "firmao",
        field: "workspaceId",
        original: "org-one",
        changed: "org-two",
        extra: {},
        auth: { ...credential, auth: "basic", username: "synthetic" },
      },
    ];
    let boundCalls = 0;
    const boundTransport = async (url: string) => {
      boundCalls++;
      const path = new URL(url).pathname;
      if (new URL(url).origin === "https://tracker-one.example") {
        if (path.endsWith("/types"))
          return response({ _embedded: { elements: [{ id: 1, name: "Task" }] } });
        if (path.endsWith("/statuses")) return response({ _embedded: { elements: [] } });
        return response({
          id: 99,
          name: "Another project",
          _links: {
            createWorkPackageImmediate: {
              href: "/api/v3/projects/99/work_packages",
              method: "post",
            },
          },
        });
      }
      if (new URL(url).hostname.endsWith(".teamwork.com"))
        return response({ "todo-list": { name: "Another list" } });
      if (new URL(url).hostname === "api.productive.io")
        return path.includes("workflow_statuses")
          ? response({ data: [] })
          : response({ data: { attributes: { title: "Another list" } } });
      return response({
        data: [
          { id: 99, name: "Another project", permissions: { task: ["create", "read"] } },
        ],
      });
    };
    const boundRun = (name: string, input: any) =>
      trackerOperation(db, store, config, owner, name, input, boundTransport);
    for (const item of boundCases) {
      const sourceConfiguration = trackerConfiguration.parse({
        targetId: "11",
        ...item.extra,
        [item.field]: item.original,
      });
      const sourceConnection = await boundRun("trackers.save", {
        projectId: project.id,
        provider: item.provider,
        label: `Saved ${item.provider}`,
        configuration: sourceConfiguration,
        credential: item.auth,
      });
      const selected = { ...item.extra, targetId: "99", [item.field]: item.original };
      const wrongAccount = { ...selected, [item.field]: item.changed };
      const requestsBefore = boundCalls;
      await assert.rejects(
        boundRun("trackers.discover", {
          projectId: destination.id,
          provider: item.provider,
          sourceConnectionId: sourceConnection.id,
          sourceRevision: sourceConnection.revision,
          selection: wrongAccount,
        }),
        { code: "TRACKER_ACCOUNT_CONTEXT_CHANGED" },
      );
      await assert.rejects(
        boundRun("trackers.save", {
          projectId: destination.id,
          provider: item.provider,
          label: "Wrong account",
          reuseConnectionId: sourceConnection.id,
          reuseRevision: sourceConnection.revision,
          configuration: trackerConfiguration.parse(wrongAccount),
        }),
        { code: "TRACKER_ACCOUNT_CONTEXT_CHANGED" },
      );
      await assert.rejects(
        boundRun("trackers.save", {
          projectId: project.id,
          provider: item.provider,
          connectionId: sourceConnection.id,
          revision: sourceConnection.revision,
          label: "Wrong account edit",
          configuration: trackerConfiguration.parse(wrongAccount),
        }),
        { code: "TRACKER_ACCOUNT_CONTEXT_CHANGED" },
      );
      assert.equal(
        boundCalls,
        requestsBefore,
        "account swaps must fail before sending the saved credential",
      );
      const sameAccount = await boundRun("trackers.discover", {
        projectId: destination.id,
        provider: item.provider,
        sourceConnectionId: sourceConnection.id,
        sourceRevision: sourceConnection.revision,
        selection: selected,
      });
      assert.equal(sameAccount.step, "ready");
      assert.equal(sameAccount.configuration.targetId, "99");
      const connected = await boundRun("trackers.save", {
        projectId: destination.id,
        provider: item.provider,
        label: "Another destination",
        reuseConnectionId: sourceConnection.id,
        reuseRevision: sourceConnection.revision,
        configuration: sameAccount.configuration,
      });
      assert.equal(connected.health, "healthy");
      assert.equal(connected.configuration[item.field], item.original);
    }
    race = async () => {
      race = undefined;
      await db.query("UPDATE users SET active=false WHERE id=$1", [owner.userId]);
    };
    await assert.rejects(
      run(owner, "trackers.discover", {
        projectId: destination.id,
        provider: "clickup",
        selection: {},
        credential,
      }),
      { code: "UNAUTHENTICATED" },
    );
    await assert.rejects(run(owner, "trackers.save", saveInput), {
      code: "UNAUTHENTICATED",
    });
    await db.query("UPDATE users SET active=true WHERE id=$1", [owner.userId]);
    const login = await ops.auth.login("owner@example.test", "Correct-Horse-Battery-123");
    const sessionOwner = await ops.auth.authenticate(undefined, login.token);
    race = async () => {
      race = undefined;
      await db.query("DELETE FROM sessions WHERE hash=$1", [sessionOwner.sessionHash]);
    };
    await assert.rejects(
      run(sessionOwner, "trackers.discover", {
        projectId: destination.id,
        provider: "clickup",
        selection: {},
        credential,
      }),
      { code: "UNAUTHENTICATED" },
    );
    await assert.rejects(run(sessionOwner, "trackers.save", saveInput), {
      code: "UNAUTHENTICATED",
    });
  } finally {
    await pg.close();
  }
});
