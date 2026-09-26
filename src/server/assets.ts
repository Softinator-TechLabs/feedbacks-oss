import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Database } from "./db.js";
import type { Actor } from "../shared/contracts.js";
import type { Config } from "./config.js";
import { access, event } from "./access.js";
import { fail } from "./errors.js";
import {
  checkRevision,
  fullThread,
  remember,
  retry,
  saveThread,
  threadRow,
} from "./feedback.js";
export interface AssetStore {
  put(key: string, bytes: Buffer, contentType?: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
  signedGetUrl?(key: string, expiresInSeconds: number): Promise<string | null>;
}
// Called only after the operation has authorized access and released its transaction.
export async function assetPreview(
  store: AssetStore,
  objectKey: string,
  maxDimension: number,
) {
  const { data, info } = await sharp(await store.get(objectKey))
    .resize({
      width: maxDimension,
      height: maxDimension,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 80 })
    .toBuffer({ resolveWithObject: true });
  if (data.length > 2 * 1024 * 1024)
    fail(
      "IMAGE_TOO_LARGE",
      "Preview exceeds 2 MiB; retry with a smaller maxDimension",
      413,
    );
  return {
    data: data.toString("base64"),
    mimeType: "image/webp" as const,
    width: info.width,
    height: info.height,
  };
}

// Keep list previews small without exposing the private original asset or its storage key.
export async function assetListThumbnail(store: AssetStore, objectKey: string) {
  return sharp(await store.get(objectKey))
    .resize({
      width: 160,
      height: 100,
      fit: "cover",
      position: "north",
      withoutEnlargement: true,
    })
    .webp({ quality: 70 })
    .toBuffer();
}
export class LocalAssets implements AssetStore {
  constructor(private directory: string) {}
  async put(key: string, bytes: Buffer, _contentType?: string) {
    const target = path.join(this.directory, key);
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, bytes, { mode: 0o600 });
  }
  async get(key: string) {
    return readFile(path.join(this.directory, key));
  }
  async remove(key: string) {
    await rm(path.join(this.directory, key), { force: true });
  }
  async signedGetUrl(_key: string, _expiresInSeconds: number) {
    return null;
  }
}
export class S3Assets implements AssetStore {
  private client: S3Client;
  constructor(private config: Config) {
    this.client = new S3Client({
      endpoint: config.s3Endpoint,
      region: config.s3Region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.s3AccessKey!,
        secretAccessKey: config.s3SecretKey!,
      },
    });
  }
  async put(key: string, bytes: Buffer, contentType = "image/webp") {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.s3Bucket,
        Key: key,
        Body: bytes,
        ContentType: contentType,
      }),
      { abortSignal: AbortSignal.timeout(15000) },
    );
  }
  async get(key: string) {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.config.s3Bucket, Key: key }),
      { abortSignal: AbortSignal.timeout(15000) },
    );
    if (!result.Body) throw new Error("Asset content missing");
    return Buffer.from(await result.Body.transformToByteArray());
  }
  async remove(key: string) {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.config.s3Bucket, Key: key }),
      { abortSignal: AbortSignal.timeout(15000) },
    );
  }
  async signedGetUrl(key: string, expiresInSeconds: number) {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.config.s3Bucket, Key: key }),
      { expiresIn: expiresInSeconds },
    );
  }
}
export function assetStore(config: Config): AssetStore {
  if (config.production && config.assetDriver !== "s3")
    throw new Error("Production requires S3");
  return config.assetDriver === "s3"
    ? new S3Assets(config)
    : new LocalAssets(config.assetDirectory);
}
export async function assetRow(db: Database, a: Actor, id: string) {
  const row = await db.one("SELECT * FROM assets WHERE id=$1", [id]);
  if (!row) fail("NOT_FOUND", "Image not found", 404);
  await access(db, a, row.project_id);
  if (row.status !== "validated")
    fail("UPLOAD_PENDING", "Image validation is incomplete", 409);
  return row;
}
export async function assets(db: Database, a: Actor, i: any): Promise<any> {
  const row = await assetRow(db, a, i.assetId);
  return {
    id: row.id,
    projectId: row.project_id,
    threadId: row.thread_id,
    ...row.data,
    url: `/api/assets/${row.id}`,
  };
}

