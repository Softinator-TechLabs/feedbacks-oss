import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, rm } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("source and packaged stdio adapters materialize evidence on the adapter machine", async () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const recording = {
    schemaVersion: 1,
    id,
    startedAt: "2026-09-28T00:00:00Z",
    durationMs: 100,
    mode: "session",
    url: "https://example.test/checkout",
    environment: { browser: "synthetic" },
    privacy: { maskText: false, maskInputs: true, networkBodies: false },
    coverage: [{ channel: "console", status: "complete" }],
    events: [
      {
        seq: 0,
        atMs: 10,
        type: "console",
        data: { level: "error", args: ["Synthetic failed checkout"] },
      },
    ],
  };
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    assert.equal(req.url, "/api/recordings.export");
    assert.equal(req.headers.authorization, "Bearer synthetic-stdio-token");
    assert.deepEqual(JSON.parse(raw), { recordingId: id });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        data: { recording, thread: { id, revision: 1, body: "Synthetic issue" } },
      }),
    );
  });
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  try {
    for (const args of [
      ["--import", "tsx", "src/cli/mcp.ts"],
      ["dist/codex-plugin/feedbacks/mcp.mjs"],
      ["dist/claude-plugin/plugins/feedbacks/mcp.mjs"],
    ]) {
      const client = new Client({ name: "materializer-integration", version: "1" });
      let directory: string | undefined;
      try {
        await client.connect(
          new StdioClientTransport({
            command: process.execPath,
            args,
            env: {
              PATH: process.env.PATH ?? "",
              FEEDBACKS_URL: `http://127.0.0.1:${(server.address() as any).port}`,
              FEEDBACKS_TOKEN: "synthetic-stdio-token",
              FEEDBACKS_MCP_PROFILE: "compact",
            },
            stderr: "pipe",
          }),
        );
        await client.listTools();
        const result = await client.callTool({
          name: "feedbacks_recording_materialize",
          arguments: { recordingId: id },
        });
        assert.notEqual(result.isError, true, JSON.stringify(result.content));
        directory = (result.structuredContent as any).directory;
        assert.ok(directory);
        const logs = await readFile(`${directory}/console.jsonl`, "utf8");
        assert.match(logs, /Synthetic failed checkout/);
        assert.equal(
          JSON.parse(await readFile(`${directory}/manifest.json`, "utf8")).recording.id,
          id,
        );
      } finally {
        await client.close();
        if (directory) await rm(directory, { recursive: true, force: true });
      }
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
