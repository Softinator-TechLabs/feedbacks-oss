import { z } from "zod";
import {
  id,
  screenshotMarkSchema,
  imageMarkupSchema,
  normalizedPointSchema,
  recordingFrameSchema,
  captureRegionSchema,
  captureSectionSchema,
  tm,
} from "../common.js";
import { assetOutput, threadOutput } from "../output-common.js";

export const assetsInputs = {
  "assets.upload": z.object({
    ...tm,
    imageBase64: z.string().max(13982000),
    rendition: z.enum(["screenshot", "annotated", "thumbnail"]).default("annotated"),
    filename: z
      .string()
      .max(120)
      .regex(/^[a-z0-9][a-z0-9._-]*$/)
      .optional(),
    captureRegion: captureRegionSchema.optional(),
    recordingFrame: recordingFrameSchema.optional(),
    captureSections: z.array(captureSectionSchema).min(1).optional(),
    markings: z.array(screenshotMarkSchema).max(2000).optional(),
    markup: imageMarkupSchema.optional(),
    replacesAssetId: id.optional(),
    point: z
      .object({
        id,
        body: z.string().trim().min(1).max(4000),
        x: normalizedPointSchema.shape.x,
        y: normalizedPointSchema.shape.y,
      })
      .optional(),
    idempotencyKey: z.string().min(8).max(200),
  }),
  "assets.uploadVideo": z.object({
    ...tm,
    videoBase64: z.string().max(55924080),
    durationMs: z.number().int().positive().max(300000),
    idempotencyKey: z.string().min(8).max(200),
  }),
  "assets.get": z.object({
    assetId: id,
    includeImage: z.boolean().default(false),
    maxDimension: z.number().int().min(256).max(2048).default(1600),
    crop: z
      .object({
        left: z.number().int().min(0),
        top: z.number().int().min(0),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      })
      .optional(),
  }),
};

export const assetsOutputs = {
  "assets.get": assetOutput,
  "assets.upload": z.object({ asset: assetOutput, thread: threadOutput }),
  "assets.uploadVideo": z.object({ asset: assetOutput, thread: threadOutput }),
};
