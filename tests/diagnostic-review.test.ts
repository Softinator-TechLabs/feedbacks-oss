import assert from "node:assert/strict";
import { test } from "node:test";
import {
  reviewDefaults,
  updateReviewDefaults,
} from "../extension/review/review-preferences.js";
import { uploadDraftDiagnostics } from "../extension/diagnostics/upload.js";
import {
  accountFingerprint,
  sameDiagnosticBinding,
} from "../extension/diagnostics/identity.js";
import { diagnosticArchiveStream } from "../extension/diagnostics/archive.js";
import { createHash, randomUUID } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const sourceUrl = "https://example.test/page";
function evidence(bytes = new TextEncoder().encode("<script>do not run</script>")) {
  const evidenceId = randomUUID();
  const fileId = randomUUID();
  const startedAt = new Date().toISOString();
  const chunk = { sequence: 0, byteLength: bytes.byteLength, sha256: hash(bytes) };
  const manifest = {
    schemaVersion: 1,
    id: evidenceId,
    sourceOrigin: "https://example.test",
    startedAt,
    endedAt: startedAt,
    totalBytes: bytes.byteLength,
    coverage: {},
    files: [
      {
        fileId,
        kind: "dom",
        mimeType: "text/html",
        byteLength: bytes.byteLength,
        sha256: hash(bytes),
        chunks: [chunk],
      },
    ],
  };
  const calls: string[] = [];
  const store = {
    getEvidenceState: async () => ({ manifest, sourceUrl }),
    getEvidenceChunk: async () => ({
      bytes,
      byteLength: bytes.byteLength,
      sha256: hash(bytes),
    }),
    deleteEvidence: async (id: string) => {
      calls.push(`delete:${id}`);
    },
  };
  const draft: any = {
    server: "https://feedbacks.test",
    thread: { id: randomUUID(), revision: 1 },
    diagnosticEvidence: { evidenceId },
    evidenceOwnerIdentity: "owner",
    includeDiagnostics: true,
  };
  return { bytes, manifest, store, calls, draft };
}

test("new screenshot reviews include diagnostics unless Settings disables them", () => {
  assert.equal(reviewDefaults().includeDiagnostics, true);
  assert.equal(
    updateReviewDefaults({}, { includeDiagnostics: false }).includeDiagnostics,
    false,
  );
});

test("account binding follows the user across a new pairing key", async () => {
  const userId = randomUUID();
  const oldKey = { id: randomUUID(), token: "first-token", userId };
  const replacement = { id: randomUUID(), token: "second-token", userId };
  assert.equal(await accountFingerprint(oldKey), await accountFingerprint(replacement));
  assert.notEqual(
    await accountFingerprint(replacement),
    await accountFingerprint({ ...replacement, userId: randomUUID() }),
  );
  assert.notEqual(
    await accountFingerprint(oldKey, { tokenOnly: true }),
    await accountFingerprint(replacement, { tokenOnly: true }),
  );
});

test("raw history belongs to the exact review context and user", () => {
  const bound = {
    server: "https://feedbacks.test",
    projectId: "project-a",
    reviewId: "review-a",
    ownerIdentity: "user:one",
  };
  assert.equal(sameDiagnosticBinding(bound, { ...bound }), true);
  for (const changed of [
    { projectId: "project-b" },
    { reviewId: "review-b" },
    { ownerIdentity: "user:two" },
    { server: "https://other.test" },
  ])
    assert.equal(sameDiagnosticBinding(bound, { ...bound, ...changed }), false);
  assert.equal(sameDiagnosticBinding(null, bound), false);
});

test("unchecked review uploads no chunks and deletes local evidence", async () => {
  const calls: string[] = [];
  const draft: any = {
    includeDiagnostics: false,
    diagnosticEvidence: { evidenceId: "local" },
  };
  await uploadDraftDiagnostics({
    draft,
    accountIdentity: async () => "same",
    authenticated: async (operation: string) => {
      calls.push(operation);
      throw Error("unexpected");
    },
    store: {
      deleteEvidence: async (id: string) => {
        calls.push(`delete:${id}`);
      },
    },
    save: async () => {},
  });
  assert.deepEqual(calls, ["delete:local"]);
});

