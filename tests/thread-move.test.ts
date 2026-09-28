import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../src/server/db.js";
import { migrate } from "../src/server/migrations.js";
import { Operations } from "../src/server/operations.js";
import { assetRow } from "../src/server/assets.js";
import { documentRow } from "../src/server/documents.js";
import { pollGithubStatusSync } from "../src/server/github-status-worker.js";
import { selfAgentTokenScopes } from "../src/shared/contracts.js";
import sharp from "sharp";

async function fixture() {
  const pg = new PGlite(),
    db = new Database(pg as any);
  await migrate(db);
  const ops = new Operations(
    db,
    {
      put: async () => {},
      get: async () => Buffer.from("preserved"),
      remove: async () => {
        throw Error("must not delete media");
      },
    },
    { appOrigin: "https://feedbacks.example.test" } as any,
  );
  const owner = await ops.auth.bootstrap(
    "owner@example.test",
    "Owner",
    "Correct-Horse-Battery-123",
  );
  const source = await ops.executeOperation(owner, "projects.create", {
    name: "Source",
    origins: ["https://example.test"],
  });
  const target = await ops.executeOperation(owner, "projects.create", {
    name: "Destination",
    origins: ["https://other.example.test"],
  });
  const create = (extra = {}) =>
    ops.executeOperation(owner, "threads.create", {
      projectId: source.id,
      body: "Preserve this feedback",
      context: { url: "https://example.test", viewport: { width: 1000, height: 800 } },
      idempotencyKey: randomUUID(),
      ...extra,
    });
  const member = async (role = "maintainer") => {
    const email = `${randomUUID()}@example.test`;
    const invite = await ops.executeOperation(owner, "members.invite", {
      email,
      projectId: source.id,
      role,
    });
    await ops.auth.acceptInvite(invite.token, "Member", "Correct-Horse-Battery-123");
    return (await ops.auth.login(email, "Correct-Horse-Battery-123")).actor;
  };
  return { pg, db, ops, owner, source, target, create, member };
}

test("move preserves the thread and media while removing source access and snapshots", async () => {
  const f = await fixture();
  try {
    const { db, ops, owner, source, target } = f;
    const sourceMember = await f.member("viewer");
    const point = {
      id: randomUUID(),
      body: "Preserve this point",
      anchor: { selector: "#point", confidence: "element" },
    };
    let thread = await f.create({
      context: {
        url: "https://example.test",
        viewport: { width: 1000, height: 800 },
        annotations: [point],
      },
    });
    thread = await ops.executeOperation(owner, "threads.annotationStatus", {
      threadId: thread.id,
      revision: thread.revision,
      annotationId: point.id,
      state: "resolved",
    });
    thread = await ops.executeOperation(owner, "threads.reply", {
      threadId: thread.id,
      revision: thread.revision,
      body: "Keep discussion",
      idempotencyKey: randomUUID(),
    });
    await db.query("INSERT INTO discussion_likes(thread_id,user_id) VALUES($1,$2)", [
      thread.id,
      sourceMember.userId,
    ]);
    const assetId = randomUUID(),
      objectKey = "original/project/capture.webp";
    await db.query(
      "INSERT INTO assets(id,project_id,thread_id,object_key,data,status) VALUES($1,$2,$3,$4,$5,'validated')",
      [
        assetId,
        source.id,
        thread.id,
        objectKey,
        JSON.stringify({ contentType: "image/webp", filename: "capture.webp" }),
      ],
    );
    await db.query("INSERT INTO qa_baselines(thread_id,asset_id) VALUES($1,$2)", [
      thread.id,
      assetId,
    ]);
    const linkId = randomUUID();
    await db.query(
      "INSERT INTO guest_links(id,hash,thread_id,project_id,label,created_by,expires_at) VALUES($1,$2,$3,$4,'guest',$5,now()+interval '1 day')",
      [linkId, randomUUID(), thread.id, source.id, owner.userId],
    );
    const exported = await ops.executeOperation(sourceMember, "context.export", {
      projectId: source.id,
    });
    const before = await db.one("SELECT * FROM threads WHERE id=$1", [thread.id]);
    const input = {
      threadId: thread.id,
      revision: thread.revision,
      projectId: target.id,
    };
    const moved = await ops.executeOperation(owner, "threads.move", input);
    assert.equal(moved.id, thread.id);
    assert.equal(moved.projectId, target.id);
    assert.equal(moved.revision, thread.revision + 1);
    assert.equal(moved.body, thread.body);
    assert.deepEqual(moved.context, thread.context);
    assert.deepEqual(moved.work, thread.work);
    assert.deepEqual(moved.annotationStates, thread.annotationStates);
    assert.equal(moved.replies[0].body, "Keep discussion");
    assert.equal(moved.likes.uniqueLikes, 1);
    assert.equal(moved.assets[0].id, assetId);
    assert.equal(moved.createdAt, new Date(before.created_at).toISOString());
    assert.equal((await assetRow(db, owner, assetId)).object_key, objectKey);
    assert.equal((await assetRow(db, owner, assetId)).project_id, target.id);
    assert.equal(
      (await db.one("SELECT * FROM qa_baselines WHERE thread_id=$1", [thread.id]))
        .asset_id,
      assetId,
    );
    assert.ok(
      (await db.one("SELECT * FROM guest_links WHERE id=$1", [linkId])).revoked_at,
    );
    await assert.rejects(
      ops.executeOperation(sourceMember, "threads.get", { threadId: thread.id }),
      { code: "FORBIDDEN" },
    );
    await assert.rejects(assetRow(db, sourceMember, assetId), { code: "FORBIDDEN" });
    await assert.rejects(
      ops.executeOperation(sourceMember, "context.export", {
        projectId: source.id,
        snapshotId: exported.snapshotId,
      }),
      { code: "SNAPSHOT_EXPIRED" },
    );
    assert.equal(
      (await ops.executeOperation(sourceMember, "threads.list", { projectId: source.id }))
        .items.length,
      0,
    );
    await assert.rejects(ops.executeOperation(owner, "threads.move", input), {
      code: "CONFLICT",
    });
    const same = await ops.executeOperation(owner, "threads.move", {
      ...input,
      revision: moved.revision,
    });
    assert.equal(same.revision, moved.revision);
    const oldEvents = await db.query(
      "SELECT kind,data FROM events WHERE project_id=$1 AND entity_id=$2",
      [source.id, thread.id],
    );
    assert.deepEqual(oldEvents, [{ kind: "threads.movedOut", data: {} }]);
    assert.ok(
      (
        await db.query("SELECT kind FROM events WHERE project_id=$1 AND entity_id=$2", [
          target.id,
          thread.id,
        ])
      ).some((e) => e.kind === "thread.created"),
    );
  } finally {
    await f.pg.close();
  }
});

