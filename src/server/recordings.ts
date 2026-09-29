import { randomUUID } from "node:crypto";
import type { Database } from "./db.js";
import type { Actor } from "../shared/contracts.js";
import type { AssetStore } from "./assets.js";
import type { Config } from "./config.js";
import { event } from "./access.js";
import {
  checkRevision,
  fullThread,
  remember,
  retry,
  saveThread,
  threadRow,
} from "./feedback.js";
import { fail } from "./errors.js";
import {
  redactRecording,
  redactEvidenceValue,
  recordingSchema,
  type Recording,
} from "../shared/recordings.js";

function summary(row: any) {
  return {
    id: row.id,
    projectId: row.project_id,
    threadId: row.thread_id,
    ...row.summary,
    createdAt: new Date(row.created_at).toISOString(),
  };
}
async function recordingRow(db: Database, actor: Actor, recordingId: string) {
  const row = await db.one("SELECT * FROM recordings WHERE id=$1", [recordingId]);
  if (!row) fail("NOT_FOUND", "Recording not found", 404);
  await threadRow(db, actor, row.thread_id);
  return row;
}
async function checkLink(db: Database, thread: any, recording: Recording) {
  const source = thread.data.context?.url;
  if (!source || new URL(source).origin !== new URL(recording.url).origin)
    fail("VALIDATION", "Recording origin must match the feedback website", 400);
  if (!recording.video) return;
  const asset = await db.one(
    "SELECT id FROM assets WHERE id=$1 AND thread_id=$2 AND project_id=$3 AND status='validated' AND data->>'contentType'='video/webm'",
    [recording.video.assetId, thread.id, thread.project_id],
  );
  if (!asset)
    fail("VALIDATION", "Video must be a validated asset on this feedback thread");
}
export async function recordingPreflight(db: Database, actor: Actor, input: any) {
  const thread = await threadRow(db, actor, input.threadId, "write");
  const prior = await retry(db, actor, "recordings.upload", input);
  if (prior) {
    const row = await recordingRow(db, actor, prior);
    return {
      projectId: thread.project_id as string,
      prior: { recording: summary(row), thread: await fullThread(db, actor, thread) },
    };
  }
  checkRevision(thread, input.revision);
  await checkLink(db, thread, input.recording);
  const count = await db.one(
    "SELECT count(*)::integer AS total FROM recordings WHERE thread_id=$1",
    [thread.id],
  );
  if (count.total >= 100)
    fail("LIMIT_REACHED", "Feedback already has 100 recordings", 409);
  if (await db.one("SELECT id FROM recordings WHERE id=$1", [input.recording.id]))
    fail("CONFLICT", "Recording ID already exists", 409);
  return { projectId: thread.project_id as string, prior: null };
}
export async function commitRecording(
  db: Database,
  actor: Actor,
  input: any,
  prepared: {
    projectId: string;
    objectKey: string;
    sanitized: Recording;
    bytes: number;
  },
) {
  const thread = await threadRow(db, actor, input.threadId, "write", true);
  const prior = await retry(db, actor, "recordings.upload", input);
  if (prior) {
    const row = await recordingRow(db, actor, prior);
    return {
      committed: false,
      result: { recording: summary(row), thread: await fullThread(db, actor, thread) },
    };
  }
  checkRevision(thread, input.revision);
  if (thread.project_id !== prepared.projectId)
    fail("CONFLICT", "Feedback changed; reload before retrying", 409);
  await checkLink(db, thread, input.recording);
  const count = await db.one(
    "SELECT count(*)::integer AS total FROM recordings WHERE thread_id=$1",
    [thread.id],
  );
  if (count.total >= 100)
    fail("LIMIT_REACHED", "Feedback already has 100 recordings", 409);
  if (await db.one("SELECT id FROM recordings WHERE id=$1", [input.recording.id]))
    fail("CONFLICT", "Recording ID already exists", 409);
  const recording = prepared.sanitized;
  const publicSummary = {
    startedAt: recording.startedAt,
    durationMs: recording.durationMs,
    mode: recording.mode,
    url: recording.url,
    privacy: recording.privacy,
    coverage: recording.coverage,
    eventCount: recording.events.length,
    ...(recording.video ? { video: recording.video } : {}),
  };
  const rows = await db.query(
    "INSERT INTO recordings(id,project_id,thread_id,object_key,summary,byte_size) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
    [
      recording.id,
      thread.project_id,
      thread.id,
      prepared.objectKey,
      JSON.stringify(publicSummary),
      prepared.bytes,
    ],
  );
  await remember(db, actor, "recordings.upload", input, recording.id);
  await event(db, actor, thread.project_id, recording.id, "recording.created", {
    threadId: thread.id,
  });
  const saved = await saveThread(db, actor, thread, "thread.recording");
  return {
    committed: true,
    result: { recording: summary(rows[0]), thread: await fullThread(db, actor, saved) },
  };
}
export function prepareRecording(input: any, projectId: string, config: Config) {
  const sanitized = redactRecording(input.recording as Recording);
  // Sanitization must preserve the shared schema and deterministic retry identity.
  const checked = recordingSchema.safeParse(sanitized);
  if (!checked.success) fail("VALIDATION", "Recording could not be safely redacted");
  const output = Buffer.from(JSON.stringify(checked.data), "utf8");
  return {
    projectId,
    sanitized: checked.data,
    output,
    bytes: output.length,
    objectKey: `feedbacks/${config.production ? "production" : "development"}/organizations/${config.organizationId}/projects/${projectId}/feedback/${input.threadId}/recordings/${randomUUID()}.json`,
  };
}
export async function recordingRead(
  db: Database,
  actor: Actor,
  store: AssetStore,
  name: string,
  input: any,
) {
  if (name === "recordings.list") {
    await threadRow(db, actor, input.threadId);
    const rows = await db.query(
      "SELECT id,project_id,thread_id,summary,created_at FROM recordings WHERE thread_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100",
      [input.threadId],
    );
    return { items: rows.map(summary) };
  }
  const row = await recordingRow(db, actor, input.recordingId);
  if (
    name === "recordings.get" ||
    name === "recordings.events" ||
    name === "recordings.export"
  ) {
    let recording: Recording;
    try {
      recording = recordingSchema.parse(
        JSON.parse((await store.get(row.object_key)).toString("utf8")),
      );
    } catch {
      fail("EVIDENCE_UNAVAILABLE", "Private recording is temporarily unavailable", 503);
    }
    if (name === "recordings.get") return { recording };
    if (name === "recordings.events") {
      const filtered = recording.events.filter(
        (item) =>
          (!input.type || item.type === input.type) &&
          (input.fromMs === undefined || item.atMs >= input.fromMs) &&
          (input.toMs === undefined || item.atMs <= input.toMs),
      );
      const items = filtered.slice(input.offset, input.offset + input.limit);
      const nextOffset =
        input.offset + items.length < filtered.length
          ? input.offset + items.length
          : null;
      return { items, nextOffset, total: filtered.length };
    }
    const thread = await threadRow(db, actor, row.thread_id);
    const replies = await db.query(
      "SELECT id,data,created_at FROM replies WHERE thread_id=$1 ORDER BY created_at,id LIMIT 501",
      [thread.id],
    );
    const frames = await db.query(
      "SELECT id,data FROM assets WHERE thread_id=$1 AND project_id=$2 AND status='validated' AND NOT (data ? 'supersededBy') AND data->>'contentType' LIKE 'image/%' AND data->'recordingFrame'->>'recordingId'=$3 ORDER BY data->>'createdAt',id LIMIT 101",
      [thread.id, thread.project_id, recording.id],
    );
    return {
      recording,
      thread: {
        id: thread.id,
        revision: thread.revision,
        projectId: thread.project_id,
        body: redactEvidenceValue(thread.data.body),
        context: redactEvidenceValue(thread.data.context),
        createdAt: new Date(thread.created_at).toISOString(),
        discussionTruncated: replies.length > 500,
        framesTruncated: frames.length > 100,
        frames: frames.slice(0, 100).map((frame) => ({
          id: frame.id,
          contentType: frame.data.contentType,
          ...(frame.data.filename ? { filename: frame.data.filename } : {}),
          recordingFrame: frame.data.recordingFrame,
        })),
        discussion: replies.slice(0, 500).map((reply) => ({
          id: reply.id,
          body: redactEvidenceValue(reply.data.body),
          author: reply.data.author,
          createdAt: new Date(reply.created_at).toISOString(),
        })),
      },
    };
  }
  fail("NOT_FOUND", "Unknown recording operation", 404);
}
