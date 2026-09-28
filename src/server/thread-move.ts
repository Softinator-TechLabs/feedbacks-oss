import { randomUUID } from "node:crypto";
import type { Actor } from "../shared/contracts.js";
import type { ProjectCategory, ProjectTag } from "../shared/taxonomy.js";
import type { Database } from "./db.js";
import { access, event } from "./access.js";
import { publicActor } from "./auth.js";
import { fail } from "./errors.js";
import { checkRevision, fullThread, threadRow } from "./feedback.js";
import { projectCategories } from "./projects.js";
import { viewContext } from "./views.js";

// Operations holds accountLock for current authorization and the entire move.
// Object keys are storage identities, never authorization boundaries.
export async function moveThread(
  db: Database,
  actor: Actor,
  input: { threadId: string; revision: number; projectId: string },
) {
  const row = await threadRow(db, actor, input.threadId, "maintain", true);
  const source = await access(db, actor, row.project_id, "maintain");
  const destination = await access(db, actor, input.projectId, "maintain");
  checkRevision(row, input.revision);
  if (row.project_id === input.projectId) return fullThread(db, actor, row);

  const pending = await db.one(
    "SELECT id FROM github_issue_requests WHERE thread_id=$1 AND status='pending'",
    [row.id],
  );
  if (pending)
    fail(
      "CONFLICT",
      "Reconcile pending GitHub issue creation before moving feedback",
      409,
    );
  const sync = await db.one(
    "SELECT *,lease_until>now() AS leased FROM github_status_sync WHERE thread_id=$1 FOR UPDATE",
    [row.id],
  );
  if (sync?.leased || sync?.status === "uncertain")
    fail(
      "CONFLICT",
      "Finish or reconcile GitHub status sync before moving feedback",
      409,
    );

  const claims = await db.query("SELECT * FROM work_claims WHERE thread_id=$1", [row.id]);
  const delegations = await db.query(
    "SELECT * FROM work_delegations WHERE thread_id=$1",
    [row.id],
  );
  const activeClaims = claims.filter(
    (c) => c.state === "active" && new Date(c.expires_at).getTime() > Date.now(),
  );
  for (const assignment of [
    ...activeClaims,
    ...delegations.filter((d) => d.state === "active"),
  ]) {
    const user = await db.one(
      "SELECT u.active,u.removed_at,u.owner,g.role FROM users u LEFT JOIN grants g ON g.user_id=u.id AND g.project_id=$2 WHERE u.id=$1",
      [assignment.user_id, destination.id],
    );
    if (
      !user?.active ||
      user.removed_at ||
      !(user.owner || ["reviewer", "maintainer"].includes(user.role))
    )
      fail(
        "CONFLICT",
        "Active assignees must have write access to the destination; grant access or release their work first",
        409,
      );
  }
  for (const claim of activeClaims) {
    // Human claims have their user ID as agent_id. Agent claims must remain usable.
    if (claim.agent_id === claim.user_id) continue;
    const token = await db.one(
      "SELECT t.*,u.owner FROM tokens t JOIN users u ON u.id=t.user_id WHERE t.id=$1 AND t.user_id=$2 AND t.revoked_at IS NULL AND t.expires_at>now()",
      [claim.agent_id, claim.user_id],
    );
    if (
      !token ||
      (!(token.owner_admin && token.owner) && !token.projects.includes(destination.id))
    )
      fail(
        "CONFLICT",
        "Active agent claims must include the destination in their token scope; release the claim first",
        409,
      );
  }

  const assets = await db.query("SELECT id,object_key FROM assets WHERE thread_id=$1", [
    row.id,
  ]);
  const documents = await db.query(
    "SELECT * FROM documents WHERE id::text=$1 OR object_key=ANY($2::text[]) FOR UPDATE",
    [row.data.context.document?.id ?? null, assets.map((a) => a.object_key)],
  );
  if (
    row.data.context.document &&
    !documents.some((d) => d.id === row.data.context.document.id)
  )
    fail(
      "CONFLICT",
      "The feedback document is unavailable; restore it before moving",
      409,
    );
  for (const document of documents) {
    if (
      document.project_id !== source.id ||
      (await db.one(
        "SELECT id FROM threads WHERE id!=$1 AND data->'context'->'document'->>'id'=$2 LIMIT 1",
        [row.id, document.id],
      )) ||
      (await db.one(
        "SELECT id FROM assets WHERE object_key=$1 AND thread_id IS DISTINCT FROM $2 LIMIT 1",
        [document.object_key, row.id],
      ))
    )
      fail(
        "CONFLICT",
        "This document is shared by other feedback; move is unavailable until the document is separate",
        409,
      );
  }
  if (documents.length) {
    const count = await db.one(
      "SELECT count(*)::integer AS count FROM documents WHERE project_id=$1",
      [destination.id],
    );
    if (count.count + documents.length > 100)
      fail("LIMIT_REACHED", "Destination would exceed 100 documents", 409);
  }

  // Match custom categories by label, importing missing definitions. Never
  // silently relabel a point/assignment as General or overwrite target taxonomy.
  const categories: ProjectCategory[] = structuredClone(
    destination.taxonomy?.categories ?? [],
  );
  const tags: ProjectTag[] = structuredClone(destination.taxonomy?.tags ?? []);
  const categoryMap = new Map<string, string>();
  for (const id of new Set<string>([
    row.data.category,
    ...delegations.map((d) => d.category),
  ])) {
    const original = projectCategories(source).find((c) => c.id === id);
    if (!original)
      fail(
        "CONFLICT",
        "Source category is unavailable; organize feedback before moving",
        409,
      );
    const choices = projectCategories({ taxonomy: { categories } });
    let target = choices.find(
      (c) => c.name.toLowerCase() === original.name.toLowerCase(),
    );
    if (!target) {
      if (categories.length >= 32)
        fail("LIMIT_REACHED", "Destination has no room for this custom category", 409);
      target = {
        ...original,
        id: choices.some((c) => c.id === id) ? `custom:${randomUUID()}` : id,
      };
      categories.push(target);
    }
    categoryMap.set(id, target.id);
  }
  const usedTags = new Set<string>([
    ...(row.data.tags ?? []),
    ...delegations.flatMap((d) => d.tags),
  ]);
  for (const tag of (source.taxonomy?.tags ?? []) as ProjectTag[])
    if (usedTags.has(tag.name) && !tags.some((t) => t.name === tag.name)) {
      if (tags.length >= 200)
        fail("LIMIT_REACHED", "Destination has no room for this managed tag", 409);
      tags.push(tag);
    }
  const taxonomy = { categories, tags };
  const taxonomyChanged =
    JSON.stringify(taxonomy) !==
    JSON.stringify(destination.taxonomy ?? { categories: [], tags: [] });
  if (taxonomyChanged) {
    await db.query(
      "UPDATE projects SET data=jsonb_set(data,'{taxonomy}',$2::jsonb,true),revision=revision+1 WHERE id=$1",
      [destination.id, JSON.stringify(taxonomy)],
    );
  }
  row.data.category = categoryMap.get(row.data.category);
  if (row.data.context.document) {
    const url = new URL(row.data.context.url);
    url.pathname = `/projects/${destination.id}/documents/${row.data.context.document.id}`;
    row.data.context = viewContext(
      { ...row.data.context, url: url.toString() },
      { captureMode: "any" },
    );
  }
  row.data.lastActor = publicActor(actor);
  row.data.lastActivityAt = new Date().toISOString();
  const saved = await db.one(
    "UPDATE threads SET project_id=$2,data=$3,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *",
    [row.id, destination.id, JSON.stringify(row.data)],
  );
  await db.query("UPDATE assets SET project_id=$2 WHERE thread_id=$1", [
    row.id,
    destination.id,
  ]);
  await db.query("UPDATE recordings SET project_id=$2 WHERE thread_id=$1", [
    row.id,
    destination.id,
  ]);
  await db.query("UPDATE documents SET project_id=$2 WHERE id=ANY($1::uuid[])", [
    documents.map((d) => d.id),
    destination.id,
  ]);
  await db.query(
    "UPDATE work_claims SET project_id=$2,revision=revision+1,updated_at=now() WHERE thread_id=$1",
    [row.id, destination.id],
  );
  for (const delegation of delegations)
    await db.query(
      "UPDATE work_delegations SET project_id=$2,category=$3,revision=revision+1,updated_at=now() WHERE id=$1",
      [delegation.id, destination.id, categoryMap.get(delegation.category)],
    );
  const guestLinks = await db.query(
    "UPDATE guest_links SET project_id=$2,revoked_at=coalesce(revoked_at,now()) WHERE thread_id=$1 RETURNING id",
    [row.id, destination.id],
  );
  await db.query("UPDATE github_issue_requests SET project_id=$2 WHERE thread_id=$1", [
    row.id,
    destination.id,
  ]);
  const verifiedIssue = (row.data.externalIssues ?? []).find(
    (issue: any) => issue.verification === "github_verified",
  );
  if (sync || verifiedIssue)
    await db.query(
      `INSERT INTO github_status_sync(thread_id,issue_url,status,error_code) VALUES($1,$2,'conflict','PROJECT_MOVED')
       ON CONFLICT(thread_id) DO UPDATE SET status='conflict',error_code='PROJECT_MOVED',pending_target=NULL,lease_until=NULL,updated_at=now()`,
      [row.id, sync?.issue_url ?? verifiedIssue.url],
    );
  await db.query(
    "DELETE FROM webhook_deliveries WHERE project_id=$1 AND payload->>'threadId'=$2",
    [source.id, row.id],
  );
  await db.query("DELETE FROM export_snapshots WHERE project_id=ANY($1::uuid[])", [
    [source.id, destination.id],
  ]);

  // Historical events follow the content. Lock both streams in stable order,
  // then publish one content-free source removal and a destination refresh.
  for (const projectId of [source.id, destination.id].sort())
    await db.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('feedbacks.events:' || $1::text,0))",
      [projectId],
    );
  const entityIds = [
    row.id,
    ...assets,
    ...documents,
    ...claims,
    ...delegations,
    ...guestLinks,
  ].map((entity) => (typeof entity === "string" ? entity : entity.id));
  await db.query(
    "UPDATE events SET project_id=$2 WHERE project_id=$1 AND (entity_id=ANY($3::text[]) OR data->>'threadId'=$4)",
    [source.id, destination.id, entityIds, row.id],
  );
  await event(db, actor, source.id, row.id, "threads.movedOut", {});
  if (taxonomyChanged)
    await event(db, actor, destination.id, destination.id, "projects.taxonomy.update", {
      categoryCount: categories.length,
      tagCount: tags.length,
    });
  await event(db, actor, destination.id, row.id, "threads.move", {
    revision: saved.revision,
    sourceProjectId: source.id,
  });
  return fullThread(db, actor, saved);
}
