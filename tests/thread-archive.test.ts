import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { createServer } from "node:http";
import { once } from "node:events";
import express from "express";
import { prepareThreadArchive, threadTarEntries } from "../src/server/thread-archive.js";
import { registerThreadArchiveRoutes } from "../src/server/http/thread-archive-routes.js";

test("portable thread archive includes discussion, every recording channel and all asset revisions", async () => {
  const threadId = randomUUID();
  const projectId = randomUUID();
  const recordingId = randomUUID();
  const videoId = randomUUID();
  const screenshotId = randomUUID();
  const revisionId = randomUUID();
  const documentId = randomUUID();
  const assets = [videoId, screenshotId, revisionId].map((id, index) => ({
    id,
    object_key: `private/${id}`,
    data: { contentType: index === 0 ? "video/webm" : "image/webp" },
  }));
  const thread = {
    id: threadId,
    projectId,
    body: "Reproduce the problem",
    context: {
      url: "https://example.test/page",
      viewport: { width: 1200, height: 800 },
      document: { id: documentId },
    },
    replies: [{ body: "Discussion reply" }],
    annotations: [{ id: "point-1", body: "Broken button" }],
  };
  const events = ["activity", "console", "network", "performance", "replay"].map(
    (type, seq) => ({ seq, atMs: seq * 100, type, data: { label: type } }),
  );
  const operations = {
    config: { appOrigin: "https://feedbacks.test" },
    async executeOperation(_actor: unknown, name: string, input: any) {
      if (name === "threads.get") return thread;
      if (name === "recordings.list") return { items: [{ id: recordingId }] };
      if (name === "documents.get")
        return { id: documentId, projectId, name: "Original paper", kind: "pdf" };
      if (name === "recordings.export")
        return {
          thread: { id: threadId },
          recording: {
            id: recordingId,
            mode: "video",
            durationMs: 1000,
            environment: { browser: "Chrome" },
            coverage: [{ channel: "network", status: "complete" }],
            events,
            video: { assetId: videoId, offsetMs: 0 },
          },
        };
      if (name === "assets.get")
        return {
          id: input.assetId,
          threadId,
          projectId,
          contentType: input.assetId === videoId ? "video/webm" : "image/webp",
          ...(input.assetId === revisionId ? { baseAssetId: screenshotId } : {}),
        };
      throw Error(`Unexpected operation ${name}`);
    },
  };
  const database = {
    async one() {
      return { object_key: `private/${documentId}`, data: { kind: "pdf" } };
    },
    async query(sql: string) {
      return sql.includes("FROM assets") ? assets : [];
    },
  };
  const store = {
    async get(key: string) {
      return Buffer.from(`binary:${key}`);
    },
  };
  const archive = await prepareThreadArchive(
    database as any,
    store as any,
    operations as any,
    {} as any,
    threadId,
  );
  try {
    const names = archive.files.map((file) => file.path);
    assert.ok(names.includes("thread.json"));
    assert.ok(names.includes(`documents/${documentId}.pdf`));
    assert.ok(names.includes(`recordings/${recordingId}/timeline.jsonl`));
    for (const channel of ["activity", "console", "network", "performance", "replay"])
      assert.ok(names.includes(`recordings/${recordingId}/${channel}.jsonl`));
    for (const asset of assets)
      assert.ok(names.some((name) => name.startsWith(`assets/${asset.id}.`)));
    assert.deepEqual(
      JSON.parse(await readFile(join(archive.directory, "thread.json"), "utf8")).replies,
      thread.replies,
    );
    const metadata = JSON.parse(
      await readFile(join(archive.directory, "assets.json"), "utf8"),
    );
    assert.equal(
      metadata.find((entry: any) => entry.id === revisionId).baseAssetId,
      screenshotId,
    );
    const manifest = JSON.parse(
      await readFile(join(archive.directory, "manifest.json"), "utf8"),
    );
    assert.equal(manifest.threadId, threadId);
    assert.equal(manifest.projectId, projectId);
    assert.equal(manifest.threadUrl, `https://feedbacks.test/threads/${threadId}`);
    assert.ok(manifest.files.every((file: any) => /^[a-f0-9]{64}$/.test(file.sha256)));
    const tarParts: Buffer[] = [];
    for await (const part of threadTarEntries(archive)) tarParts.push(part);
    const tar = gunzipSync(gzipSync(Buffer.concat(tarParts)));
    let offset = 0;
    const tarNames: string[] = [];
    while (tar[offset] !== 0) {
      const header = tar.subarray(offset, offset + 512);
      const name = header.toString("ascii", 0, 100).replace(/\0.*$/, "");
      const size = Number.parseInt(
        header.toString("ascii", 124, 136).replace(/\0.*$/, "").trim(),
        8,
      );
      tarNames.push(name);
      offset += 512 + Math.ceil(size / 512) * 512;
    }
    assert.deepEqual(tarNames, names);
    await assert.rejects(
      prepareThreadArchive(
        database as any,
        {
          async get(key: string) {
            if (key === `private/${videoId}`) throw Error("object missing");
            return Buffer.from(`binary:${key}`);
          },
        } as any,
        operations as any,
        {} as any,
        threadId,
      ),
      /temporarily unavailable/,
      "a missing video must never produce a partial success archive",
    );
  } finally {
    await rm(archive.directory, { recursive: true, force: true });
  }
});

test("thread bundle HTTP download is a private gzip attachment with current read scopes", async () => {
  const threadId = randomUUID();
  const projectId = randomUUID();
  const database = {
    async query() {
      return [];
    },
  };
  const ops = {
    config: { appOrigin: "https://feedbacks.test" },
    auth: {
      async authenticate(value: string) {
        return value === "denied" ? { scopes: [] } : {};
      },
    },
    async executeOperation(_actor: unknown, name: string) {
      if (name === "threads.get") return { id: threadId, projectId, body: "A thread" };
      if (name === "recordings.list") return { items: [] };
      throw Error(`Unexpected operation ${name}`);
    },
  };
  const app = express();
  registerThreadArchiveRoutes(
    app,
    database as any,
    {} as any,
    ops as any,
    (req) => req.get("Authorization"),
    () => undefined,
  );
  app.use((error: any, _req: unknown, res: any, _next: unknown) =>
    res.status(error.status ?? 500).json({ error: error.message }),
  );
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}/api/threads/${threadId}/archive`;
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/gzip");
    assert.match(response.headers.get("content-disposition") ?? "", /feedbacks-thread-/);
    const tar = gunzipSync(Buffer.from(await response.arrayBuffer()));
    assert.equal(tar.toString("ascii", 0, 11), "thread.json");
    const denied = await fetch(url, { headers: { Authorization: "denied" } });
    assert.equal(denied.status, 403);
  } finally {
    server.close();
    await once(server, "close");
  }
});