test("failed chunk retains local bytes and stable upload identity for retry", async () => {
  const f = evidence();
  let fail = true;
  const uploads: any[] = [];
  const authenticated = async (operation: string, input: any) => {
    uploads.push({ operation, input });
    if (operation === "diagnostics.putChunk" && fail) throw Error("offline");
    if (operation === "diagnostics.finalize") return { thread: f.draft.thread };
    return {};
  };
  const args = {
    draft: f.draft,
    accountIdentity: async () => "owner",
    authenticated,
    store: f.store,
    save: async () => {},
  };
  await assert.rejects(uploadDraftDiagnostics(args), /offline/);
  assert.deepEqual(f.calls, []);
  const firstId = f.draft.diagnosticUpload.evidenceId;
  fail = false;
  await uploadDraftDiagnostics(args);
  assert.equal(f.draft.diagnosticUpload.evidenceId, firstId);
  assert.equal(
    uploads.filter((item) => item.operation === "diagnostics.begin").length,
    2,
  );
  assert.deepEqual(f.calls, [`delete:${f.manifest.id}`]);
});

test("expired pending upload rotates server identity and keeps the same thread", async () => {
  const f = evidence();
  const originalThread = f.draft.thread.id;
  f.draft.diagnosticUpload = {
    evidenceId: randomUUID(),
    beginKey: randomUUID(),
    finalizeKey: randomUUID(),
    startedAt: new Date(Date.now() - 25 * 3600_000).toISOString(),
  };
  const oldId = f.draft.diagnosticUpload.evidenceId;
  const calls: any[] = [];
  await uploadDraftDiagnostics({
    draft: f.draft,
    accountIdentity: async () => "owner",
    store: f.store,
    save: async () => {},
    authenticated: async (operation: string, input: any) => {
      calls.push({ operation, input });
      return operation === "diagnostics.finalize" ? { thread: f.draft.thread } : {};
    },
  });
  assert.notEqual(calls[0].input.evidenceId, oldId);
  assert.equal(calls[0].input.threadId, originalThread);
  assert.equal(calls.at(-1).input.manifest.id, calls[0].input.evidenceId);
});

test("server expiry during chunk upload prepares a new retry without losing local bytes", async () => {
  const f = evidence();
  await assert.rejects(
    uploadDraftDiagnostics({
      draft: f.draft,
      accountIdentity: async () => "owner",
      store: f.store,
      save: async () => {},
      authenticated: async (operation: string) => {
        if (operation === "diagnostics.putChunk")
          throw Object.assign(Error("Diagnostic upload is no longer pending"), {
            code: "CONFLICT",
          });
        return {};
      },
    }),
    /Retry Send/,
  );
  assert.notEqual(f.draft.diagnosticUpload.evidenceId, f.manifest.id);
  assert.deepEqual(f.calls, []);
});

test("another account cannot upload the captured artifact", async () => {
  const f = evidence();
  await assert.rejects(
    uploadDraftDiagnostics({
      draft: f.draft,
      accountIdentity: async () => "different",
      store: f.store,
      save: async () => {},
      authenticated: async () => {
        throw Error("unexpected");
      },
    }),
    /account used for this capture/,
  );
  assert.deepEqual(f.calls, []);
});

test("local tar.gz contains exact source bytes and manifest", async () => {
  const f = evidence(new TextEncoder().encode("<script>large & raw</script>"));
  const archive = await diagnosticArchiveStream(f.store, f.manifest.id);
  assert.match(archive.filename, /\.tar\.gz$/);
  const compressed = new Uint8Array(await new Response(archive.stream).arrayBuffer());
  const tar = gunzipSync(compressed);
  const listing = execFileSync("tar", ["-tzf", "-"], { input: compressed }).toString();
  assert.match(listing, /manifest\.json/);
  assert.match(listing, new RegExp(f.manifest.files[0].fileId));
  assert.ok(tar.includes(Buffer.from("manifest.json")));
  assert.ok(tar.includes(Buffer.from(f.bytes)));
});