test("move requires live maintainer access and explicit token scope on both projects", async () => {
  const f = await fixture();
  try {
    const { db, ops, owner, source, target } = f;
    const thread = await f.create(),
      member = await f.member();
    const input = {
      threadId: thread.id,
      revision: thread.revision,
      projectId: target.id,
    };
    await assert.rejects(ops.executeOperation(member, "threads.move", input), {
      code: "FORBIDDEN",
    });
    await db.query("INSERT INTO grants(project_id,user_id,role) VALUES($1,$2,'viewer')", [
      target.id,
      member.userId,
    ]);
    await assert.rejects(ops.executeOperation(member, "threads.move", input), {
      code: "FORBIDDEN",
    });
    await db.query(
      "UPDATE grants SET role='maintainer' WHERE project_id=$1 AND user_id=$2",
      [target.id, member.userId],
    );
    const issue = async (projectIds: string[], scopes: string[]) => {
      const token = await ops.executeOperation(member, "tokens.create", {
        name: "Move fixture",
        projectIds,
        scopes,
      });
      return ops.auth.authenticate(token.token);
    };
    assert.ok(selfAgentTokenScopes.includes("threads.move"));
    const missingScope = await issue([source.id, target.id], ["threads.get"]);
    const missingDestination = await issue([source.id], ["threads.move"]);
    const missingSource = await issue([target.id], ["threads.move"]);
    for (const actor of [missingScope, missingDestination, missingSource])
      await assert.rejects(ops.executeOperation(actor, "threads.move", input), {
        code: "FORBIDDEN",
      });
    const agent = await issue([source.id, target.id], ["threads.move"]);
    await db.query(
      "UPDATE grants SET role='reviewer' WHERE project_id=$1 AND user_id=$2",
      [source.id, member.userId],
    );
    await assert.rejects(ops.executeOperation(agent, "threads.move", input), {
      code: "FORBIDDEN",
    });
    assert.equal(
      (await ops.executeOperation(owner, "threads.get", { threadId: thread.id }))
        .projectId,
      source.id,
    );
    await db.query(
      "UPDATE grants SET role='maintainer' WHERE project_id=$1 AND user_id=$2",
      [source.id, member.userId],
    );
    await assert.rejects(
      ops.executeOperation(agent, "threads.move", { ...input, revision: 999 }),
      { code: "CONFLICT" },
    );
    assert.equal(
      (await ops.executeOperation(agent, "threads.move", input)).projectId,
      target.id,
    );
  } finally {
    await f.pg.close();
  }
});

