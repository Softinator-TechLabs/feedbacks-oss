import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { agentOperations } from "../src/shared/contracts.js";
import { runAgentTool } from "../src/shared/agent-workflow.js";
import { mcpServer } from "../src/server/mcp.js";

function assertAssignmentInput(schema: any) {
  assert.equal(schema.type, "object");
  assert.equal(schema.properties.tags.type, "array");
  assert.equal(schema.properties.tags.maxItems, 12);
  assert.equal(schema.properties.tags.items.maxLength, 32);
  assert.equal(schema.properties.tags.items.minLength, 1);
  assert.ok(schema.properties.tags.items.pattern);
  for (const name of [
    "threadId",
    "threadRevision",
    "userId",
    "summary",
    "category",
    "tags",
    "githubDecision",
    "githubRationale",
    "idempotencyKey",
  ])
    assert.ok(schema.required.includes(name), `${name} must be required`);
  assert.ok(!schema.required.includes("annotationIds"), "defaulted input can be omitted");
  assert.ok(!schema.required.includes("delegationId"));
  assert.ok(!schema.required.includes("revision"));
}

test("compact describe exposes transformed assignment input without calling business operations", async () => {
  let calls = 0;
  const description = await runAgentTool(
    async () => {
      calls++;
      throw new Error("Unexpected execution");
    },
    "describe",
    { operation: "assignments.assign", includeOutputSchema: true },
  );
  assertAssignmentInput(description.inputSchema);
  assert.ok(
    description.outputSchema.required.includes("annotationIds"),
    "output fields remain required",
  );
  assert.equal(calls, 0);
});

test("every discoverable agent operation has convertible input and output schemas", async () => {
  let calls = 0;
  for (const operation of agentOperations) {
    const description = await runAgentTool(
      async () => {
        calls++;
        throw new Error("Unexpected execution");
      },
      "describe",
      { operation, includeOutputSchema: true },
    );
    assert.equal(description.operation, operation);
    assert.equal(description.inputSchema.type, "object", operation);
    assert.equal(description.outputSchema.type, "object", operation);
  }
  assert.equal(calls, 0);
});

test("actual CLI describes assignment schema without credentials or a server", () => {
  const env = {
    ...process.env,
    FEEDBACKS_CONFIG: "/nonexistent/feedbacks-discovery/config.json",
    FEEDBACKS_URL: "http://127.0.0.1:1",
  };
  delete env.FEEDBACKS_TOKEN;
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "src/cli/feedbacks.ts", "--describe", "assignments.assign"],
    { encoding: "utf8", env, input: "", timeout: 10000 },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const response = JSON.parse(result.stdout);
  assert.equal(response.ok, true);
  assertAssignmentInput(response.data.inputSchema);
  assert.ok(response.data.outputSchema.required.includes("annotationIds"));
});

test("SDK compact feedbacks_describe returns a usable assignment schema rather than INTERNAL", async () => {
  let calls = 0;
  const server = mcpServer(async () => {
    calls++;
    throw new Error("Unexpected execution");
  }, "compact");
  const client = new Client({ name: "assignment-discovery", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(a);
    await client.connect(b);
    const result = await client.callTool({
      name: "feedbacks_describe",
      arguments: { operation: "assignments.assign" },
    });
    assert.notEqual(result.isError, true, JSON.stringify(result.content));
    assertAssignmentInput((result.structuredContent as any).inputSchema);
    assertAssignmentInput(JSON.parse((result.content as any)[0].text).inputSchema);
    assert.equal(calls, 0);
  } finally {
    await client.close();
    await server.close();
  }
});
