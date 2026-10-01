import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("MCPB extracts into a runnable stdio server with private per-user setup", async () => {
  execFileSync(process.execPath, ["scripts/package-mcpb.mjs"]);
  const directory = await mkdtemp(join(tmpdir(), "feedbacks-mcpb-"));
  const client = new Client({ name: "feedbacks-mcpb-test", version: "1" });
  try {
    execFileSync("unzip", ["-q", "dist/feedbacks-mcp.mcpb", "-d", directory]);
    const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
    assert.equal(manifest.user_config.token.sensitive, true);
    assert.equal(manifest.user_config.token.required, true);
    assert.equal(manifest.user_config.server_url.required, true);
    assert.equal(manifest.server.mcp_config.env.FEEDBACKS_TOKEN, "${user_config.token}");
    assert.equal(manifest.user_config.token.default, undefined);
    const args = manifest.server.mcp_config.args.map((arg: string) =>
      arg.replace("${__dirname}", directory),
    );
    const transport = new StdioClientTransport({
      command: process.execPath,
      args,
      env: {
        FEEDBACKS_URL: "http://127.0.0.1:1",
        FEEDBACKS_TOKEN: "synthetic-package-test-key",
      },
      stderr: "pipe",
    });
    await client.connect(transport);
    const tools = (await client.listTools()).tools;
    assert.ok(tools.some((tool) => tool.name === "feedbacks_start"));
    assert.ok(tools.some((tool) => tool.name === "feedbacks_recording_materialize"));
    assert.ok(tools.some((tool) => tool.name === "feedbacks_execute"));
    assert.ok((await readFile(join(directory, "THIRD_PARTY_NOTICES.md"), "utf8")).length);
  } finally {
    await client.close();
    await rm(directory, { recursive: true, force: true });
  }
});