test("assignments follow moves only when members and active worker tokens can access the destination", async () => {
  const f = await fixture();
  try {
    const { db, ops, owner, source, target } = f;
    const member = await f.member("reviewer");
    const taxonomy = await ops.executeOperation(owner, "projects.taxonomy.update", {
      projectId: source.id,
      revision: source.revision,
      categories: [{ name: "Editorial", archived: false }],
      tags: [{ name: "proof", color: "rose" }],
    });
    const category = taxonomy.categories.find((c: any) => c.name === "Editorial").id;
    const thread = await f.create({ category, tags: ["proof"] });
    const delegation = await ops.executeOperation(owner, "assignments.assign", {
      threadId: thread.id,
      threadRevision: thread.revision,
      userId: member.userId,
      category,
      tags: ["proof"],
      summary: "Review this",
      githubDecision: "not_needed",
      githubRationale: "Internal feedback",
      idempotencyKey: randomUUID(),
    });
    const token = await ops.executeOperation(member, "tokens.create", {
      name: "Worker",
      projectIds: [source.id],
      scopes: ["assignments.claim", "assignments.list"],
    });
    const agent = await ops.auth.authenticate(token.token);
    const claim = await ops.executeOperation(agent, "assignments.claim", {
      threadId: thread.id,
      revision: thread.revision,
      summary: "Reviewing",
      idempotencyKey: randomUUID(),
    });
    const input = {
      threadId: thread.id,
      revision: thread.revision,
      projectId: target.id,
    };
    await assert.rejects(
      ops.executeOperation(owner, "threads.move", input),
      /Active assignees/,
    );
    await db.query(
      "INSERT INTO grants(project_id,user_id,role) VALUES($1,$2,'reviewer')",
      [target.id, member.userId],
    );
    await assert.rejects(
      ops.executeOperation(owner, "threads.move", input),
      /token scope/,
    );
    await db.query("UPDATE tokens SET projects=$2 WHERE id=$1", [
      agent.id,
      JSON.stringify([source.id, target.id]),
    ]);
    const moved = await ops.executeOperation(owner, "threads.move", input);
    assert.equal(moved.category, category);
    assert.deepEqual(moved.tags, ["proof"]);
    const destinationTaxonomy = await ops.executeOperation(
      owner,
      "projects.taxonomy.get",
      { projectId: target.id },
    );
    assert.ok(
      destinationTaxonomy.categories.some(
        (c: any) => c.id === category && c.name === "Editorial",
      ),
    );
    assert.ok(
      destinationTaxonomy.tags.some((t: any) => t.name === "proof" && t.color === "rose"),
    );
    assert.equal(
      (await db.one("SELECT project_id FROM work_claims WHERE id=$1", [claim.id]))
        .project_id,
      target.id,
    );
    assert.equal(
      (
        await db.one("SELECT project_id FROM work_delegations WHERE id=$1", [
          delegation.id,
        ])
      ).project_id,
      target.id,
    );
    assert.equal(
      (
        await ops.executeOperation(owner, "assignments.history", {
          delegationId: delegation.id,
        })
      ).items.length,
      1,
    );
    assert.equal(
      (await ops.executeOperation(owner, "assignments.list", { projectId: source.id }))
        .items.length,
      0,
    );
    assert.equal(
      (await ops.executeOperation(agent, "assignments.list", { projectId: target.id }))
        .items[0].id,
      claim.id,
    );
  } finally {
    await f.pg.close();
  }
});

