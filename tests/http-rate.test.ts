import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";
import { createApp } from "../src/server/app.js";

test("web sessions and paired extensions have independent credential budgets while actor and shared ingress limits remain enforced", async (t) => {
  // Keep all requests in one budget window even on a busy CI worker.
  const now = Date.now();
  t.mock.method(Date, "now", () => now);
  const pg = new PGlite(),
    db = new Database(pg as any);
  const config: any = { appOrigin: "https://feedbacks.example.test", production: false };
  let server: ReturnType<ReturnType<typeof createApp>["listen"]> | undefined;
  try {
    await migrate(db);
    const ops = new Operations(db, {} as any, config);
    const password = "Synthetic-Budget-Password-123";
    const owner = await ops.auth.bootstrap("owner@example.test", "Owner", password);
    const pair = await ops.auth.requestPairing("Synthetic extension");
    await ops.executeOperation(owner, "pairing.approve", { pairingId: pair.pairingId });
    const paired = await ops.auth.pollPairing(pair.pairingId, pair.deviceSecret);
    assert.equal(paired.status, "approved");
    assert.ok(paired.token);
    const extension = await ops.auth.authenticate(paired.token);
    assert.equal(extension.id, owner.id, "Attribution retains the member identity");
    assert.ok(extension.tokenId, "Budgeting can identify the verified credential");
    const agent = await ops.executeOperation(owner, "tokens.create", {
      name: "Synthetic separate credential",
      scopes: ["projects.list"],
    });
    server = createApp(config, db, {} as any).listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const post = (name: string, body: unknown, headers: Record<string, string> = {}) =>
      fetch(`${base}/api/${name}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
      });
    const status = async (pending: Promise<Response>) => {
      const response = await pending;
      await response.arrayBuffer();
      return response.status;
    };
    const login = await post(
      "auth.login",
      { email: "owner@example.test", password },
      { Origin: config.appOrigin },
    );
    assert.equal(login.status, 200);
    const session = await login.json();
    const humanHeaders = {
      Origin: config.appOrigin,
      Cookie: login.headers.get("set-cookie")!.split(";")[0],
      "X-CSRF-Token": session.data.csrf,
    };
    const extensionHeaders = { Authorization: `Bearer ${paired.token}` };
    for (let index = 0; index < 240; index++) {
      assert.equal(
        await status(post("projects.list", {}, humanHeaders)),
        200,
        `Web request ${index + 1}`,
      );
      assert.equal(
        await status(post("projects.list", {}, extensionHeaders)),
        200,
        `Extension request ${index + 1}`,
      );
    }
    for (const headers of [humanHeaders, extensionHeaders]) {
      const limited = await post("projects.list", {}, headers);
      assert.equal(limited.status, 429);
      assert.equal((await limited.json()).error.code, "RATE_LIMITED");
      assert.ok(Number(limited.headers.get("retry-after")) > 0);
    }
    // Another credential does not inherit an exhausted actor budget. Failed
    // authentication still spends the shared 600-request ingress allowance.
    const agentHeaders = { Authorization: `Bearer ${agent.token}` };
    assert.equal(await status(post("projects.list", {}, agentHeaders)), 200);
    for (let count = 483; count < 600; count++)
      assert.equal(
        await status(
          post("projects.list", {}, { Authorization: "Bearer invalid-synthetic" }),
        ),
        401,
      );
    const ingress = await post("projects.list", {}, agentHeaders);
    assert.equal(ingress.status, 429);
    assert.equal((await ingress.json()).error.code, "RATE_LIMITED");
    assert.ok(Number(ingress.headers.get("retry-after")) > 0);
  } finally {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    await pg.close();
  }
});
