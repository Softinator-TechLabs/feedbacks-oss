import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";
import { inputSchemas } from "../src/shared/contracts.js";
import { runAgentTool } from "../src/shared/agent-workflow.js";
import { nativeReport } from "./fixtures/native-diagnostics.js";

const capture = {
  appName: "SyntheticApp",
  platform: "linux",
  method: "image_import",
  width: 640,
  height: 400,
  points: [],
};
test("native events require explicit approval and matching native context", () => {
  const input = {
    projectId: randomUUID(),
    body: "Synthetic feedback",
    appCapture: capture,
    nativeDiagnostics: { approved: true, report: nativeReport() },
    idempotencyKey: "native-report-test",
  };
  assert.equal(inputSchemas["threads.create"].safeParse(input).success, true);
  for (const invalid of [
    { ...input, nativeDiagnostics: { ...input.nativeDiagnostics, approved: false } },
    { ...input, appCapture: undefined },
    { ...input, appCapture: { ...capture, platform: "windows" } },
    { ...input, pageUrl: "https://example.test" },
    {
      ...input,
      nativeDiagnostics: {
        ...input.nativeDiagnostics,
        report: { ...nativeReport(), coverage: "complete" },
      },
    },
  ])
    assert.equal(inputSchemas["threads.create"].safeParse(invalid).success, false);
});

test("native reports stay private, redacted, retry-bound and progressive for agents", async () => {
  const pg = new PGlite();
  try {
    const db = new Database(pg as any);
    await migrate(db);
    const ops = new Operations(
      db,
      {} as any,
      {
        appOrigin: "http://localhost:3000",
        production: false,
        organizationId: "00000000-0000-4000-8000-000000000001",
      } as any,
    );
    const owner = await ops.auth.bootstrap(
      "owner@example.test",
      "Owner",
      "Correct-Horse-Battery-123",
    );
    const call = (name: string, input: any) => ops.executeOperation(owner, name, input);
    const project = await call("projects.create", {
      name: "Native diagnostics",
      origins: ["https://approved.example.test"],
    });
    const input = {
      projectId: project.id,
      body: "Synthetic OS failure",
      appCapture: capture,
      nativeDiagnostics: { approved: true, report: nativeReport() },
      idempotencyKey: "native-report-request",
    };
    const thread = await call("threads.create", input);
    assert.equal(thread.context.nativeDiagnostics.trust, "untrusted_native_diagnostics");
    assert.equal(thread.context.nativeDiagnostics.collector, "linux_journal");
    assert.ok(
      !JSON.stringify(thread.context.nativeDiagnostics).includes("synthetic-secret"),
    );
    assert.equal(thread.context.url, undefined);
    assert.equal((await call("threads.create", input)).id, thread.id);
    await assert.rejects(
      call("threads.create", {
        ...input,
        nativeDiagnostics: {
          approved: true,
          report: {
            ...nativeReport(),
            events: [{ level: "error", message: "Changed event" }],
          },
        },
      }),
      { code: "IDEMPOTENCY_CONFLICT" },
    );
    const other = await call("projects.create", {
      name: "Other",
      origins: ["https://other.test"],
    });
    const credential = await ops.auth.issueToken(
      db,
      owner,
      {
        name: "Other project",
        projectIds: [other.id],
        scopes: ["threads.create", "threads.get"],
        expiresInDays: 1,
      },
      "agent",
    );
    const outsider = await ops.auth.authenticate(credential.token);
    await assert.rejects(
      ops.executeOperation(outsider, "threads.get", { threadId: thread.id }),
      { code: "FORBIDDEN" },
    );
    await assert.rejects(
      ops.executeOperation(outsider, "threads.create", {
        ...input,
        idempotencyKey: "outsider-native-report",
      }),
      { code: "FORBIDDEN" },
    );
    const execute = async (name: string) => {
      if (name === "threads.get") return thread;
      if (name === "auth.me") return { actor: { userId: owner.userId }, projects: [] };
      if (name === "instructions.get") return { items: [], revision: 1 };
      if (name === "assignments.list" || name === "assignments.delegations")
        return { items: [], total: 0, nextOffset: null };
      throw Error(`Unexpected operation ${name}`);
    };
    for (const tool of ["start", "thread"] as const) {
      const summary = await runAgentTool(execute, tool, { threadId: thread.id });
      assert.equal(summary.nativeDiagnostics.eventCount, 1);
      assert.ok(!JSON.stringify(summary).includes("Synthetic app failure"));
    }
    const context = await runAgentTool(execute, "thread", {
      threadId: thread.id,
      section: "context",
      textLimit: 1000,
    });
    assert.equal(context.format, "json");
    assert.ok(context.text.includes("nativeDiagnostics"));
  } finally {
    await pg.close();
  }
});
