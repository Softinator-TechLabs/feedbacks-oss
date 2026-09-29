import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { test } from "node:test";
import {
  downloadDraftDiagnostics,
  cleanupPrivateDiagnosticArchives,
  PRIVATE_ARCHIVE_CLEANUP_ALARM,
} from "../extension/diagnostics/archive.js";

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

test("private archive cleanup runs after restart and schedules remaining files", async () => {
  const now = Date.now();
  const expired = `feedbacks-diag-export-${now - 2 * 3600_000}-${randomUUID()}.tar.gz`;
  const pending = `feedbacks-diag-export-${now - 10 * 60_000}-${randomUUID()}.tar.gz`;
  const removed: string[] = [];
  const alarms: { name: string; when: number }[] = [];
  const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const oldChrome = Object.getOwnPropertyDescriptor(globalThis, "chrome");
  try {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        storage: {
          getDirectory: async () => ({
            entries: async function* () {
              yield [expired, {}];
              yield [pending, {}];
            },
            removeEntry: async (name: string) => {
              removed.push(name);
            },
          }),
        },
      },
    });
    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      value: {
        alarms: {
          create: async (name: string, options: { when: number }) => {
            alarms.push({ name, when: options.when });
          },
        },
      },
    });
    await cleanupPrivateDiagnosticArchives();
    assert.deepEqual(removed, [expired]);
    assert.equal(alarms[0].name, PRIVATE_ARCHIVE_CLEANUP_ALARM);
    assert.ok(alarms[0].when > now + 45 * 60_000);
    assert.ok(alarms[0].when <= now + 51 * 60_000);
  } finally {
    if (oldNavigator) Object.defineProperty(globalThis, "navigator", oldNavigator);
    else Reflect.deleteProperty(globalThis, "navigator");
    if (oldChrome) Object.defineProperty(globalThis, "chrome", oldChrome);
    else Reflect.deleteProperty(globalThis, "chrome");
  }
});

test("large draft archive without a picker streams through private disk before download", async () => {
  const evidenceId = randomUUID(),
    fileId = randomUUID();
  const bytes = randomBytes(6 * 1024 * 1024);
  const chunks = [
    bytes.subarray(0, 2_097_152),
    bytes.subarray(2_097_152, 4_194_304),
    bytes.subarray(4_194_304),
  ];
  const manifest = {
    schemaVersion: 1,
    id: evidenceId,
    sourceOrigin: "https://example.test",
    startedAt: "2026-09-29T00:00:00.000Z",
    endedAt: "2026-09-29T00:00:01.000Z",
    coverage: {},
    totalBytes: bytes.length,
    files: [
      {
        fileId,
        kind: "body",
        mimeType: "application/octet-stream",
        byteLength: bytes.length,
        sha256: sha(bytes),
        chunks: chunks.map((part, sequence) => ({
          sequence,
          byteLength: part.length,
          sha256: sha(part),
        })),
      },
    ],
  };
  const store = {
    getEvidenceState: async () => ({ manifest }),
    getEvidenceChunk: async (_id: string, _fileId: string, sequence: number) => ({
      bytes: chunks[sequence],
      byteLength: chunks[sequence].length,
      sha256: sha(chunks[sequence]),
    }),
  };
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  const replace = (name: string, value: unknown) => {
    descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value });
  };
  let writes = 0,
    written = 0,
    clicked = false,
    usedFile = false;
  let cleanup: (() => unknown) | undefined;
  const removed: string[] = [];
  let temporaryName = "";
  const root = {
    getFileHandle: async (name: string) => {
      temporaryName = name;
      return {
        createWritable: async () =>
          new WritableStream({
            write(part: Uint8Array) {
              writes++;
              written += part.byteLength;
            },
          }),
        getFile: async () => {
          usedFile = true;
          return new Blob(["disk-backed-file"]);
        },
      };
    },
    removeEntry: async (name: string) => {
      removed.push(name);
    },
  };
  const oldBlob = Response.prototype.blob;
  const oldCreate = URL.createObjectURL;
  const oldRevoke = URL.revokeObjectURL;
  try {
    replace("showSaveFilePicker", undefined);
    replace("navigator", { storage: { getDirectory: async () => root } });
    replace("document", {
      createElement: () => ({
        click() {
          clicked = true;
        },
        set href(_v: string) {},
        set download(_v: string) {},
      }),
    });
    replace("setTimeout", (fn: () => unknown) => {
      cleanup = fn;
      return 1;
    });
    Response.prototype.blob = async () => {
      throw Error("archive was buffered in memory");
    };
    URL.createObjectURL = (file: Blob) => {
      assert.ok(file instanceof Blob);
      return "blob:synthetic-archive";
    };
    URL.revokeObjectURL = () => {};
    await downloadDraftDiagnostics(store, evidenceId);
    assert.equal(clicked, true);
    assert.equal(usedFile, true);
    assert.ok(writes > 1, "compressed archive reached the disk writer in pieces");
    assert.ok(written > 5 * 1024 * 1024, "large incompressible archive was streamed");
    assert.ok(cleanup, "temporary private file has a deferred cleanup");
    cleanup();
    assert.deepEqual(removed, [temporaryName]);
  } finally {
    Response.prototype.blob = oldBlob;
    URL.createObjectURL = oldCreate;
    URL.revokeObjectURL = oldRevoke;
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});

