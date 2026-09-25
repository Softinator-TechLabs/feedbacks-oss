import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import sharp from "sharp";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";
import {
  runScheduledQa,
  scanPublicPage,
  validateQaUrl,
} from "../src/server/scheduled-qa.js";

test("static page scanner stays within the exact origin and treats uncertain links as unknown", async () => {
  const called: string[] = [];
  const result = await scanPublicPage("https://example.com/docs", async (url, method) => {
    called.push(`${method} ${url}`);
    if (method === "GET")
      return {
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: `<img src="ok" alt="Useful"><img src="missing"><a href="/missing">bad</a><a href="/unknown">unknown</a><a href="https://other.com/missing">external</a><a href="/private?secret=1">query</a>`,
      };
    if (url.endsWith("/missing")) return { status: 404, body: "", contentType: "" };
    throw Error("HEAD unsupported");
  });
  assert.equal(result.missingAlt, 1);
  assert.deepEqual(result.brokenLinks, [{ path: "/missing", status: 404 }]);
  assert.equal(result.checkedLinks, 1);
  assert.deepEqual(called, [
    "GET https://example.com/docs",
    "HEAD https://example.com/missing",
    "HEAD https://example.com/unknown",
  ]);
});

test("scanner distinguishes real alt attributes and definite HEAD results", async () => {
  const result = await scanPublicPage("https://example.com/docs", async (url, method) => {
    if (method === "GET")
      return {
        status: 200,
        contentType: "text/html",
        body: `<img data-alt="hint"><img ?alt="hint"><img src="alt=fake"><img alt="real"><a href="/ok">ok</a><a href="/missing">missing</a><a href="/method">method</a><a href="/redirect">redirect</a>`,
      };
    return {
      status: url.endsWith("/ok")
        ? 200
        : url.endsWith("/missing")
          ? 404
          : url.endsWith("/method")
            ? 405
            : 302,
      contentType: "",
      body: "",
    };
  });
  assert.equal(result.missingAlt, 3);
  assert.equal(result.checkedLinks, 2);
  assert.deepEqual(result.brokenLinks, [{ path: "/missing", status: 404 }]);
});

test("project QA requires explicit public approved pages and maintainer opt-in", async () => {
  const pg = new PGlite();
  const db = new Database(pg as any);
  try {
    await migrate(db);
    const ops = new Operations(
      db,
      {} as any,
      { appOrigin: "http://localhost:3000" } as any,
    );
    const owner = await ops.auth.bootstrap(
      "qa-owner@example.test",
      "Owner",
      "Correct-Horse-Battery-123",
    );
    const project = await ops.executeOperation(owner, "projects.create", {
      name: "QA",
      origins: ["https://example.com"],
    });
    const invitation = await ops.executeOperation(owner, "members.invite", {
      email: "qa-reviewer@example.test",
      projectId: project.id,
      role: "reviewer",
    });
    await ops.auth.acceptInvite(
      invitation.token,
      "Reviewer",
      "Correct-Horse-Battery-123",
    );
    const reviewer = (
      await ops.auth.login("qa-reviewer@example.test", "Correct-Horse-Battery-123")
    ).actor;
    await assert.rejects(
      ops.executeOperation(reviewer, "qa.configure", {
        projectId: project.id,
        enabled: true,
        urls: ["https://example.com/docs"],
      }),
      { code: "FORBIDDEN" },
    );
    const oldKey = await ops.executeOperation(owner, "tokens.create", {
      name: "Existing scope",
      projectIds: [project.id],
      scopes: ["projects.get"],
    });
    const oldAgent = await ops.auth.authenticate(oldKey.token);
    await assert.rejects(
      ops.executeOperation(oldAgent, "qa.get", { projectId: project.id }),
      { code: "FORBIDDEN" },
    );
    assert.deepEqual(
      (await ops.executeOperation(owner, "qa.get", { projectId: project.id })).urls,
      [],
    );
    for (const url of [
      "http://example.com/",
      "https://localhost/",
      "https://example.com:8443/",
      "https://elsewhere.com/",
      "https://example.com/page?token=secret",
      "https://example.com/#private",
      "https://user:secret@example.com/",
    ]) {
      await assert.rejects(
        ops.executeOperation(owner, "qa.configure", {
          projectId: project.id,
          enabled: true,
          urls: [url],
        }),
      );
    }
    const saved = await ops.executeOperation(owner, "qa.configure", {
      projectId: project.id,
      enabled: true,
      urls: ["https://example.com/docs"],
    });
    assert.equal(saved.enabled, true);
    assert.deepEqual(saved.urls, ["https://example.com/docs"]);
    const listed = await ops.executeOperation(owner, "qa.runs", {
      projectId: project.id,
    });
    assert.deepEqual(listed.items, []);
    await ops.executeOperation(owner, "qa.runNow", { projectId: project.id });
    assert.equal(
      (await ops.executeOperation(owner, "qa.get", { projectId: project.id })).enabled,
      true,
    );
    assert.throws(() =>
      validateQaUrl("https://example.com/private?token=secret", ["https://example.com"]),
    );
  } finally {
    await pg.close();
  }
});

