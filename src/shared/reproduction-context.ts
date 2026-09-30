import { z } from "zod";

// Explicit stable identity only. Never recover credentials or guess identifiers
// from navigation query strings. Values remain untrusted application evidence.
const value = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .refine(
    (text) =>
      !/https?:\/\/|bearer\s|(?:token|password|secret|api[_-]?key|authorization)\s*[:=]/i.test(
        text,
      ),
    "Use a stable identifier, not an access URL or credential",
  );
export const reproductionSchema = z
  .object({
    source: z.enum(["app", "reporter"]),
    objectId: value.optional(),
    workspaceId: value.optional(),
    file: value.optional(),
    section: value.optional(),
    view: value.optional(),
    version: value.optional(),
  })
  .strict();
export function reproductionSnapshot(context: any) {
  const parsed = reproductionSchema.safeParse(context?.reproduction);
  const reproduction =
    parsed.success && Object.keys(parsed.data).length > 1 ? parsed.data : undefined;
  const document = context?.document;
  const documentTarget = document?.id
    ? {
        documentId: document.id,
        ...(typeof document.page === "number" ? { page: document.page } : {}),
      }
    : undefined;
  if (!reproduction && !documentTarget) return undefined;
  return { ...reproduction, ...(documentTarget ? { document: documentTarget } : {}) };
}
