import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { videoPreview } from "../src/server/video-preview.js";
import { mcpServer } from "../src/server/mcp.js";
import { outputSchemas } from "../src/shared/contracts.js";
const store = (bytes: Buffer) => ({
  get: async () => bytes,
  put: async () => {},
  remove: async () => {},
});

test("real video becomes a labelled bounded native MCP contact sheet with decoded times", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "feedbacks-preview-test-"));
  try {
    const video = path.join(dir, "synthetic.webm");
    execFileSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=640x360:rate=5:duration=3",
        "-threads",
        "1",
        "-c:v",
        "libvpx",
        video,
      ],
      { timeout: 10000 },
    );
    const shiftedFile = path.join(dir, "offset.webm");
    execFileSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-i",
        video,
        "-vf",
        "setpts=PTS+2/TB",
        "-threads",
        "1",
        "-c:v",
        "libvpx",
        shiftedFile,
      ],
      { timeout: 10000 },
    );
    const shifted = await videoPreview(
      store(await readFile(shiftedFile)),
      "shifted",
      640,
      2000,
    );
    const shiftedFrames = (shifted.videoPreview as any).frames;
    assert.equal(
      shiftedFrames.find((f: any) => f.requestedTimeMs === 1000).videoTimeMs,
      2000,
      "first asset frame starts at PTS 2s; do not subtract its start_time",
    );
    assert.equal(
      shiftedFrames.find((f: any) => f.requestedTimeMs === 2000).videoTimeMs,
      2000,
    );
    const bytes = await readFile(video);
    const r = await videoPreview(store(bytes), "opaque-private-key", 640);
    assert.equal(r.videoPreview.state, "sampled", JSON.stringify(r));
    assert.ok(r.image);
    const meta = r.videoPreview as any;
    assert.equal(meta.frames.length, 3);
    assert.deepEqual(
      meta.frames.map((f: any) => f.requestedTimeMs),
      [0, 1250, 2500],
    );
    assert.deepEqual(
      meta.frames.map((f: any) => f.videoTimeMs),
      [0, 1400, 2600],
    );
    assert.match(meta.sourceVersion, /^[a-f0-9]{64}$/);
    const pixels = Buffer.from(r.image.data, "base64");
    assert.ok(pixels.length < 2 * 1024 * 1024);
    assert.equal((await sharp(pixels).metadata()).width, 640);
    if (process.env.FEEDBACKS_PREVIEW_ARTIFACT)
      await writeFile(process.env.FEEDBACKS_PREVIEW_ARTIFACT, pixels);
    const focused = await videoPreview(store(bytes), "key", 640, 2000);
    assert.ok(
      (focused.videoPreview as any).frames.some((f: any) => f.videoTimeMs === 2000),
    );
    assert.equal(
      (await videoPreview(store(bytes), "key", 640, 3000)).videoPreview.reason,
      "timestamp_out_of_range",
    );
    for (const profile of ["full", "compact"] as const) {
      const asset = {
        id: "8c06f94d-fca6-4333-84b7-671e560812bc",
        captureId: "8c06f94d-fca6-4333-84b7-671e560812bc",
        rendition: "tabVideo",
        contentType: "video/webm",
        bytes: bytes.length,
        createdAt: "2026-09-30T00:00:00Z",
        url: "/api/assets/synthetic",
        ...r,
      };
      outputSchemas["assets.get"].parse(asset);
      const server = mcpServer(async () => asset, profile);
      const client = new Client({ name: "video-preview-test", version: "1" });
      const [a, b] = InMemoryTransport.createLinkedPair();
      try {
        await server.connect(a);
        await client.connect(b);
        const result = await client.callTool({
          name: profile === "compact" ? "feedbacks_asset" : "assets.get",
          arguments: { assetId: asset.id, includeImage: true },
        });
        assert.equal(result.isError, undefined);
        assert.equal(
          (result.content as any[]).filter((c) => c.type === "image").length,
          1,
        );
        assert.equal((result.structuredContent as any).videoPreview.state, "sampled");
        assert.ok(!JSON.stringify(result.structuredContent).includes(r.image.data));
      } finally {
        await client.close();
        await server.close();
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("invalid bytes and over-size inputs produce explicit unavailability without internal details", async () => {
  for (const bytes of [
    Buffer.from("invalid media with SECRET"),
    Buffer.alloc(40 * 1024 * 1024 + 1),
  ]) {
    const r = await videoPreview(store(bytes), "PRIVATE_OBJECT_KEY", 640);
    assert.equal(r.videoPreview.state, "unavailable");
    assert.equal(r.image, undefined);
    assert.doesNotMatch(JSON.stringify(r), /SECRET|PRIVATE_OBJECT|tmp/);
  }
});
test("decoder concurrency is bounded without an unbounded waiting queue", async () => {
  let release!: (value: Buffer) => void;
  const pending = new Promise<Buffer>((resolve) => {
    release = resolve;
  });
  const blocked = { ...store(Buffer.alloc(0)), get: () => pending };
  const first = videoPreview(blocked, "a", 640),
    second = videoPreview(blocked, "b", 640);
  assert.equal((await videoPreview(blocked, "c", 640)).videoPreview.reason, "busy");
  release(Buffer.alloc(0));
  await Promise.all([first, second]);
  assert.equal(
    (await videoPreview(store(Buffer.alloc(0)), "d", 640)).videoPreview.reason,
    "size_limit",
  );
});