test("changing project origins prevents a queued page request", async () => {
  const pg = new PGlite();
  const db = new Database(pg as any);
  try {
    await migrate(db);
    const ops = new Operations(
      db,
      {} as any,
      { appOrigin: "http://localhost:3000" } as any,
    );
    const owner = await ops.auth.bootstrap(
      "qa-origin@example.test",
      "Owner",
      "Correct-Horse-Battery-123",
    );
    const project = await ops.executeOperation(owner, "projects.create", {
      name: "QA",
      origins: ["https://example.com"],
    });
    await ops.executeOperation(owner, "qa.configure", {
      projectId: project.id,
      enabled: true,
      urls: ["https://example.com/docs"],
    });
    await ops.executeOperation(owner, "projects.update", {
      projectId: project.id,
      revision: project.revision,
      name: project.name,
      origins: ["https://other.com"],
    });
    await runScheduledQa(db, async () => {
      throw Error("A removed origin must not be contacted");
    });
    const runs = await ops.executeOperation(owner, "qa.runs", { projectId: project.id });
    assert.equal(runs.items[0].pages[0].error, "Page is no longer approved for QA");
  } finally {
    await pg.close();
  }
});

test("scheduled QA records reviewable findings without creating feedback", async () => {
  const pg = new PGlite();
  const db = new Database(pg as any);
  try {
    await migrate(db);
    const ops = new Operations(
      db,
      {} as any,
      { appOrigin: "http://localhost:3000" } as any,
    );
    const owner = await ops.auth.bootstrap(
      "qa-worker@example.test",
      "Owner",
      "Correct-Horse-Battery-123",
    );
    const project = await ops.executeOperation(owner, "projects.create", {
      name: "QA",
      origins: ["https://example.com"],
    });
    await ops.executeOperation(owner, "qa.configure", {
      projectId: project.id,
      enabled: true,
      urls: ["https://example.com/docs"],
    });
    const seen: string[] = [];
    await runScheduledQa(db, async (url) => {
      seen.push(url);
      return {
        url,
        status: 200,
        missingAlt: 1,
        brokenLinks: [{ path: "/missing", status: 404 }],
        checkedLinks: 2,
        error: null,
      };
    });
    assert.deepEqual(seen, ["https://example.com/docs"]);
    const runs = await ops.executeOperation(owner, "qa.runs", { projectId: project.id });
    assert.equal(runs.items.length, 1);
    assert.equal(runs.items[0].pages[0].brokenLinks[0].status, 404);
    await assert.rejects(
      ops.executeOperation(owner, "qa.runNow", { projectId: project.id }),
      /one hour/,
    );
    assert.equal(
      (await db.query("SELECT id FROM threads WHERE project_id=$1", [project.id])).length,
      0,
    );
    await runScheduledQa(db, async () => {
      throw Error("must not run twice");
    });
    await ops.executeOperation(owner, "qa.configure", {
      projectId: project.id,
      enabled: false,
      urls: [],
    });
    assert.equal(
      (await ops.executeOperation(owner, "qa.get", { projectId: project.id })).enabled,
      false,
    );
  } finally {
    await pg.close();
  }
});

test("expired worker lease retries a scan interrupted after claim", async () => {
  const pg = new PGlite();
  const db = new Database(pg as any);
  try {
    await migrate(db);
    const ops = new Operations(
      db,
      {} as any,
      { appOrigin: "http://localhost:3000" } as any,
    );
    const owner = await ops.auth.bootstrap(
      "qa-crash@example.test",
      "Owner",
      "Correct-Horse-Battery-123",
    );
    const project = await ops.executeOperation(owner, "projects.create", {
      name: "QA",
      origins: ["https://example.com"],
    });
    await ops.executeOperation(owner, "qa.configure", {
      projectId: project.id,
      enabled: true,
      urls: ["https://example.com/docs"],
    });
    const originalOne = db.one.bind(db);
    db.one = async (sql: string, params: any[] = []) => {
      if (sql.startsWith("SELECT data FROM projects")) throw Error("worker interrupted");
      return originalOne(sql, params);
    };
    await assert.rejects(runScheduledQa(db), /worker interrupted/);
    db.one = originalOne;
    const claimed = await db.one(
      "SELECT next_at,lease_until FROM qa_configs WHERE project_id=$1",
      [project.id],
    );
    assert.ok(claimed.next_at <= new Date(), "interrupted work stays due");
    assert.ok(claimed.lease_until > new Date(), "live lease prevents a concurrent retry");
    await db.query(
      "UPDATE qa_configs SET lease_until=now()-interval '1 second' WHERE project_id=$1",
      [project.id],
    );
    const seen: string[] = [];
    await runScheduledQa(db, async (url) => {
      seen.push(url);
      return {
        url,
        status: 200,
        missingAlt: 0,
        brokenLinks: [],
        checkedLinks: 0,
        error: null,
      };
    });
    assert.deepEqual(seen, ["https://example.com/docs"]);
    assert.equal(
      (await ops.executeOperation(owner, "qa.runs", { projectId: project.id })).items
        .length,
      1,
    );
  } finally {
    await pg.close();
  }
});

