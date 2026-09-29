import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { spawn } from "node:child_process";

test("JSON CLI preserves missing-scope recovery from the HTTP operation", async () => {
  const details = {
    operation: "recordings.list",
    reason: "missing_operation_scope",
    requiredScopes: ["recordings.list"],
    recovery: "Create a replacement key in Account and reconnect.",
  };
  const server = createServer((_request, response) => {
    response.writeHead(403, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        ok: false,
        error: { code: "FORBIDDEN", message: "Missing token scope", details },
      }),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const port = (server.address() as { port: number }).port;
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "src/cli/feedbacks.ts", "recordings.list"],
      {
        env: {
          ...process.env,
          FEEDBACKS_URL: `http://127.0.0.1:${port}`,
          FEEDBACKS_TOKEN: "synthetic-test-token",
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let output = "";
    child.stdout.on("data", (data) => {
      output += data;
    });
    child.stdin.end(JSON.stringify({ threadId: "8c06f94d-fca6-4333-84b7-671e560812bc" }));
    const [code] = await once(child, "close");
    assert.equal(code, 1);
    const result = JSON.parse(output);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "FORBIDDEN");
    assert.deepEqual(result.error.details, details);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
