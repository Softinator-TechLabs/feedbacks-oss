import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import sharp from "sharp";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";
import { assetPreview } from "../src/server/assets.js";
import { inputSchemas } from "../src/shared/contracts.js";
import { runAgentTool } from "../src/shared/agent-workflow.js";

test("today/reviewer filters and a 503-thread backlog retain exact counts with bounded queue pages", async (t) => {
  const pg = new PGlite();
  try {
    const db = new Database(pg as any);
    await migrate(db);
    const ops = new Operations(db, {} as any, {} as any);
    const owner = await ops.auth.bootstrap(
      "agent@example.test",
      "Reviewer",
      "Correct-Horse-Battery-123",
    );
    const project = await ops.executeOperation(owner, "projects.create", {
      name: "Review",
      origins: ["https://example.test"],
    });
    const create = async (n: number) =>
      ops.executeOperation(owner, "threads.create", {
        projectId: project.id,
        body: "Page notes",
        context: {
          url: "https://example.test/page",
          viewport: { width: 1000, height: 800 },
          annotations: [
            {
              id: randomUUID(),
              body: `Price label ${n}`,
              anchor: { selector: "#price" },
            },
          ],
        },
        idempotencyKey: `agent-today-${n}`,
      });
    const items = await Promise.all([create(1), create(2), create(3)]);
    const start = "2026-09-27T18:30:00.000Z",
      end = "2026-09-28T18:30:00.000Z";
    for (const [n, date] of ["2026-09-27T18:29:59.999Z", start, end].entries())
      await db.query("UPDATE threads SET created_at=$1,updated_at=$1 WHERE id=$2", [
        date,
        items[n].id,
      ]);
    const execute = (name: string, input: unknown) =>
      ops.executeOperation(owner, name, input);
    const result = await runAgentTool(execute, "queue", {
      projectId: project.id,
      authorId: owner.userId,
      createdAfter: start,
      createdBefore: end,
      search: "Price label",
      includeSummary: true,
      sort: "topPriority",
    });
    assert.equal(result.total, 1);
    assert.equal(result.items[0].id, items[1].id);
    assert.equal(result.summary.points.open, 1);
    assert.equal(
      (
        await runAgentTool(execute, "queue", {
          projectId: project.id,
          authorId: randomUUID(),
        })
      ).total,
      0,
    );
    assert.equal(
      (
        await runAgentTool(execute, "queue", {
          projectId: project.id,
          workState: "in_progress",
        })
      ).total,
      0,
    );
    assert.equal(
      inputSchemas["threads.list"].safeParse({
        projectId: project.id,
        createdAfter: end,
        createdBefore: start,
      }).success,
      false,
    );
    const seed = await db.one("SELECT data FROM threads WHERE id=$1", [items[1].id]);
    await db.query(
      "INSERT INTO threads(id,project_id,data) SELECT gen_random_uuid(),$1,$2::jsonb FROM generate_series(1,500)",
      [
        project.id,
        JSON.stringify({ ...seed!.data, body: "Synthetic long review ".repeat(500) }),
      ],
    );
    const selection = { projectId: project.id, limit: 10, sort: "newest" };
    const compact = await runAgentTool(execute, "queue", selection);
    const full = await execute("threads.list", selection);
    assert.equal(compact.total, 503);
    assert.equal(compact.nextOffset, 10);
    const compactBytes = Buffer.byteLength(JSON.stringify(compact)),
      fullBytes = Buffer.byteLength(JSON.stringify(full));
    assert.ok(compactBytes < 12000);
    assert.ok(compactBytes * 10 < fullBytes);
    const seen = new Set<string>();
    let offset: number | null = 0;
    do {
      const page = await runAgentTool(execute, "queue", {
        ...selection,
        offset,
        limit: 20,
      });
      for (const item of page.items) {
        assert.ok(!seen.has(item.id));
        seen.add(item.id);
      }
      offset = page.nextOffset;
    } while (offset !== null);
    assert.equal(seen.size, 503);
    t.diagnostic(
      JSON.stringify({
        backlog: 503,
        pageSize: 10,
        compactBytes,
        fullBytes,
        reductionPercent: Math.round(100 * (1 - compactBytes / fullBytes)),
      }),
    );
  } finally {
    await pg.close();
  }
});

test("image crops use original pixels and reject out-of-bounds regions", async () => {
  const bytes = await sharp({
    create: { width: 1000, height: 3000, channels: 3, background: "white" },
  })
    .webp()
    .toBuffer();
  const store = { get: async () => bytes } as any;
  const crop = { left: 100, top: 2000, width: 400, height: 600 };
  const result = await assetPreview(store, "test", 256, crop);
  assert.equal(result.height, 256);
  assert.equal(result.width, 171);
  assert.deepEqual(result.crop, crop);
  assert.equal(result.sourceHeight, 3000);
  await assert.rejects(assetPreview(store, "test", 256, { ...crop, top: 2900 }), {
    code: "VALIDATION",
  });
  assert.equal(
    inputSchemas["assets.get"].safeParse({
      assetId: randomUUID(),
      includeImage: true,
      crop: { ...crop, left: -1 },
    }).success,
    false,
  );
});
