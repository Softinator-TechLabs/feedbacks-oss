import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";
import { configFromEnv } from "../src/server/config.js";
import { trackersInputs } from "../src/shared/contracts/domains/trackers.js";
import { discoverConsentedJira } from "../src/server/integrations/trackers/jira-consent.js";

const cloudId = "59d72025-7e6d-4f1a-ac5c-9d86d5fc01fa";
const otherCloudId = "8d452209-2160-4a67-806a-b27188fa2149";
const resource = {
  id: cloudId,
  name: "Synthetic Jira",
  url: "https://synthetic.atlassian.net",
};
const token = "synthetic-consented-access-token";
const fields = ["project", "issuetype", "summary", "description"].map((fieldId) => ({
  fieldId,
  key: fieldId,
  required: fieldId !== "description",
  hasDefaultValue: false,
  operations: ["set"],
}));
const response = (data: any, status = 200) =>
  new Response(JSON.stringify(data), { status });
const page = (
  property: string,
  values: any[],
  startAt = 0,
  total = values.length,
  maxResults = 50,
) => ({ [property]: values, startAt, total, maxResults });
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => (release = resolve));
  return { promise, release };
}

test("guided Jira contract starts without IDs and refuses authority overrides in destination selection", () => {
  const projectId = "84480939-4e4c-45aa-8ce6-2ee4ca7eb5cf";
  assert.equal(
    trackersInputs["trackers.oauthStart"].safeParse({
      projectId,
      provider: "jira",
      guided: true,
    }).success,
    true,
  );
  assert.equal(
    trackersInputs["trackers.oauthStart"].safeParse({ projectId, provider: "jira" })
      .success,
    false,
  );
  assert.equal(
    trackersInputs["trackers.oauthStart"].safeParse({
      projectId,
      provider: "jira",
      guided: true,
      configuration: { targetId: "42" },
    }).success,
    false,
  );
  assert.equal(
    trackersInputs["trackers.oauthDiscover"].safeParse({
      flowId: projectId,
      selection: { targetId: "42", site: "attacker" },
    }).success,
    false,
  );
  assert.equal(
    trackersInputs["trackers.oauthDiscover"].safeParse({
      flowId: projectId,
      selection: { cloudId: otherCloudId },
    }).success,
    false,
  );
});