test("large no-picker export without private file storage fails before buffering", async () => {
  const evidenceId = randomUUID();
  const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const oldPicker = Object.getOwnPropertyDescriptor(globalThis, "showSaveFilePicker");
  const oldBlob = Response.prototype.blob;
  try {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { storage: {} },
    });
    Object.defineProperty(globalThis, "showSaveFilePicker", {
      configurable: true,
      value: undefined,
    });
    Response.prototype.blob = async () => {
      throw Error("archive was buffered");
    };
    await assert.rejects(
      downloadDraftDiagnostics(
        {
          getEvidenceState: async () => ({
            manifest: {
              id: evidenceId,
              startedAt: "2026-09-29T00:00:00Z",
              totalBytes: 256 * 1024 * 1024,
              files: [],
            },
          }),
        },
        evidenceId,
      ),
      /cannot stream a large diagnostic archive/i,
    );
  } finally {
    Response.prototype.blob = oldBlob;
    if (oldNavigator) Object.defineProperty(globalThis, "navigator", oldNavigator);
    else Reflect.deleteProperty(globalThis, "navigator");
    if (oldPicker) Object.defineProperty(globalThis, "showSaveFilePicker", oldPicker);
    else Reflect.deleteProperty(globalThis, "showSaveFilePicker");
  }
});

test("failed private stream removes its temporary archive and never starts a download", async () => {
  const evidenceId = randomUUID(),
    fileId = randomUUID();
  const bytes = new TextEncoder().encode("synthetic diagnostic text");
  const manifest = {
    id: evidenceId,
    startedAt: "2026-09-29T00:00:00Z",
    totalBytes: bytes.length,
    files: [
      {
        fileId,
        kind: "dom",
        byteLength: bytes.length,
        sha256: sha(bytes),
        chunks: [{ sequence: 0, byteLength: bytes.length, sha256: sha(bytes) }],
      },
    ],
  };
  const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const oldPicker = Object.getOwnPropertyDescriptor(globalThis, "showSaveFilePicker");
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  let created = "";
  const removed: string[] = [];
  try {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        storage: {
          getDirectory: async () => ({
            getFileHandle: async (name: string) => {
              created = name;
              return { createWritable: async () => new WritableStream() };
            },
            removeEntry: async (name: string) => {
              removed.push(name);
            },
          }),
        },
      },
    });
    Object.defineProperty(globalThis, "showSaveFilePicker", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        createElement: () => {
          throw Error("download must not start");
        },
      },
    });
    await assert.rejects(
      downloadDraftDiagnostics(
        {
          getEvidenceState: async () => ({ manifest }),
          getEvidenceChunk: async () => ({
            bytes: new Uint8Array(bytes.length),
            byteLength: bytes.length,
            sha256: sha(bytes),
          }),
        },
        evidenceId,
      ),
      /checksum/,
    );
    assert.deepEqual(removed, [created]);
  } finally {
    if (oldNavigator) Object.defineProperty(globalThis, "navigator", oldNavigator);
    else Reflect.deleteProperty(globalThis, "navigator");
    if (oldPicker) Object.defineProperty(globalThis, "showSaveFilePicker", oldPicker);
    else Reflect.deleteProperty(globalThis, "showSaveFilePicker");
    if (oldDocument) Object.defineProperty(globalThis, "document", oldDocument);
    else Reflect.deleteProperty(globalThis, "document");
  }
});
