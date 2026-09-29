const DATABASE = "feedbacks-screenshot-evidence";
const CHUNK_BYTES = 2_097_152;
const MAX_BYTES = 268_435_456;

export function createDiagnosticEvidenceStore({
  indexedDB = globalThis.indexedDB,
  keyRange = globalThis.IDBKeyRange,
} = {}) {
  let opening;
  async function database() {
    if (!opening)
      opening = new Promise((resolve, reject) => {
        if (!indexedDB)
          return reject(Error("Screenshot evidence storage is unavailable"));
        const request = indexedDB.open(DATABASE, 1);
        request.onupgradeneeded = () => {
          request.result.createObjectStore("state");
          request.result.createObjectStore("chunks");
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(Error("Screenshot evidence storage is blocked"));
      });
    return opening;
  }
  const digest = async (bytes) =>
    [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  async function run(stores, mode, action) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      let result;
      let failure;
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () =>
        reject(failure || tx.error || Error("Screenshot evidence storage failed"));
      const done = (value) => {
        result = value;
      };
      const fail = (error) => {
        failure = error;
        tx.abort();
      };
      try {
        action(tx, done, fail);
      } catch (error) {
        fail(error);
      }
    });
  }
  const selector = (evidenceId, fileId, sequence) => [evidenceId, fileId, sequence];
  const range = (evidenceId) => keyRange.bound([evidenceId], [evidenceId, "\uffff"]);
  return {
    async putEvidenceChunk(evidenceId, fileId, sequence, bytes) {
      if (
        !(bytes instanceof Uint8Array) ||
        !bytes.byteLength ||
        bytes.byteLength > CHUNK_BYTES ||
        !Number.isSafeInteger(sequence) ||
        sequence < 0
      )
        throw RangeError("Diagnostic chunk must contain at most 2 MiB");
      const sha256 = await digest(bytes);
      return run(["state", "chunks"], "readwrite", (tx, done, fail) => {
        const key = selector(evidenceId, fileId, sequence);
        const chunks = tx.objectStore("chunks");
        const request = chunks.get(key);
        request.onsuccess = () => {
          const previous = request.result;
          if (previous) {
            if (previous.sha256 !== sha256 || previous.byteLength !== bytes.byteLength)
              return fail(Error("Diagnostic chunk retry differs"));
            return done({ sequence, sha256, byteLength: bytes.byteLength });
          }
          const states = tx.objectStore("state");
          const current = states.get(evidenceId);
          current.onsuccess = () => {
            const state = current.result || {};
            if ((state.totalBytes || 0) + bytes.byteLength > MAX_BYTES)
              return fail(RangeError("Screenshot evidence reached 256 MiB"));
            states.put(
              { ...state, totalBytes: (state.totalBytes || 0) + bytes.byteLength },
              evidenceId,
            );
            chunks.put(
              { blob: new Blob([bytes]), sha256, byteLength: bytes.byteLength },
              key,
            );
            done({ sequence, sha256, byteLength: bytes.byteLength });
          };
        };
      });
    },
    async getEvidenceChunk(evidenceId, fileId, sequence) {
      const value = await run(["chunks"], "readonly", (tx, done) => {
        const request = tx
          .objectStore("chunks")
          .get(selector(evidenceId, fileId, sequence));
        request.onsuccess = () => done(request.result || null);
      });
      if (!value) return null;
      return {
        bytes: new Uint8Array(await value.blob.arrayBuffer()),
        sha256: value.sha256,
        byteLength: value.byteLength,
      };
    },
    async putEvidenceState(evidenceId, value) {
      return run(["state"], "readwrite", (tx, done) => {
        const states = tx.objectStore("state");
        const request = states.get(evidenceId);
        request.onsuccess = () => {
          states.put(
            { ...value, totalBytes: request.result?.totalBytes || value.totalBytes || 0 },
            evidenceId,
          );
          done(undefined);
        };
      });
    },
    async getEvidenceState(evidenceId) {
      return run(["state"], "readonly", (tx, done) => {
        const request = tx.objectStore("state").get(evidenceId);
        request.onsuccess = () => done(request.result || null);
      });
    },
    async listEvidenceChunks(evidenceId) {
      return run(["chunks"], "readonly", (tx, done) => {
        const items = [];
        const request = tx.objectStore("chunks").openCursor(range(evidenceId));
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return done(items);
          items.push({
            fileId: cursor.key[1],
            sequence: cursor.key[2],
            sha256: cursor.value.sha256,
            byteLength: cursor.value.byteLength,
          });
          cursor.continue();
        };
      });
    },
    async deleteEvidence(evidenceId) {
      return run(["state", "chunks"], "readwrite", (tx, done) => {
        tx.objectStore("state").delete(evidenceId);
        const request = tx.objectStore("chunks").openKeyCursor(range(evidenceId));
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return done(undefined);
          tx.objectStore("chunks").delete(cursor.primaryKey);
          cursor.continue();
        };
      });
    },
  };
}