test("Run soon during an active lease cannot queue a second scan", async () => {
  const pg = new PGlite();
  const db = new Database(pg as any);
  try {
    await migrate(db);
    const ops = new Operations(
      db,
      {} as any,
      { appOrigin: "http://localhost:3000" } as any,
    );
    const owner = await ops.auth.bootstrap(
      "qa-lease@example.test",
      "Owner",
      "Correct-Horse-Battery-123",
    );
    const project = await ops.executeOperation(owner, "projects.create", {
      name: "QA",
      origins: ["https://example.com"],
    });
    await ops.executeOperation(owner, "qa.configure", {
      projectId: project.id,
      enabled: true,
      urls: ["https://example.com/docs"],
    });
    let scans = 0;
    let runSoonError: any;
    await runScheduledQa(db, async (url) => {
      scans++;
      try {
        await ops.executeOperation(owner, "qa.runNow", { projectId: project.id });
      } catch (error) {
        runSoonError = error;
      }
      return {
        url,
        status: 200,
        missingAlt: 0,
        brokenLinks: [],
        checkedLinks: 0,
        error: null,
      };
    });
    assert.equal(runSoonError?.code, "RATE_LIMIT");
    await runScheduledQa(db, async (url) => {
      scans++;
      return {
        url,
        status: 200,
        missingAlt: 0,
        brokenLinks: [],
        checkedLinks: 0,
        error: null,
      };
    });
    assert.equal(scans, 1);
    assert.equal(
      (await ops.executeOperation(owner, "qa.runs", { projectId: project.id })).items
        .length,
      1,
    );
  } finally {
    await pg.close();
  }
});

test("visual baseline compares only validated images from the same authorized thread", async () => {
  const pg = new PGlite();
  const db = new Database(pg as any);
  const bytes = new Map<string, Buffer>();
  const store = {
    put: async (k: string, v: Buffer) => {
      bytes.set(k, v);
    },
    get: async (k: string) => bytes.get(k)!,
    remove: async (k: string) => {
      bytes.delete(k);
    },
  };
  try {
    await migrate(db);
    const ops = new Operations(db, store, { appOrigin: "http://localhost:3000" } as any);
    const owner = await ops.auth.bootstrap(
      "qa-visual@example.test",
      "Owner",
      "Correct-Horse-Battery-123",
    );
    const project = await ops.executeOperation(owner, "projects.create", {
      name: "QA",
      origins: ["https://example.com"],
    });
    const thread = await ops.executeOperation(owner, "threads.create", {
      projectId: project.id,
      body: "Visual check",
      context: { url: "https://example.com/docs", viewport: { width: 800, height: 600 } },
      idempotencyKey: "visual-thread-1",
    });
    const first = randomUUID(),
      second = randomUUID();
    for (const [id, color] of [
      [first, "red"],
      [second, "blue"],
    ]) {
      const key = `synthetic/${id}`;
      bytes.set(
        key,
        await sharp({ create: { width: 20, height: 20, channels: 3, background: color } })
          .webp()
          .toBuffer(),
      );
      await db.query(
        "INSERT INTO assets(id,project_id,thread_id,object_key,data,status) VALUES($1,$2,$3,$4,$5,'validated')",
        [
          id,
          project.id,
          thread.id,
          key,
          JSON.stringify({
            rendition: "screenshot",
            contentType: "image/webp",
            width: 20,
            height: 20,
            bytes: bytes.get(key)!.length,
          }),
        ],
      );
    }
    await ops.executeOperation(owner, "qa.baselineSet", {
      threadId: thread.id,
      assetId: first,
    });
    assert.equal(
      (await ops.executeOperation(owner, "qa.baselineGet", { threadId: thread.id }))
        .assetId,
      first,
    );
    const result = await ops.executeOperation(owner, "qa.compare", {
      threadId: thread.id,
      assetId: second,
    });
    assert.equal(result.baselineAssetId, first);
    assert.equal(result.candidateAssetId, second);
    assert.equal(result.changedPercent, 100);
    await assert.rejects(
      ops.executeOperation(owner, "qa.baselineSet", {
        threadId: thread.id,
        assetId: randomUUID(),
      }),
    );
  } finally {
    await pg.close();
  }
});
