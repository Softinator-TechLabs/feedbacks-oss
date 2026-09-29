import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { materializeDiagnostics } from "../src/cli/diagnostic-materialize.js";
import { mcpServer } from "../src/server/mcp.js";
import { runAgentTool } from "../src/shared/agent-workflow.js";
import { apiClient } from "../src/cli/client.js";
import { DomainError } from "../src/server/errors.js";

const sha = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const evidenceId = randomUUID();
const threadId = randomUUID();
const projectId = randomUUID();

function fixture() {
  const domId = randomUUID(),
    bodyId = randomUUID();
  const dom = Buffer.from(
    `<html>authorization=Bearer fake-test-token\n${"é".repeat(2_700_000)}</html>`,
  );
  const body = Buffer.from([0, 255, 34, 10, 128, 0, 17]);
  const parts = [
    dom.subarray(0, 2_097_152),
    dom.subarray(2_097_152, 4_194_304),
    dom.subarray(4_194_304),
  ];
  const files = [
    {
      fileId: domId,
      kind: "dom",
      mimeType: "text/html",
      byteLength: dom.length,
      sha256: sha(dom),
      chunks: parts.map((data, sequence) => ({
        sequence,
        byteLength: data.length,
        sha256: sha(data),
      })),
    },
    {
      fileId: bodyId,
      kind: "body",
      mimeType: "application/octet-stream",
      byteLength: body.length,
      sha256: sha(body),
      chunks: [{ sequence: 0, byteLength: body.length, sha256: sha(body) }],
    },
  ];
  const coverage = Object.fromEntries(
    [
      "dom",
      "console",
      "network",
      "body",
      "storage",
      "environment",
      "performance",
      "coverage",
    ].map((kind) => [
      kind,
      kind === "dom"
        ? { status: "complete", observedCount: 1, capturedBytes: dom.length, reasons: [] }
        : {
            status: "unavailable",
            observedCount: 0,
            capturedBytes: 0,
            reasons: ["not_captured"],
          },
    ]),
  );
  const evidence = {
    id: evidenceId,
    threadId,
    projectId,
    status: "complete",
    startedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    totalBytes: dom.length + body.length,
    fileCount: 2,
    coverage: Object.fromEntries(
      Object.entries(coverage).map(([kind, value]: any) => [kind, value.status]),
    ),
  };
  const execute = async (name: string, input: any) => {
    assert.equal(name, "diagnostics.describe");
    assert.equal(input.evidenceId, evidenceId);
    return {
      evidence,
      coverage,
      files: files.slice(input.offset, input.offset + input.limit),
      total: 2,
      nextOffset: null,
    };
  };
  const download = async (id: string, fileId: string, sequence: number) => {
    assert.equal(id, evidenceId);
    if (fileId === domId) return Buffer.from(parts[sequence]);
    if (fileId === bodyId) return Buffer.from(body);
    throw Error("Unexpected file");
  };
  return { files, dom, body, execute, download, evidence, coverage };
}

test("ordinary overview stays small and names scoped follow ups", async () => {
  const f = fixture();
  const thread: any = {
    id: threadId,
    projectId,
    revision: 1,
    body: "Issue",
    context: { url: "https://example.test" },
    assets: [],
    replies: [],
    work: { state: "open", history: [] },
    response: { state: "unanswered" },
    annotationStates: {},
    externalIssues: [],
    fixEvidence: [],
    diagnosticEvidence: {
      count: 1,
      latest: [f.evidence],
      followUp: ["diagnostics.list", "diagnostics.describe", "diagnostics.read"],
    },
  };
  const overview = await runAgentTool(async () => thread, "thread", { threadId });
  assert.equal(overview.diagnosticEvidence.count, 1);
  assert.deepEqual(overview.diagnosticEvidence.followUp, [
    "diagnostics.list",
    "diagnostics.describe",
    "diagnostics.read",
  ]);
  assert.equal("rawDom" in overview, false);
  assert.ok(JSON.stringify(overview).length < 3000);
  assert.equal("rawDom" in thread, false);
});

test("local materializer verifies chunks and whole files while preserving raw text and binary", async () => {
  const f = fixture();
  const baseDirectory = await mkdtemp(join(tmpdir(), "feedbacks-diagnostic-test-"));
  try {
    const result = await materializeDiagnostics(f.execute, f.download, {
      evidenceId,
      baseDirectory,
    });
    assert.equal((await stat(result.directory)).mode & 0o777, 0o700);
    assert.deepEqual(result.coverage, f.coverage);
    assert.equal(result.files.length, 2);
    const domPath = result.files.find((file: any) => file.kind === "dom")!.path;
    const bodyPath = result.files.find((file: any) => file.kind === "body")!.path;
    assert.deepEqual(await readFile(domPath), f.dom);
    assert.deepEqual(await readFile(bodyPath), f.body);
    assert.equal((await stat(domPath)).mode & 0o777, 0o600);
    assert.equal((await stat(bodyPath)).mode & 0o777, 0o600);
  } finally {
    await rm(baseDirectory, { recursive: true, force: true });
  }
});