test("shared documents block atomically; a sole document and its marker move without changing storage", async () => {
  const f = await fixture();
  try {
    const { db, ops, owner, source, target } = f;
    const member = await f.member();
    const documentId = randomUUID(),
      objectKey = "original/document.pdf";
    await db.query(
      "INSERT INTO documents(id,project_id,object_key,data) VALUES($1,$2,$3,$4)",
      [
        documentId,
        source.id,
        objectKey,
        JSON.stringify({
          name: "Proof.pdf",
          kind: "pdf",
          pageCount: 1,
          pages: [{ width: 600, height: 800 }],
        }),
      ],
    );
    const createMarker = () =>
      f.create({ context: undefined, document: { documentId, page: 1, x: 0.5, y: 0.5 } });
    const first = await createMarker(),
      second = await createMarker();
    const input = { threadId: first.id, revision: first.revision, projectId: target.id };
    await assert.rejects(
      ops.executeOperation(owner, "threads.move", input),
      /document is shared/,
    );
    assert.equal((await documentRow(db, owner, documentId)).project_id, source.id);
    assert.equal(
      (await ops.executeOperation(owner, "threads.get", { threadId: first.id })).revision,
      first.revision,
    );
    await db.query("UPDATE threads SET data=data #- '{context,document}' WHERE id=$1", [
      second.id,
    ]);
    const otherAsset = randomUUID();
    await db.query(
      "INSERT INTO assets(id,project_id,thread_id,object_key,data,status) VALUES($1,$2,$3,$4,'{}','validated')",
      [otherAsset, source.id, second.id, objectKey],
    );
    await assert.rejects(
      ops.executeOperation(owner, "threads.move", input),
      /document is shared/,
    );
    await db.query("DELETE FROM assets WHERE id=$1", [otherAsset]);
    const moved = await ops.executeOperation(owner, "threads.move", input);
    assert.equal(moved.context.document.id, documentId);
    assert.equal(moved.context.document.x, first.context.document.x);
    assert.ok(
      moved.context.url.includes(`/projects/${target.id}/documents/${documentId}`),
    );
    assert.notEqual(moved.context.fingerprint, first.context.fingerprint);
    assert.equal((await documentRow(db, owner, documentId)).project_id, target.id);
    assert.equal((await documentRow(db, owner, documentId)).object_key, objectKey);
    await assert.rejects(documentRow(db, member, documentId), { code: "FORBIDDEN" });
    assert.equal(
      (await ops.executeOperation(owner, "documents.threads", { documentId, page: 1 }))
        .items[0].threadId,
      first.id,
    );
  } finally {
    await f.pg.close();
  }
});

test("GitHub pending writes block moves and preserved issue links cannot start target automatic sync", async () => {
  const f = await fixture();
  try {
    const { db, ops, owner, source, target } = f;
    const thread = await f.create(),
      requestId = randomUUID();
    const issue = {
      provider: "github",
      url: "https://github.com/acme/repo/issues/3",
      repository: "acme/repo",
      number: 3,
      verification: "github_verified",
      state: "open",
    };
    await db.query(
      "UPDATE threads SET data=jsonb_set(data,'{externalIssues}',$2) WHERE id=$1",
      [thread.id, JSON.stringify([issue])],
    );
    await db.query(
      "INSERT INTO github_issue_requests(id,thread_id,project_id,request_key,input_hash,repository,status) VALUES($1,$2,$3,'request','hash','acme/repo','pending')",
      [requestId, thread.id, source.id],
    );
    const input = {
      threadId: thread.id,
      revision: thread.revision,
      projectId: target.id,
    };
    await assert.rejects(
      ops.executeOperation(owner, "threads.move", input),
      /pending GitHub issue/,
    );
    await db.query(
      "UPDATE github_issue_requests SET status='linked',issue_url=$2 WHERE id=$1",
      [requestId, issue.url],
    );
    await db.query(
      "INSERT INTO github_status_sync(thread_id,issue_url,status) VALUES($1,$2,'uncertain')",
      [thread.id, issue.url],
    );
    await assert.rejects(
      ops.executeOperation(owner, "threads.move", input),
      /reconcile GitHub status/,
    );
    await db.query(
      "UPDATE github_status_sync SET status='ready',lease_until=now()+interval '2 minutes' WHERE thread_id=$1",
      [thread.id],
    );
    await assert.rejects(
      ops.executeOperation(owner, "threads.move", input),
      /GitHub status sync/,
    );
    await db.query("UPDATE github_status_sync SET lease_until=NULL WHERE thread_id=$1", [
      thread.id,
    ]);
    await db.query("UPDATE projects SET data=data || $2::jsonb WHERE id=$1", [
      target.id,
      JSON.stringify({
        githubConnected: true,
        githubStatusSync: true,
        repositoryUrl: "https://github.com/acme/repo",
      }),
    ]);
    const moved = await ops.executeOperation(owner, "threads.move", input);
    assert.deepEqual(moved.externalIssues, [issue]);
    assert.equal(
      (
        await db.one("SELECT project_id FROM github_issue_requests WHERE id=$1", [
          requestId,
        ])
      ).project_id,
      target.id,
    );
    const sync = await db.one(
      "SELECT status,error_code FROM github_status_sync WHERE thread_id=$1",
      [thread.id],
    );
    assert.deepEqual(sync, { status: "conflict", error_code: "PROJECT_MOVED" });
    let contacted = false;
    await pollGithubStatusSync(
      db,
      {
        githubAppId: "fixture",
        githubAppPrivateKey: "fixture",
        githubAppSlug: "fixture",
      } as any,
      {
        readIssue: async () => {
          contacted = true;
          throw Error("unexpected external read");
        },
      } as any,
    );
    assert.equal(contacted, false);
  } finally {
    await f.pg.close();
  }
});