export async function assetUploadPreflight(db: Database, a: Actor, i: any) {
  const row = await threadRow(db, a, i.threadId, "write");
  const prior = await retry(
    db,
    a,
    i.videoBase64 === undefined ? "assets.upload" : "assets.uploadVideo",
    i,
  );
  if (prior)
    return {
      projectId: row.project_id as string,
      prior: {
        thread: await fullThread(db, a, row),
        asset: await assets(db, a, { assetId: prior }),
      },
    };
  checkRevision(row, i.revision);
  return { projectId: row.project_id as string, prior: null };
}

export async function prepareAssetUpload(i: any, config: Config, projectId: string) {
  const raw = i.imageBase64.replace(/^data:image\/(?:png|jpeg|webp);base64,/, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(raw))
    fail("VALIDATION", "Expected a base64 PNG, JPEG or WebP image");
  const buffer = Buffer.from(raw, "base64");
  if (buffer.length > 10 * 1024 * 1024 || buffer.length === 0)
    fail("IMAGE_TOO_LARGE", "Image must be 1 byte to 10 MiB", 413);
  let output: Buffer, metadata: any;
  try {
    const decoder = sharp(buffer, {
      limitInputPixels: 40000000,
      animated: false,
      failOn: "error",
    });
    metadata = await decoder.metadata();
    if (
      !["png", "jpeg", "webp"].includes(metadata.format) ||
      metadata.pages > 1 ||
      metadata.width > 12000 ||
      metadata.height > 12000
    )
      fail("VALIDATION", "Unsupported image format or dimensions");
    output = await decoder.rotate().webp({ quality: 85 }).toBuffer();
    metadata = await sharp(output).metadata();
  } catch (error) {
    if (error instanceof Error && "code" in error) throw error;
    return fail("INVALID_IMAGE", "Image could not be decoded safely");
  }
  const id = randomUUID(),
    captureId = randomUUID();
  const key = `feedbacks/${config.production ? "production" : "development"}/organizations/${config.organizationId}/projects/${projectId}/feedback/${i.threadId}/captures/${captureId}/${i.rendition}.webp`;
  const data = {
    captureId,
    rendition: i.rendition,
    width: metadata.width,
    height: metadata.height,
    bytes: output.length,
    contentType: "image/webp" as const,
    createdAt: new Date().toISOString(),
  };
  return { id, key, data, output, projectId };
}

function webmElements(bytes: Buffer, start: number, end: number) {
  const elements: { id: number; start: number; end: number }[] = [];
  let offset = start;
  while (offset < end) {
    const first = bytes[offset];
    let idWidth = 1;
    while (idWidth <= 4 && !(first & (0x80 >> (idWidth - 1)))) idWidth++;
    if (idWidth > 4 || offset + idWidth >= end) return null;
    let id = 0;
    for (let n = 0; n < idWidth; n++) id = id * 256 + bytes[offset++];
    const sizeFirst = bytes[offset];
    let sizeWidth = 1;
    while (sizeWidth <= 8 && !(sizeFirst & (0x80 >> (sizeWidth - 1)))) sizeWidth++;
    if (sizeWidth > 8 || offset + sizeWidth > end) return null;
    let size = sizeFirst & ((0x80 >> (sizeWidth - 1)) - 1);
    for (let n = 1; n < sizeWidth; n++) size = size * 256 + bytes[offset + n];
    const unknownSize = size === 2 ** (7 * sizeWidth) - 1;
    offset += sizeWidth;
    if (unknownSize && id !== 0x18538067 && id !== 0x1f43b675) return null;
    const elementEnd = unknownSize ? end : offset + size;
    if (elementEnd > end || elementEnd < offset) return null;
    elements.push({ id, start: offset, end: elementEnd });
    offset = elementEnd;
  }
  return elements;
}