test("materializer rejects changed bytes and removes its temporary directory", async () => {
  const f = fixture();
  const baseDirectory = await mkdtemp(join(tmpdir(), "feedbacks-diagnostic-test-"));
  try {
    await assert.rejects(
      materializeDiagnostics(
        f.execute,
        async (id, fileId, sequence) => {
          const bytes = await f.download(id, fileId, sequence);
          return fileId === f.files[1].fileId ? Buffer.from("altered") : bytes;
        },
        { evidenceId, baseDirectory },
      ),
      /integrity|length|checksum|hash/i,
    );
    assert.deepEqual(await readdir(baseDirectory), []);
  } finally {
    await rm(baseDirectory, { recursive: true, force: true });
  }
});

test("materializer rejects a cross-page file ID collision before writing", async () => {
  const f = fixture();
  const baseDirectory = await mkdtemp(join(tmpdir(), "feedbacks-diagnostic-test-"));
  try {
    await assert.rejects(
      materializeDiagnostics(
        async (name, input: any) => {
          const result = await f.execute(name, { ...input, offset: 0 });
          return input.offset === 0
            ? { ...result, files: [f.files[0]], nextOffset: 1 }
            : { ...result, files: [f.files[0]], nextOffset: null };
        },
        f.download,
        { evidenceId, baseDirectory },
      ),
      /duplicate|collision/i,
    );
    assert.deepEqual(await readdir(baseDirectory), []);
  } finally {
    await rm(baseDirectory, { recursive: true, force: true });
  }
});

test("materialization is local only; full HTTP profile retains bounded operations", async () => {
  for (const local of [false, true]) {
    const server = mcpServer(
      async () => ({}),
      "full",
      local
        ? {
            materializeDiagnostics: async () => ({
              directory: "/tmp/diagnostic",
              evidenceId,
              coverage: {},
              files: [],
            }),
          }
        : {},
    );
    const client = new Client({ name: "diagnostic-test", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(a);
      await client.connect(b);
      const names = (await client.listTools()).tools.map((tool) => tool.name);
      assert.equal(names.includes("feedbacks_diagnostics_materialize"), local);
      assert.ok(names.includes("diagnostics.describe"));
      assert.ok(names.includes("diagnostics.read"));
    } finally {
      await client.close();
      await server.close();
    }
  }
});

test("compact stdio keeps its small tool list while full stdio offers materialization", async () => {
  for (const profile of ["compact", "full"] as const) {
    const server = mcpServer(async () => ({}), profile, {
      materializeDiagnostics: async () => ({
        directory: "/tmp/diagnostic",
        evidenceId,
        coverage: {},
        files: [],
      }),
    });
    const client = new Client({ name: "diagnostic-profile-test", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(a);
      await client.connect(b);
      const names = (await client.listTools()).tools.map((tool) => tool.name);
      assert.equal(
        names.includes("feedbacks_diagnostics_materialize"),
        profile === "full",
      );
    } finally {
      await client.close();
      await server.close();
    }
  }
});

test("full MCP diagnostic reads preserve scope denial", async () => {
  const server = mcpServer(async (name) => {
    if (name.startsWith("diagnostics."))
      throw new DomainError("FORBIDDEN", "Diagnostic scope required", 403);
    return {};
  }, "full");
  const client = new Client({ name: "diagnostic-scope-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(a);
    await client.connect(b);
    const result = await client.callTool({
      name: "diagnostics.describe",
      arguments: { evidenceId },
    });
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result.content), /FORBIDDEN/);
  } finally {
    await client.close();
    await server.close();
  }
});

test("CLI chunk download uses bearer, refuses redirects and enforces 2 MiB", async () => {
  const bytes = Buffer.from([0, 255, 1]);
  let mode: "ok" | "chunked" | "redirect" | "oversize" = "ok";
  const server = createServer((req, res) => {
    assert.equal(req.url, `/api/diagnostics/${evidenceId}/files/${threadId}/chunks/0`);
    assert.equal(req.headers.authorization, "Bearer synthetic-diagnostic-token");
    if (mode === "redirect") {
      res.writeHead(302, { Location: "https://example.test/leak" }).end();
    } else if (mode === "oversize") {
      res
        .writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Content-Length": "2097153",
        })
        .end();
    } else if (mode === "chunked") {
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      res.write(bytes.subarray(0, 1));
      res.end(bytes.subarray(1));
    } else {
      res
        .writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Content-Length": String(bytes.length),
        })
        .end(bytes);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const priorUrl = process.env.FEEDBACKS_URL,
    priorToken = process.env.FEEDBACKS_TOKEN;
  process.env.FEEDBACKS_URL = `http://127.0.0.1:${address.port}`;
  process.env.FEEDBACKS_TOKEN = "synthetic-diagnostic-token";
  try {
    const client = await apiClient();
    assert.deepEqual(
      await client.downloadDiagnosticChunk(evidenceId, threadId, 0),
      bytes,
    );
    mode = "chunked";
    assert.deepEqual(
      await client.downloadDiagnosticChunk(evidenceId, threadId, 0),
      bytes,
    );
    mode = "redirect";
    await assert.rejects(client.downloadDiagnosticChunk(evidenceId, threadId, 0));
    mode = "oversize";
    await assert.rejects(
      client.downloadDiagnosticChunk(evidenceId, threadId, 0),
      /2 MiB/,
    );
  } finally {
    if (priorUrl === undefined) delete process.env.FEEDBACKS_URL;
    else process.env.FEEDBACKS_URL = priorUrl;
    if (priorToken === undefined) delete process.env.FEEDBACKS_TOKEN;
    else process.env.FEEDBACKS_TOKEN = priorToken;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