test("an upload prepared before a move cannot commit stale project ownership", async () => {
  const f = await fixture();
  let resume!: () => void;
  const release = new Promise<void>((resolve) => {
    resume = resolve;
  });
  try {
    const thread = await f.create();
    let stored!: () => void;
    const uploaded = new Promise<void>((resolve) => {
      stored = resolve;
    });
    const objects = new Map<string, Buffer>();
    const ops = new Operations(
      f.db,
      {
        put: async (key, bytes) => {
          objects.set(key, bytes);
          stored();
          await release;
        },
        get: async (key) => objects.get(key)!,
        remove: async (key) => {
          objects.delete(key);
        },
      },
      {} as any,
    );
    const bytes = await sharp({
      create: { width: 10, height: 10, channels: 3, background: "white" },
    })
      .png()
      .toBuffer();
    const pending = ops.executeOperation(f.owner, "assets.upload", {
      threadId: thread.id,
      revision: thread.revision,
      imageBase64: bytes.toString("base64"),
      idempotencyKey: randomUUID(),
    });
    const failedUpload = assert.rejects(pending, { code: "CONFLICT" });
    await uploaded;
    await ops.executeOperation(f.owner, "threads.move", {
      threadId: thread.id,
      revision: thread.revision,
      projectId: f.target.id,
    });
    resume();
    await failedUpload;
    assert.equal(objects.size, 0);
    assert.equal(
      (await f.db.query("SELECT id FROM assets WHERE thread_id=$1", [thread.id])).length,
      0,
    );
  } finally {
    resume();
    await f.pg.close();
  }
});

test("taxonomy merges matching labels and blocks capacity overflow atomically", async () => {
  const f = await fixture();
  try {
    const { db, ops, owner, source, target } = f;
    const sourceTaxonomy = await ops.executeOperation(owner, "projects.taxonomy.update", {
      projectId: source.id,
      revision: source.revision,
      categories: [{ name: "Editorial", archived: false }],
      tags: [{ name: "proof", color: "rose" }],
    });
    const destinationTaxonomy = await ops.executeOperation(
      owner,
      "projects.taxonomy.update",
      {
        projectId: target.id,
        revision: target.revision,
        categories: [{ name: "Editorial", archived: false }],
        tags: Array.from({ length: 200 }, (_, i) => ({ name: `tag${i}`, color: "blue" })),
      },
    );
    const sourceCategory = sourceTaxonomy.categories.find(
      (c: any) => c.name === "Editorial",
    ).id;
    const targetCategory = destinationTaxonomy.categories.find(
      (c: any) => c.name === "Editorial",
    ).id;
    const thread = await f.create({ category: sourceCategory, tags: ["proof"] });
    const input = {
      threadId: thread.id,
      revision: thread.revision,
      projectId: target.id,
    };
    await assert.rejects(ops.executeOperation(owner, "threads.move", input), {
      code: "LIMIT_REACHED",
    });
    assert.equal(
      (await ops.executeOperation(owner, "threads.get", { threadId: thread.id }))
        .projectId,
      source.id,
    );
    await db.query(
      "UPDATE projects SET data=jsonb_set(data,'{taxonomy,tags}','[]') WHERE id=$1",
      [target.id],
    );
    const moved = await ops.executeOperation(owner, "threads.move", input);
    assert.equal(moved.category, targetCategory);
    const after = await ops.executeOperation(owner, "projects.taxonomy.get", {
      projectId: target.id,
    });
    assert.equal(after.categories.filter((c: any) => c.name === "Editorial").length, 1);
  } finally {
    await f.pg.close();
  }
});
