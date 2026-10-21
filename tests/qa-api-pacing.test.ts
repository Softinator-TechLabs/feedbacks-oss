import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { setTimeout } from "node:timers/promises";
import { paceQaApi } from "../scripts/lib/qa-api-pacing.mjs";

test("QA pacing bounds queued work, skips cancelled requests and never replays an operation rejection", async () => {
  const calls: Array<{ id: number; at: number }> = [];
  const finished = Promise.withResolvers<void>();
  const paced = paceQaApi((req: any, res: any) => {
    calls.push({ id: req.id, at: performance.now() });
    res.writeHead(429);
    res.end("Definite operation rejection");
    if (req.id === 23) finished.resolve();
  });
  const requests = Array.from({ length: 25 }, (_, id) => ({
    id,
    method: "POST",
    url: "/api/projects.list",
    destroyed: false,
  }));
  const replies = requests.map(() => ({
    destroyed: false,
    status: 0,
    body: "",
    writeHead(status: number) {
      this.status = status;
    },
    end(body: string) {
      this.body = body;
    },
  }));
  for (const [index, request] of requests.entries()) paced(request, replies[index]);
  // Closed clients waiting behind the first dispatch must never execute later.
  for (const request of requests.slice(1, 23)) request.destroyed = true;
  await finished.promise;
  await setTimeout(20);
  assert.deepEqual(
    calls.map((call) => call.id),
    [0, 23],
  );
  assert.ok(calls[1].at - calls[0].at >= 260, "dispatches stay below 240/minute");
  assert.equal(replies[0].status, 429, "application failures pass through unchanged");
  assert.equal(replies[23].status, 429);
  assert.equal(replies[24].status, 503, "an overflowing fixture queue fails visibly");
  assert.equal(JSON.parse(replies[24].body).error.code, "QA_API_PACING_CAPACITY");
  assert.equal(paced.stats.dispatched, 2);
  assert.equal(paced.stats.cancelled, 22);
  assert.equal(paced.stats.overflow, 1);
});

test("QA pacing preserves real HTTP bodies and responses while leaving static requests unpaced", async () => {
  const bodies: string[] = [];
  const paced = paceQaApi(async (req: any, res: any) => {
    if (req.method === "GET") {
      res.end("static");
      return;
    }
    let body = "";
    for await (const chunk of req) body += chunk;
    bodies.push(body);
    res.writeHead(409, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: { code: "CONFLICT" } }));
  });
  const server = createServer(paced).listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}`;
    for (const body of ['{"id":"first"}', '{"id":"second"}']) {
      const response = await fetch(url + "/api/projects.list", { method: "POST", body });
      assert.equal(response.status, 409);
      assert.equal((await response.json()).error.code, "CONFLICT");
    }
    assert.equal(await (await fetch(url + "/asset.js")).text(), "static");
    assert.deepEqual(bodies, ['{"id":"first"}', '{"id":"second"}']);
    assert.equal(paced.stats.dispatched, 2);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
