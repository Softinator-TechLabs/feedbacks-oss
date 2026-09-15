import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
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
  put(key: string, bytes: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
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
export class LocalAssets implements AssetStore {
  constructor(private directory: string) {}
  async put(key: string, bytes: Buffer) {
    const target = path.join(this.directory, key);
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, bytes, { mode: 0o600 });
  }
  async get(key: string) {
    return readFile(path.join(this.directory, key));
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
  async put(key: string, bytes: Buffer) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.s3Bucket,
        Key: key,
        Body: bytes,
        ContentType: "image/webp",
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
export async function assets(
  db: Database,
  a: Actor,
  op: string,
  i: any,
  store: AssetStore,
  config: Config,
): Promise<any> {
  if (op === "assets.get") {
    const row = await assetRow(db, a, i.assetId);
    return {
      id: row.id,
      projectId: row.project_id,
      threadId: row.thread_id,
      ...row.data,
      url: `/api/assets/${row.id}`,
    };
  }
  const row = await threadRow(db, a, i.threadId, "write", true);
  const prior = await retry(db, a, op, i);
  if (prior)
    return {
      thread: await fullThread(db, a, row),
      asset: await assets(db, a, "assets.get", { assetId: prior }, store, config),
    };
  checkRevision(row, i.revision);
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
  const key = `feedbacks/${config.production ? "production" : "development"}/organizations/${config.organizationId}/projects/${row.project_id}/feedback/${row.id}/captures/${captureId}/${i.rendition}.webp`;
  const data = {
    captureId,
    rendition: i.rendition,
    width: metadata.width,
    height: metadata.height,
    bytes: output.length,
    contentType: "image/webp",
    createdAt: new Date().toISOString(),
  };
  await db.query(
    "INSERT INTO assets(id,project_id,thread_id,object_key,data,status) VALUES($1,$2,$3,$4,$5,'pending')",
    [id, row.project_id, row.id, key, JSON.stringify(data)],
  );
  try {
    await store.put(key, output);
  } catch {
    fail(
      "UPLOAD_FAILED",
      "Private image storage is unavailable; your draft can be retried",
      503,
    );
  }
  await db.query("UPDATE assets SET status='validated' WHERE id=$1", [id]);
  await remember(db, a, op, i, id);
  await event(db, a, row.project_id, id, "asset.validated", {
    threadId: row.id,
  });
  const saved = await saveThread(db, a, row, "thread.asset");
  return {
    asset: { id, ...data, url: `/api/assets/${id}` },
    thread: await fullThread(db, a, saved),
  };
}
