import { z } from "zod";
import { diagnosticManifestSchema } from "./screenshot-diagnostics.js";

export const diagnosticMaterializeInput = z.strictObject({
  evidenceId: z.uuid(),
});

export const diagnosticMaterializeOutput = z.object({
  directory: z.string(),
  manifest: z.string(),
  evidenceId: z.uuid(),
  coverage: diagnosticManifestSchema.shape.coverage,
  files: z.array(
    z.object({
      fileId: z.uuid(),
      kind: diagnosticManifestSchema.shape.files.element.shape.kind,
      path: z.string(),
      byteLength: z.number().int().nonnegative(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
    }),
  ),
});
