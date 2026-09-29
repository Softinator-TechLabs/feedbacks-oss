import { createSha256Hasher } from "./sha256.js";

function encodeBase64(bytes) {
  let value = "";
  for (let offset = 0; offset < bytes.length; offset += 32768)
    value += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return btoa(value);
}

function rotateUpload(draft) {
  draft.diagnosticUpload = {
    evidenceId: crypto.randomUUID(),
    beginKey: crypto.randomUUID(),
    finalizeKey: crypto.randomUUID(),
    startedAt: new Date().toISOString(),
  };
}

export async function uploadDraftDiagnostics({
  draft,
  accountIdentity,
  authenticated,
  store,
  save,
  progress = () => {},
}) {
  const localId = draft.diagnosticEvidence?.evidenceId;
  if (!localId) return;
  if (!draft.includeDiagnostics) {
    await store.deleteEvidence(localId);
    return;
  }
  const currentIdentity = await accountIdentity(draft.server);
  if (!currentIdentity || draft.evidenceOwnerIdentity !== currentIdentity)
    throw Error(
      "Connect the account used for this capture before sending its diagnostics.",
    );
  const state = await store.getEvidenceState(localId);
  if (!state?.manifest)
    throw Error(
      "Local screenshot diagnostics are missing. Discard this draft and capture again.",
    );
  if (!draft.diagnosticUpload) {
    rotateUpload(draft);
    draft.diagnosticUpload.evidenceId = localId;
    await save(draft);
  }
  const attempt = draft.diagnosticUpload;
  if (Date.now() - Date.parse(attempt.startedAt) > 23 * 60 * 60 * 1000) {
    rotateUpload(draft);
    await save(draft);
  }
  const upload = draft.diagnosticUpload;
  const manifest = { ...state.manifest, id: upload.evidenceId };
  try {
    const begin = async () =>
      authenticated(
        "diagnostics.begin",
        {
          threadId: draft.thread.id,
          revision: draft.thread.revision,
          evidenceId: upload.evidenceId,
          idempotencyKey: upload.beginKey,
          sourceUrl: state.sourceUrl,
          startedAt: manifest.startedAt,
        },
        draft.server,
      );
    try {
      await begin();
    } catch (error) {
      if (error.code !== "CONFLICT") throw error;
      draft.thread = await authenticated(
        "threads.get",
        { threadId: draft.thread.id },
        draft.server,
      );
      await save(draft);
      await begin();
    }
    let completed = 0;
    const total = manifest.files.reduce((sum, file) => sum + file.chunks.length, 0);
    for (const file of manifest.files) {
      const digest = createSha256Hasher();
      for (const chunk of file.chunks) {
        const local = await store.getEvidenceChunk(localId, file.fileId, chunk.sequence);
        if (
          !local ||
          local.byteLength !== chunk.byteLength ||
          local.sha256 !== chunk.sha256
        )
          throw Error(
            `Local diagnostic chunk ${file.fileId}/${chunk.sequence} is missing or changed.`,
          );
        const check = createSha256Hasher();
        check.update(local.bytes);
        if (check.hexDigest() !== chunk.sha256)
          throw Error(
            `Local diagnostic chunk ${file.fileId}/${chunk.sequence} failed its checksum.`,
          );
        digest.update(local.bytes);
        await authenticated(
          "diagnostics.putChunk",
          {
            evidenceId: upload.evidenceId,
            fileId: file.fileId,
            sequence: chunk.sequence,
            sha256: chunk.sha256,
            contentBase64: encodeBase64(local.bytes),
          },
          draft.server,
        );
        completed++;
        progress(completed, total);
      }
      if (digest.hexDigest() !== file.sha256)
        throw Error(`Local diagnostic file ${file.fileId} failed its checksum.`);
    }
    const result = await authenticated(
      "diagnostics.finalize",
      { evidenceId: upload.evidenceId, manifest, idempotencyKey: upload.finalizeKey },
      draft.server,
    );
    draft.thread = result.thread;
    draft.diagnosticUploaded = true;
    await save(draft);
    await store.deleteEvidence(localId);
  } catch (error) {
    if (
      error.code === "CONFLICT" &&
      /expired|no longer pending|identity changed/i.test(error.message)
    ) {
      rotateUpload(draft);
      await save(draft);
      throw Error(
        "The diagnostic upload expired. Retry Send to continue on the same thread.",
      );
    }
    throw error;
  }
}