function isWebmRecording(bytes: Buffer) {
  const roots = webmElements(bytes, 0, bytes.length);
  if (!roots || roots.length < 2 || roots[0].id !== 0x1a45dfa3) return false;
  const header = webmElements(bytes, roots[0].start, roots[0].end);
  if (
    !header?.some(
      (item) =>
        item.id === 0x4282 &&
        bytes.subarray(item.start, item.end).equals(Buffer.from("webm")),
    )
  )
    return false;
  const segment = roots.find((item) => item.id === 0x18538067);
  if (!segment) return false;
  const children = webmElements(bytes, segment.start, segment.end);
  if (!children) return false;
  const tracks = children.find((item) => item.id === 0x1654ae6b);
  const cluster = children.find((item) => item.id === 0x1f43b675);
  if (!tracks || !cluster || cluster.end === cluster.start) return false;
  const blocks = webmElements(bytes, cluster.start, cluster.end);
  if (!blocks?.some((item) => item.id === 0xa3 && item.end > item.start)) return false;
  const trackEntries = webmElements(bytes, tracks.start, tracks.end);
  return !!trackEntries?.some((entry) => {
    if (entry.id !== 0xae) return false;
    const fields = webmElements(bytes, entry.start, entry.end);
    return fields?.some(
      (field) =>
        field.id === 0x83 && field.end - field.start === 1 && bytes[field.start] === 1,
    );
  });
}

export async function prepareVideoUpload(i: any, config: Config, projectId: string) {
  const raw = i.videoBase64.replace(/^data:video\/webm;base64,/, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(raw))
    fail("INVALID_VIDEO", "Expected base64 WebM video");
  const output = Buffer.from(raw, "base64");
  if (output.length < 16 || output.length > 8 * 1024 * 1024)
    fail("INVALID_VIDEO", "Video must be 16 bytes to 8 MiB", 413);
  // Require a WebM EBML header, a video track, and media in the segment.
  if (!isWebmRecording(output)) fail("INVALID_VIDEO", "Expected a WebM recording");
  const id = randomUUID(),
    captureId = randomUUID();
  const key = `feedbacks/${config.production ? "production" : "development"}/organizations/${config.organizationId}/projects/${projectId}/feedback/${i.threadId}/captures/${captureId}/tab-video.webm`;
  return {
    id,
    key,
    output,
    projectId,
    data: {
      captureId,
      rendition: "tabVideo" as const,
      bytes: output.length,
      contentType: "video/webm" as const,
      durationMs: i.durationMs,
      createdAt: new Date().toISOString(),
    },
  };
}

export async function commitAssetUpload(
  db: Database,
  a: Actor,
  i: any,
  prepared: Awaited<ReturnType<typeof prepareAssetUpload | typeof prepareVideoUpload>>,
) {
  const row = await threadRow(db, a, i.threadId, "write", true);
  const operation = i.videoBase64 === undefined ? "assets.upload" : "assets.uploadVideo";
  const prior = await retry(db, a, operation, i);
  if (prior)
    return {
      committed: false,
      result: {
        thread: await fullThread(db, a, row),
        asset: await assets(db, a, { assetId: prior }),
      },
    };
  checkRevision(row, i.revision);
  if (row.project_id !== prepared.projectId)
    fail("CONFLICT", "Feedback changed; reload before retrying", 409);
  await db.query(
    "INSERT INTO assets(id,project_id,thread_id,object_key,data,status) VALUES($1,$2,$3,$4,$5,'validated')",
    [prepared.id, row.project_id, row.id, prepared.key, JSON.stringify(prepared.data)],
  );
  await remember(db, a, operation, i, prepared.id);
  await event(db, a, row.project_id, prepared.id, "asset.validated", {
    threadId: row.id,
  });
  const saved = await saveThread(db, a, row, "thread.asset");
  return {
    committed: true,
    result: {
      asset: { id: prepared.id, ...prepared.data, url: `/api/assets/${prepared.id}` },
      thread: await fullThread(db, a, saved),
    },
  };
}
