import { z } from "zod";

// Native pixels have no website origin or DOM. These are reviewer-supplied facts.
export const appCaptureSchema = z
  .object({
    appName: z.string().trim().min(1).max(120),
    appVersion: z.string().trim().max(80).optional(),
    platform: z.enum(["windows", "macos", "linux", "android", "ios", "other"]),
    method: z.enum(["screen_capture", "image_import"]),
    surface: z.enum(["window", "monitor", "browser", "unknown"]).optional(),
    capturedAt: z.string().datetime().optional(),
    width: z.number().int().min(1).max(12000),
    height: z.number().int().min(1).max(12000),
    points: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            body: z.string().trim().min(1).max(4000),
            x: z.number().finite().min(0).max(1),
            y: z.number().finite().min(0).max(1),
          })
          .strict(),
      )
      .max(100)
      .default([]),
  })
  .strict()
  .refine((value) => value.width * value.height <= 40_000_000, "Image is too large")
  .refine(
    (value) =>
      new Set(value.points.map((point) => point.id)).size === value.points.length,
    "Point IDs must be distinct",
  );

export type AppCapture = z.infer<typeof appCaptureSchema>;
