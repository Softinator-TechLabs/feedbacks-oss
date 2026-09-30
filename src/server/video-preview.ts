import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp, { type OverlayOptions } from "sharp";
import type { AssetStore } from "./assets.js";

// No URLs, shells or persistent derived assets. Decode only after assets.get
// authorization; cap concurrent decoders instead of growing an unbounded queue.
let active = 0;
const unavailable = (reason: string) => ({
  videoPreview: {
    state: "unavailable" as const,
    reason,
    playbackVerified: false as const,
  },
});
function run(binary: string, args: string[], timeout: number, maxBuffer: number) {
  return new Promise<{ stdout: Buffer; stderr: Buffer }>((resolve, reject) => {
    execFile(
      binary,
      args,
      {
        timeout,
        maxBuffer,
        encoding: "buffer",
        killSignal: "SIGKILL",
        windowsHide: true,
      },
      (error, stdout, stderr) => (error ? reject(error) : resolve({ stdout, stderr })),
    );
  });
}
export async function videoPreview(
  store: AssetStore,
  objectKey: string,
  maxDimension: number,
  videoTimeMs?: number,
) {
  if (active >= 2) return unavailable("busy");
  active++;
  let directory: string | undefined;
  try {
    const bytes = await store.get(objectKey);
    if (!bytes.length || bytes.length > 40 * 1024 * 1024)
      return unavailable("size_limit");
    directory = await mkdtemp(path.join(tmpdir(), "feedbacks-preview-"));
    const source = path.join(directory, "source.webm");
    await writeFile(source, bytes, { mode: 0o600 });
    const deadline = Date.now() + 25000;
    const probe = await run(
      "ffprobe",
      [
        "-v",
        "error",
        "-protocol_whitelist",
        "file",
        "-f",
        "matroska",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height,codec_name:format=duration",
        "-of",
        "json",
        source,
      ],
      5000,
      64 * 1024,
    );
    const metadata = JSON.parse(probe.stdout.toString());
    const stream = metadata.streams?.[0];
    if (
      !stream ||
      !["vp8", "vp9", "av1"].includes(stream.codec_name) ||
      !(stream.width > 0 && stream.height > 0) ||
      stream.width * stream.height > 16000000
    )
      return unavailable("unsupported_video");
    const duration = Number(metadata.format?.duration) * 1000;
    const knownDuration = Number.isFinite(duration) && duration > 0;
    if (knownDuration && duration > 301000) return unavailable("duration_limit");
    if (videoTimeMs !== undefined && knownDuration && videoTimeMs >= duration)
      return unavailable("timestamp_out_of_range");
    // Uploaded duration is only a reporter hint. Use probed media duration; when
    // absent, sample the beginning and explicitly leave coverage unknown.
    const end = knownDuration ? Math.max(0, duration - 500) : 0;
    const times = [
      ...new Set(
        videoTimeMs === undefined
          ? [0, Math.round(end / 2), Math.round(end)]
          : [
              Math.max(0, videoTimeMs - 1000),
              videoTimeMs,
              ...(knownDuration ? [Math.min(end, videoTimeMs + 1000)] : []),
            ],
      ),
    ].sort((a, b) => a - b);
    const tileWidth = Math.min(maxDimension, 1280);
    const tileHeight = Math.max(
      1,
      Math.round(tileWidth * Math.min(stream.height / stream.width, 1)),
    );
    const frames: any[] = [];
    const tiles: OverlayOptions[] = [];
    const missed: number[] = [];
    for (const requestedTimeMs of times) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return unavailable("timeout");
      // showinfo is before scale and reports original presentation timestamps.
      const result = await run(
        "ffmpeg",
        [
          "-hide_banner",
          "-nostdin",
          "-copyts",
          "-loglevel",
          "info",
          "-max_alloc",
          "67108864",
          "-protocol_whitelist",
          "file",
          "-threads",
          "1",
          "-f",
          "matroska",
          "-i",
          source,
          "-map",
          "0:v:0",
          "-an",
          "-sn",
          "-dn",
          "-vf",
          `select=gte(t\\,${requestedTimeMs / 1000}),showinfo,scale=${tileWidth}:${tileHeight}:force_original_aspect_ratio=decrease`,
          "-frames:v",
          "1",
          "-filter_threads",
          "1",
          "-threads",
          "1",
          "-c:v",
          "png",
          "-f",
          "image2pipe",
          "pipe:1",
        ],
        Math.min(10000, remaining),
        4 * 1024 * 1024,
      );
      const pts = /\bpts_time:([\d.e+-]+)/.exec(result.stderr.toString());
      if (!result.stdout.length || !pts || !Number.isFinite(Number(pts[1]))) {
        missed.push(requestedTimeMs);
        continue;
      }
      const videoTime = Math.round(Number(pts[1]) * 1000);
      const resized = await sharp(result.stdout)
        .resize(tileWidth, tileHeight, { fit: "contain", background: "#101820" })
        .png()
        .toBuffer();
      const top = frames.length * (tileHeight + 32);
      tiles.push({ input: resized, left: 0, top: top + 32 });
      tiles.push({
        input: Buffer.from(
          `<svg width="${tileWidth}" height="32"><rect width="100%" height="100%" fill="#101820"/><text x="12" y="22" fill="white" font-size="18" font-family="sans-serif">${frames.length + 1} · ${(videoTime / 1000).toFixed(3)} s (sample)</text></svg>`,
        ),
        left: 0,
        top,
      });
      frames.push({
        requestedTimeMs,
        videoTimeMs: videoTime,
        x: 0,
        y: top + 32,
        width: tileWidth,
        height: tileHeight,
      });
    }
    if (!frames.length) return unavailable("no_decodable_frame");
    const height = frames.length * (tileHeight + 32);
    const data = await sharp({
      create: { width: tileWidth, height, channels: 3, background: "#101820" },
    })
      .composite(tiles)
      .webp({ quality: 80 })
      .toBuffer();
    if (data.length > 2 * 1024 * 1024) return unavailable("preview_size_limit");
    return {
      image: {
        data: data.toString("base64"),
        mimeType: "image/webp" as const,
        width: tileWidth,
        height,
      },
      videoPreview: {
        state: "sampled" as const,
        playbackVerified: false as const,
        timeBasis: "asset_video" as const,
        sourceVersion: createHash("sha256").update(bytes).digest("hex"),
        ...(knownDuration
          ? { durationMs: Math.round(duration) }
          : { durationUnknown: true }),
        frames,
        ...(missed.length ? { missedTimeMs: missed } : {}),
      },
    };
  } catch (error: any) {
    // Never return process stderr, local paths or configuration to a client.
    return unavailable(
      error?.code === "ENOENT"
        ? "decoder_unavailable"
        : error?.killed
          ? "timeout"
          : "decode_failed",
    );
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => {});
    active--;
  }
}