test("Jira create metadata pagination validates every provided and required field, non-subtask type and bounded scans", async () => {
  const originalFetch = globalThis.fetch;
  let mode = "valid",
    requests = 0;
  try {
    globalThis.fetch = (async (raw: any, init?: RequestInit) => {
      const url = new URL(String(raw));
      requests++;
      assert.equal(url.origin, "https://api.atlassian.com");
      assert.equal(init?.method, "GET");
      assert.equal(init?.redirect, "error");
      assert.ok(init?.signal);
      assert.equal((init?.headers as any).authorization, `Bearer ${token}`);
      const start = Number(url.searchParams.get("startAt") ?? 0),
        path = url.pathname;
      if (path.endsWith("/project/search"))
        return response(page("values", [{ id: "42", name: "Website" }], start, 101));
      if (path.endsWith("/issuetypes")) {
        if (mode === "type-limit")
          return response(
            page(
              "issueTypes",
              Array.from({ length: 50 }, (_, i) => ({
                id: String(start + i + 100),
                name: "Other",
                subtask: false,
              })),
              start,
              1000,
            ),
          );
        return response(
          page(
            "issueTypes",
            start === 0
              ? [{ id: "11", name: "Subtask", subtask: true }]
              : [{ id: "12", name: "Task", subtask: false }],
            start,
            2,
            1,
          ),
        );
      }
      if (path.endsWith("/issuetypes/12")) {
        if (mode === "field-limit")
          return response(
            page(
              "fields",
              Array.from({ length: 50 }, (_, i) => ({
                fieldId: `customfield_${start + i}`,
                required: false,
              })),
              start,
              1000,
            ),
          );
        const listed =
          mode === "missing-description"
            ? fields.filter((v) => v.fieldId !== "description")
            : mode === "required-custom"
              ? [
                  ...fields,
                  { fieldId: "customfield_100", required: true, hasDefaultValue: false },
                ]
              : mode === "default-custom"
                ? [
                    ...fields,
                    { fieldId: "customfield_100", required: true, hasDefaultValue: true },
                  ]
                : fields;
        return response(
          page("fields", listed.slice(start, start + 2), start, listed.length, 2),
        );
      }
      if (path.endsWith("/statuses"))
        return response([
          {
            id: "12",
            statuses: [
              { id: "1", name: "Open" },
              { id: "2", name: "Done" },
            ],
          },
        ]);
      return response({ id: "42", key: "WEB", name: "Website" });
    }) as typeof fetch;
    const credential: any = { token, auth: "oauth" };
    let authorizationChecks = 0;
    const check = async () => {
      authorizationChecks++;
    };
    const first = await discoverConsentedJira(
      resource,
      credential,
      { targetId: "42" },
      undefined,
      check,
    );
    assert.equal(first.choices.length, 0);
    assert.equal(first.nextCursor, "1");
    const next = await discoverConsentedJira(
      resource,
      credential,
      { targetId: "42" },
      first.nextCursor,
      check,
    );
    assert.equal(next.choices[0].name, "Task");
    const ready = await discoverConsentedJira(
      resource,
      credential,
      { targetId: "42", issueTypeId: "12" },
      undefined,
      check,
    );
    assert.equal(ready.configuration?.cloudId, cloudId);
    assert.equal(ready.configuration?.site, "synthetic");
    assert.deepEqual(
      ready.states.map((v) => v.id),
      ["1", "2"],
    );
    assert.ok(authorizationChecks >= requests * 2);
    mode = "required-custom";
    await assert.rejects(
      discoverConsentedJira(
        resource,
        credential,
        { targetId: "42", issueTypeId: "12" },
        undefined,
        check,
      ),
      { code: "JIRA_REQUIRED_FIELDS_UNSUPPORTED" },
    );
    mode = "missing-description";
    await assert.rejects(
      discoverConsentedJira(
        resource,
        credential,
        { targetId: "42", issueTypeId: "12" },
        undefined,
        check,
      ),
      { code: "JIRA_FIELDS_UNAVAILABLE" },
    );
    mode = "default-custom";
    assert.equal(
      (
        await discoverConsentedJira(
          resource,
          credential,
          { targetId: "42", issueTypeId: "12" },
          undefined,
          check,
        )
      ).step,
      "ready",
    );
    mode = "valid";
    await assert.rejects(
      discoverConsentedJira(
        resource,
        credential,
        { targetId: "42", issueTypeId: "11" },
        undefined,
        check,
      ),
      { code: "JIRA_ISSUE_TYPE_UNAVAILABLE" },
    );
    mode = "type-limit";
    await assert.rejects(
      discoverConsentedJira(
        resource,
        credential,
        { targetId: "42", issueTypeId: "12" },
        undefined,
        check,
      ),
      { code: "JIRA_METADATA_LIMIT" },
    );
    mode = "field-limit";
    await assert.rejects(
      discoverConsentedJira(
        resource,
        credential,
        { targetId: "42", issueTypeId: "12" },
        undefined,
        check,
      ),
      { code: "JIRA_METADATA_LIMIT" },
    );
    globalThis.fetch = (async () => new Response("x".repeat(2_000_001))) as typeof fetch;
    await assert.rejects(
      discoverConsentedJira(resource, credential, {}, undefined, check),
      { code: "TRACKER_RESPONSE_TOO_LARGE" },
    );
    globalThis.fetch = (async () => response({}, 429)) as typeof fetch;
    await assert.rejects(
      discoverConsentedJira(resource, credential, {}, undefined, check),
      { code: "TRACKER_RATE_LIMIT" },
    );
    globalThis.fetch = (async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(Error(token));
          },
        }),
      )) as typeof fetch;
    await assert.rejects(
      discoverConsentedJira(resource, credential, {}, undefined, check),
      (error) => {
        assert.equal((error as any).code, "TRACKER_NETWORK");
        assert.ok(!String(error).includes(token));
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("guided Jira consent discovers names, seals one canonical connection and recovers concurrent/lost responses without broker tokens leaking", async () => {
  const pg = new PGlite(),
    originalFetch = globalThis.fetch;
  try {
    const db = new Database(pg as any);
    await migrate(db);
    const config = configFromEnv({
      DATABASE_URL: "postgres://synthetic",
      APP_ORIGIN: "https://feedback.example.test",
      TRACKER_OAUTH_BROKER_URL: "https://broker.example.test",
      TRACKER_OAUTH_INSTALLATION_KEY: "synthetic-installation-key".padEnd(40, "x"),
    });
    const objects = new Map<string, Buffer>();
    const store: any = {
      put: async (k: string, v: Buffer) => objects.set(k, v),
      get: async (k: string) => objects.get(k)!,
    };
    const ops = new Operations(db, store, config);
    await ops.auth.bootstrap("owner@example.test", "Owner", "Correct-Horse-Battery-123");
    const login = await ops.auth.login("owner@example.test", "Correct-Horse-Battery-123"),
      owner = await ops.auth.authenticate(undefined, login.token);
    const project = await ops.executeOperation(owner, "projects.create", {
      name: "Synthetic",
      origins: ["https://example.test"],
    });
    let starts = 0,
      apiCalls = 0,
      polls = 0,
      acks = 0,
      pending = false,
      remoteExpired = false,
      ackFailure = true,
      extraRequired = false;
    let race: undefined | (() => Promise<void>),
      parallel = false,
      statusReads = 0;
    const bothStatusReads = gate(),
      finishStatusReads = gate();
    globalThis.fetch = (async (raw: any, init?: RequestInit) => {
      const url = new URL(String(raw));
      if (url.origin === "https://broker.example.test") {
        assert.equal(init?.method, "POST");
        assert.ok((init?.headers as any).authorization.startsWith("Bearer "));
        if (url.pathname === "/v1/start") {
          starts++;
          return response({
            flowId: `synthetic-remote-${starts}`,
            pollToken: "synthetic-poll-secret",
            authorizeUrl: "https://auth.atlassian.com/authorize?state=synthetic",
          });
        }
        if (url.pathname === "/v1/ack") {
          acks++;
          return response({ removed: !ackFailure }, ackFailure ? 503 : 200);
        }
        polls++;
        if (remoteExpired) return response({}, 410);
        return pending
          ? response({ status: "pending" })
          : response({
              status: "ready",
              token: {
                access_token: token,
                refresh_token: "synthetic-refresh-token",
                expires_in: 3600,
              },
              resources: [resource],
            });
      }
      assert.equal(url.origin, "https://api.atlassian.com");
      assert.ok(url.pathname.startsWith(`/ex/jira/${cloudId}/rest/api/3/`));
      assert.equal(init?.method, "GET");
      apiCalls++;
      await race?.();
      if (url.pathname.endsWith("/project/search"))
        return response(page("values", [{ id: "42", name: "Website" }]));
      if (url.pathname.endsWith("/issuetypes"))
        return response(
          page("issueTypes", [
            { id: "12", name: "Task", subtask: false },
            { id: "13", name: "Subtask", subtask: true },
          ]),
        );
      if (url.pathname.endsWith("/issuetypes/12"))
        return response(
          page(
            "fields",
            extraRequired
              ? [
                  ...fields,
                  {
                    fieldId: "customfield_required",
                    required: true,
                    hasDefaultValue: false,
                  },
                ]
              : fields,
          ),
        );
      if (url.pathname.endsWith("/statuses")) {
        if (parallel) {
          if (++statusReads === 2) bothStatusReads.release();
          await finishStatusReads.promise;
        }
        return response([
          {
            id: "12",
            statuses: [
              { id: "1", name: "Open" },
              { id: "2", name: "Done" },
            ],
          },
        ]);
      }
      return response({ id: "42", key: "WEB", name: "Website" });
    }) as typeof fetch;
    const start = () =>
      ops.executeOperation(owner, "trackers.oauthStart", {
        projectId: project.id,
        provider: "jira",
        guided: true,
      });
    const flow = await start();
    assert.ok(!JSON.stringify(flow).includes("synthetic-poll-secret"));
    const discover = (extra: any = {}, actor = owner) =>
      ops.executeOperation(actor, "trackers.oauthDiscover", {
        flowId: flow.flowId,
        ...extra,
      });
    remoteExpired = true;
    await assert.rejects(discover(), (error) => {
      assert.equal((error as any).code, "TRACKER_OAUTH_EXPIRED");
      assert.match((error as any).message, /broker restarted.*Start again/);
      return true;
    });
    remoteExpired = false;
    pending = true;
    assert.equal((await discover()).status, "pending");
    pending = false;
    const sites = await discover();
    assert.deepEqual(sites.resources, [resource]);
    const otherLogin = await ops.auth.login(
        "owner@example.test",
        "Correct-Horse-Battery-123",
      ),
      otherSession = await ops.auth.authenticate(undefined, otherLogin.token);
    await assert.rejects(discover({}, otherSession), { code: "TRACKER_OAUTH_EXPIRED" });
    await assert.rejects(discover({ cloudId: otherCloudId }), { code: "VALIDATION" });
    assert.equal(apiCalls, 0);
    await assert.rejects(discover({ cloudId, selection: { site: "forged" } }), {
      code: "VALIDATION",
    });
    const projects = await discover({ cloudId });
    assert.equal(projects.discovery.choices[0].name, "Website");
    const types = await discover({ cloudId, selection: { targetId: "42" } });
    assert.deepEqual(
      types.discovery.choices.map((v: any) => v.name),
      ["Task"],
    );
    await assert.rejects(
      discover({ cloudId, selection: { targetId: "42", issueTypeId: "13" } }),
      { code: "JIRA_ISSUE_TYPE_UNAVAILABLE" },
    );
    extraRequired = true;
    await assert.rejects(
      discover({ cloudId, selection: { targetId: "42", issueTypeId: "12" } }),
      { code: "JIRA_REQUIRED_FIELDS_UNSUPPORTED" },
    );
    extraRequired = false;
    const ready = await discover({
      cloudId,
      selection: { targetId: "42", issueTypeId: "12" },
    });
    assert.equal(ready.discovery.step, "ready");
    assert.ok(!JSON.stringify(ready).includes(token));
    const completeInput = {
      flowId: flow.flowId,
      cloudId,
      configuration: ready.discovery.configuration,
      idempotencyKey: "synthetic-guided-completion",
    };
    await assert.rejects(
      ops.executeOperation(owner, "trackers.oauthComplete", {
        ...completeInput,
        configuration: { ...completeInput.configuration, site: "forged" },
      }),
      { code: "JIRA_SITE_MISMATCH" },
    );
    await assert.rejects(
      ops.executeOperation(owner, "trackers.oauthComplete", {
        ...completeInput,
        configuration: { ...completeInput.configuration, cloudId: otherCloudId },
      }),
      { code: "JIRA_SITE_MISMATCH" },
    );
    await assert.rejects(
      ops.executeOperation(owner, "trackers.oauthComplete", {
        ...completeInput,
        configuration: {
          ...completeInput.configuration,
          states: [{ local: "open", remote: "forged" }],
        },
      }),
      { code: "TRACKER_MAPPING_INVALID" },
    );
    const keysBefore = objects.size;
    extraRequired = true;
    await assert.rejects(
      ops.executeOperation(owner, "trackers.oauthComplete", completeInput),
      { code: "JIRA_REQUIRED_FIELDS_UNSUPPORTED" },
    );
    extraRequired = false;
    await assert.rejects(
      ops.executeOperation(owner, "trackers.oauthComplete", {
        ...completeInput,
        configuration: { ...completeInput.configuration, issueTypeId: "13" },
      }),
      { code: "JIRA_ISSUE_TYPE_UNAVAILABLE" },
    );
    assert.equal(objects.size, keysBefore);
    parallel = true;
    const completions = [1, 2].map(() =>
      ops.executeOperation(owner, "trackers.oauthComplete", completeInput),
    );
    try {
      await Promise.race([
        bothStatusReads.promise,
        new Promise((_, reject) => {
          const timeout = setTimeout(
            () =>
              reject(Error("Concurrent Jira completion did not reach metadata barrier")),
            5000,
          );
          timeout.unref();
        }),
      ]);
    } finally {
      finishStatusReads.release();
    }
    const [first, second] = await Promise.all(completions);
    parallel = false;
    assert.equal(first.connection.id, second.connection.id);
    assert.equal(first.connection.health, "healthy");
    assert.equal(first.connection.label, "Jira Cloud · Website");
    assert.equal(objects.size, keysBefore + 1);
    assert.equal((await db.one("SELECT count(*)::int n FROM tracker_connections")).n, 1);
    assert.ok(acks >= 1);
    assert.ok(!JSON.stringify(first).includes(token));
    assert.ok(
      !JSON.stringify(
        await db.one("SELECT * FROM tracker_connections WHERE id=$1", [
          first.connection.id,
        ]),
      ).includes(token),
    );
    const callsBefore = apiCalls,
      pollsBefore = polls;
    assert.equal(
      (await ops.executeOperation(owner, "trackers.oauthComplete", completeInput))
        .connection.id,
      first.connection.id,
    );
    assert.equal(apiCalls, callsBefore);
    assert.equal(polls, pollsBefore);
    await db.query(
      "UPDATE tracker_oauth_flows SET expires_at=now()-interval '1 second' WHERE id=$1",
      [flow.flowId],
    );
    assert.equal(
      (await ops.executeOperation(owner, "trackers.oauthComplete", completeInput))
        .connection.id,
      first.connection.id,
    );
    assert.equal(apiCalls, callsBefore);
    assert.equal(polls, pollsBefore);
    await assert.rejects(
      ops.executeOperation(owner, "trackers.oauthComplete", {
        ...completeInput,
        idempotencyKey: "another-completion-key",
      }),
      { code: "TRACKER_OAUTH_EXPIRED" },
    );
    assert.equal(apiCalls, callsBefore);
    assert.equal(polls, pollsBefore);
    await assert.rejects(
      ops.executeOperation(owner, "trackers.oauthComplete", {
        ...completeInput,
        label: "Changed",
      }),
      { code: "IDEMPOTENCY_CONFLICT" },
    );
    await assert.rejects(
      ops.executeOperation(otherSession, "trackers.oauthComplete", completeInput),
      { code: "TRACKER_OAUTH_EXPIRED" },
    );
    await db.query("UPDATE tracker_connections SET enabled=false WHERE id=$1", [
      first.connection.id,
    ]);
    await assert.rejects(
      ops.executeOperation(owner, "trackers.oauthComplete", completeInput),
      { code: "TRACKER_DISABLED" },
    );
    await db.query("UPDATE tracker_connections SET enabled=true WHERE id=$1", [
      first.connection.id,
    ]);
    const expired = await start();
    await db.query(
      "UPDATE tracker_oauth_flows SET expires_at=now()-interval '1 second' WHERE id=$1",
      [expired.flowId],
    );
    await assert.rejects(
      ops.executeOperation(owner, "trackers.oauthDiscover", { flowId: expired.flowId }),
      { code: "TRACKER_OAUTH_EXPIRED" },
    );
    const revoked = await start();
    await assert.rejects(
      ops.executeOperation({ ...owner, projects: [] }, "trackers.oauthDiscover", {
        flowId: revoked.flowId,
      }),
      { code: "FORBIDDEN" },
    );
    race = async () => {
      race = undefined;
      await db.query("UPDATE users SET owner=false WHERE id=$1", [owner.userId]);
    };
    await assert.rejects(
      ops.executeOperation(owner, "trackers.oauthDiscover", {
        flowId: revoked.flowId,
        cloudId,
      }),
      { code: "FORBIDDEN" },
    );
    await db.query("UPDATE users SET owner=true WHERE id=$1", [owner.userId]);
    race = async () => {
      race = undefined;
      await db.query("DELETE FROM sessions WHERE hash=$1", [owner.sessionHash]);
    };
    await assert.rejects(
      ops.executeOperation(owner, "trackers.oauthDiscover", {
        flowId: revoked.flowId,
        cloudId,
      }),
      { code: "UNAUTHENTICATED" },
    );
    await assert.rejects(
      ops.executeOperation(owner, "trackers.oauthComplete", completeInput),
      { code: "UNAUTHENTICATED" },
    );
  } finally {
    globalThis.fetch = originalFetch;
    await pg.close();
  }
});
