import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";
import {
  inputSchemas,
  outputSchemas,
  operationRegistry,
} from "../src/shared/contracts.js";
import { readFilters, filterQuery, readOffset } from "../src/web/review-filters.js";

test("review navigation crosses pages with identical filters; tags and personal views enforce permissions and revisions", async () => {
  const pg = new PGlite(),
    db = new Database(pg as any);
  try {
    await migrate(db);
    const ops = new Operations(db, {} as any, {} as any);
    const owner = await ops.auth.bootstrap(
      "owner@example.test",
      "Owner",
      "Correct-Horse-Battery-123",
    );
    const project = await ops.executeOperation(owner, "projects.create", {
      name: "Review",
      origins: ["https://example.test"],
    });
    const other = await ops.executeOperation(owner, "projects.create", {
      name: "Other",
      origins: ["https://other.test"],
    });
    const invite = await ops.executeOperation(owner, "members.invite", {
      email: "review@example.test",
      projectId: project.id,
      role: "reviewer",
    });
    await ops.auth.acceptInvite(invite.token, "Reviewer", "Correct-Horse-Battery-123");
    const reviewer = (
      await ops.auth.login("review@example.test", "Correct-Horse-Battery-123")
    ).actor;
    const created = [];
    for (let n = 0; n < 34; n++)
      created.push(
        await ops.executeOperation(owner, "threads.create", {
          projectId: project.id,
          body: `Checkout spacing ${n}`,
          category: "visualDesign",
          tags: [" Mobile ", "mobile", "checkout"],
          context: {
            url: "https://example.test/checkout",
            viewport: { width: 390, height: 844 },
          },
          idempotencyKey: `review-${n}-create`,
        }),
      );
    assert.deepEqual(created[0].tags, ["checkout", "mobile"]);
    const filters = {
      projectId: project.id,
      sort: "newest",
      tag: "mobile",
      category: "visualDesign",
      search: "spacing",
      deviceClass: "mobile",
      domain: "example.test",
    };
    const first = await ops.executeOperation(reviewer, "threads.list", filters),
      second = await ops.executeOperation(reviewer, "threads.list", {
        ...filters,
        offset: 30,
      });
    assert.equal(first.total, 34);
    assert.equal(first.items.length, 30);
    assert.equal(second.items.length, 4);
    let listQueries = 0;
    const query = Database.prototype.query;
    Database.prototype.query = async function (...args: Parameters<Database["query"]>) {
      listQueries++;
      return query.apply(this, args);
    };
    let batched;
    try {
      batched = await ops.executeOperation(reviewer, "threads.list", filters);
    } finally {
      Database.prototype.query = query;
    }
    assert.deepEqual(batched.items, first.items);
    assert.ok(
      listQueries <= 20,
      `30 list rows should use bounded queries, got ${listQueries}`,
    );
    await ops.executeOperation(owner, "threads.reply", {
      threadId: created[1].id,
      revision: 1,
      body: "Adjusted the mobile spacing",
      intent: "response",
      idempotencyKey: "batched-reply-one",
    });
    await ops.executeOperation(reviewer, "views.like", {
      projectId: project.id,
      context: {
        url: "https://example.test/checkout",
        viewport: { width: 390, height: 844 },
      },
      liked: true,
    });
    const ownerList = await ops.executeOperation(owner, "threads.list", {
      projectId: project.id,
    });
    assert.deepEqual(
      ownerList.items.find((item: { id: string }) => item.id === created[1].id),
      await ops.executeOperation(owner, "threads.get", {
        threadId: created[1].id,
      }),
    );
    const edge = await ops.executeOperation(reviewer, "threads.neighbors", {
      ...filters,
      threadId: first.items[29].id,
    });
    assert.deepEqual(edge, {
      previous: first.items[28].id,
      next: second.items[0].id,
      position: 30,
      total: 34,
    });
    outputSchemas["threads.neighbors"].parse(edge);
    for (const sort of ["activity", "likes", "newest"]) {
      const list = await ops.executeOperation(owner, "threads.list", {
        ...filters,
        sort,
      });
      const adjacent = await ops.executeOperation(owner, "threads.neighbors", {
        ...filters,
        sort,
        threadId: list.items[1].id,
      });
      assert.equal(adjacent.previous, list.items[0].id);
      assert.equal(adjacent.next, list.items[2].id);
    }
    const outside = await ops.executeOperation(owner, "threads.neighbors", {
      threadId: created[0].id,
      tag: "absent",
    });
    assert.deepEqual(outside, { previous: null, next: null, position: null, total: 0 });
    const legacyInput = inputSchemas["threads.create"].parse({
      projectId: project.id,
      body: "Draft from an earlier extension",
      context: { url: "https://example.test", viewport: { width: 900, height: 800 } },
      idempotencyKey: "legacy-draft-create",
    });
    const legacyThread = await ops.executeOperation(owner, "threads.create", legacyInput);
    const { tags: _tags, ...beforeTags } = legacyInput;
    await db.query(
      "UPDATE idempotency SET input_hash=$1 WHERE actor_id=$2 AND operation='threads.create' AND key=$3",
      [
        createHash("sha256").update(JSON.stringify(beforeTags)).digest("hex"),
        owner.id,
        legacyInput.idempotencyKey,
      ],
    );
    assert.equal(
      (await ops.executeOperation(owner, "threads.create", legacyInput)).id,
      legacyThread.id,
    );
    await assert.rejects(
      ops.executeOperation(owner, "threads.create", {
        ...legacyInput,
        tags: ["changed"],
      }),
      { code: "IDEMPOTENCY_CONFLICT" },
    );
    const changed = await ops.executeOperation(reviewer, "threads.organize", {
      threadId: created[0].id,
      revision: 1,
      tags: [],
      category: "general",
    });
    assert.deepEqual(changed.tags, []);
    assert.equal(changed.work.state, "open");
    await assert.rejects(
      ops.executeOperation(reviewer, "threads.organize", {
        threadId: changed.id,
        revision: 1,
        tags: ["stale"],
      }),
      { code: "CONFLICT" },
    );
    await assert.rejects(
      ops.executeOperation(owner, "threads.organize", {
        threadId: changed.id,
        revision: 2,
        tags: ["bad,tag"],
      }),
      { code: "VALIDATION" },
    );
    const inaccessible = await ops.executeOperation(owner, "threads.create", {
      projectId: other.id,
      body: "Private",
      context: { url: "https://other.test", viewport: { width: 900, height: 800 } },
      idempotencyKey: "private-thread",
    });
    await assert.rejects(
      ops.executeOperation(reviewer, "threads.neighbors", { threadId: inaccessible.id }),
      { code: "FORBIDDEN" },
    );
    const saved = await ops.executeOperation(reviewer, "reviewViews.save", {
      projectId: project.id,
      name: "Mobile checkout",
      filters,
    });
    assert.equal(
      (await ops.executeOperation(owner, "reviewViews.list", { projectId: project.id }))
        .items.length,
      0,
    );
    await assert.rejects(
      ops.executeOperation(owner, "reviewViews.delete", {
        projectId: project.id,
        viewId: saved.id,
        revision: 1,
      }),
      { code: "NOT_FOUND" },
    );
    await assert.rejects(
      ops.executeOperation(reviewer, "reviewViews.list", { projectId: other.id }),
      { code: "FORBIDDEN" },
    );
    const updated = await ops.executeOperation(reviewer, "reviewViews.save", {
      projectId: project.id,
      viewId: saved.id,
      revision: 1,
      name: "Renamed",
      filters: { tag: "checkout" },
    });
    assert.equal(updated.revision, 2);
    await assert.rejects(
      ops.executeOperation(reviewer, "reviewViews.delete", {
        projectId: project.id,
        viewId: saved.id,
        revision: 1,
      }),
      { code: "CONFLICT" },
    );
    assert.equal(
      (
        await ops.executeOperation(reviewer, "reviewViews.delete", {
          projectId: project.id,
          viewId: saved.id,
          revision: 2,
        })
      ).deleted,
      true,
    );
    for (let n = 0; n < 30; n++)
      await ops.executeOperation(reviewer, "reviewViews.save", {
        projectId: project.id,
        name: `View ${n}`,
        filters: {},
      });
    await assert.rejects(
      ops.executeOperation(reviewer, "reviewViews.save", {
        projectId: project.id,
        name: "Too many",
        filters: {},
      }),
      { code: "LIMIT_REACHED" },
    );
    const key = await ops.executeOperation(owner, "tokens.create", {
      name: "Legacy read",
      projectIds: [project.id],
      scopes: ["threads.get"],
    });
    const actor = await ops.auth.authenticate(key.token);
    await assert.rejects(
      ops.executeOperation(actor, "threads.organize", {
        threadId: changed.id,
        revision: 2,
        tags: [],
      }),
      { code: "FORBIDDEN" },
    );
    assert.equal(operationRegistry["threads.neighbors"].readOnly, true);
    assert.equal(operationRegistry["reviewViews.save"].readOnly, false);
  } finally {
    await pg.close();
  }
});

test("URL review state round-trips filters and safely bounds pagination", () => {
  const filters = inputSchemas["threads.list"].parse({
    projectId: randomUUID(),
    tag: "checkout",
    sort: "likes",
    showResolved: true,
    search: "button & spacing",
    category: "visualDesign",
    hostname: "example.test",
  });
  const { projectId, limit, offset, ...expected } = filters;
  assert.deepEqual(readFilters(filterQuery(expected, 60)), expected);
  assert.equal(readOffset(filterQuery(expected, 60)), 60);
  for (const invalid of ["offset=-1", "offset=Infinity", "offset=100001", "offset=1.5"])
    assert.equal(readOffset(invalid), 0);
  assert.equal(readFilters("sort=unknown&deviceClass=bad&category=bad").sort, "activity");
});
