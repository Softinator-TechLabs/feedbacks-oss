import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Auth } from "../src/server/auth.js";
import { createApp } from "../src/server/app.js";

async function fixture(trustProxyHops = 0) {
  const pg = new PGlite();
  const db = new Database(pg as any);
  await migrate(db);
  await new Auth(db).bootstrap(
    "owner@example.test",
    "Owner",
    "Correct-Horse-Battery-123",
  );
  const config: any = {
    appOrigin: "http://localhost:3000",
    production: false,
    organizationId: "00000000-0000-4000-8000-000000000001",
    trustProxyHops,
  };
  const server = createApp(config, db, {} as any).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/auth.login`;
  const login = (password: string, forwardedIp?: string, email = "owner@example.test") =>
    fetch(url, {
      method: "POST",
      headers: {
        Origin: config.appOrigin,
        "Content-Type": "application/json",
        ...(forwardedIp ? { "X-Forwarded-For": forwardedIp } : {}),
      },
      body: JSON.stringify({ email, password }),
    });
  const close = async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pg.close();
  };
  return { db, login, close };
}

test("third failed sign-in locks the client IP for five minutes", async () => {
  const { db, login, close } = await fixture();
  try {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const response = await login("incorrect-password");
      assert.equal(response.status, 401);
    }
    const third = await login("incorrect-password");
    assert.equal(third.status, 429);
    assert.equal(third.headers.get("Retry-After"), "300");
    const blocked = await third.json();
    assert.match(blocked.error.message, /this IP address.*5 minutes/i);
    assert.equal(
      (await login("Correct-Horse-Battery-123", "192.0.2.88")).status,
      429,
      "untrusted forwarded addresses cannot evade the lock",
    );
    await db.query(
      "UPDATE login_ip_failures SET expires_at=now()-interval '1 second',blocked_until=now()-interval '1 second'",
    );
    assert.equal((await login("Correct-Horse-Battery-123")).status, 200);
    assert.equal((await login("incorrect-password")).status, 401);
    assert.equal((await login("incorrect-password")).status, 401);
    assert.equal((await login("Correct-Horse-Battery-123")).status, 200);
    assert.equal((await login("incorrect-password")).status, 401);
    assert.equal((await login("incorrect-password")).status, 401);
    assert.equal((await login("incorrect-password")).status, 429);
  } finally {
    await close();
  }
});

test("alternate IPv6 spellings share one lock while another IP remains available", async () => {
  const { login, close } = await fixture(1);
  try {
    assert.equal(
      (await login("incorrect-password", "2001:0db8:0:0:0:0:0:1")).status,
      401,
    );
    assert.equal((await login("incorrect-password", "2001:db8::1")).status, 401);
    assert.equal((await login("incorrect-password", "2001:0db8::1")).status, 429);
    assert.equal((await login("Correct-Horse-Battery-123", "2001:db8::1")).status, 429);
    assert.equal((await login("Correct-Horse-Battery-123", "2001:db8::2")).status, 200);
    assert.equal((await login("Correct-Horse-Battery-123", "fe80::1%eth0")).status, 200);
    assert.equal((await login("incorrect-password", "::ffff:192.0.2.1")).status, 401);
    assert.equal((await login("incorrect-password", "192.0.2.1")).status, 401);
    assert.equal(
      (await login("incorrect-password", "::ffff:c000:201", "missing@example.test"))
        .status,
      429,
      "IPv4-mapped forms and unknown accounts cannot reset the IP budget",
    );
  } finally {
    await close();
  }
});
