import { diagnosticsSchema } from "../diagnostics.js";
import {
  recordingSchema,
  recordingEventSchema,
  RECORDING_EVENTS_PAGE_MAX,
} from "../recordings.js";
import { z } from "zod";
import { tagColors } from "../taxonomy.js";
export const id = z.string().uuid(),
  text = z.string().trim().min(1).max(12000),
  name = z.string().trim().min(1).max(120),
  revision = z.number().int().positive();
export const page = {
  limit: z.number().int().min(1).max(100).default(30),
  offset: z.number().int().min(0).max(100000).default(0),
};
export const categorySchema = z.union([
  z.enum(["general", "visualDesign", "productWorkflow", "usabilityAccessibility"]),
  z
    .string()
    .regex(/^custom:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),
]);
export const tagSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(32)
  .regex(/^[\p{L}\p{N}][\p{L}\p{N} _/-]*$/u, "Use letters, numbers, spaces, /, _ or -");
export const tagsSchema = z
  .array(tagSchema)
  .max(12)
  .transform((tags) => [...new Set(tags)].sort());
export const projectCategoryInput = z.object({
  id: categorySchema.optional(),
  name: z.string().trim().min(1).max(60),
  archived: z.boolean(),
});
export const projectTagInput = z.object({
  name: tagSchema,
  color: z.enum(tagColors),
});
export const projectTaxonomyInput = z.object({
  projectId: id,
  revision,
  categories: z.array(projectCategoryInput).max(32),
  tags: z.array(projectTagInput).max(200),
});
export const projectTaxonomyOutput = z.object({
  revision,
  categories: z.array(projectCategoryInput.extend({ id: categorySchema })),
  tags: z.array(projectTagInput.extend({ managed: z.boolean() })),
});
export const surveyQuestionBase = {
  id: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/),
  prompt: z.string().trim().min(1).max(300),
  required: z.boolean(),
};
export const surveyQuestionSchema = z.discriminatedUnion("type", [
  z.object({ ...surveyQuestionBase, type: z.literal("nps") }),
  z.object({ ...surveyQuestionBase, type: z.literal("rating") }),
  z.object({ ...surveyQuestionBase, type: z.literal("text") }),
  z.object({
    ...surveyQuestionBase,
    type: z.literal("single_choice"),
    options: z
      .array(z.string().trim().min(1).max(80))
      .min(2)
      .max(8)
      .refine(
        (options) => new Set(options).size === options.length,
        "Options must be distinct",
      ),
  }),
]);
export const surveyQuestionsSchema = z
  .array(surveyQuestionSchema)
  .min(1)
  .max(8)
  .refine(
    (questions) => new Set(questions.map((q) => q.id)).size === questions.length,
    "Question IDs must be distinct",
  );
export const calendarDateSchema = z.iso
  .date()
  .refine((value) => !value.startsWith("0000-"), "Calendar year must be at least 0001");
export const workPlanSchema = z
  .object({
    priority: z.enum(["low", "normal", "high"]),
    schedule: z.enum(["unscheduled", "today", "tomorrow", "next_week", "later"]),
    scheduledFor: calendarDateSchema.nullable(),
    timeZone: z
      .string()
      .min(1)
      .max(100)
      .refine((value) => {
        if (/^[+-]/.test(value)) return false;
        try {
          new Intl.DateTimeFormat("en", { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, "Use a valid IANA timezone"),
  })
  .refine(
    (plan) =>
      ["unscheduled", "later"].includes(plan.schedule)
        ? plan.scheduledFor === null
        : plan.scheduledFor !== null,
    "Dated schedules require scheduledFor; unscheduled and later require null",
  );
export type WorkPlan = z.infer<typeof workPlanSchema>;
export const reviewFiltersSchema = z.object({
  search: z.string().max(200).default(""),
  sort: z
    .enum(["newest", "activity", "likes", "priority", "topPriority", "workPlan"])
    .default("activity"),
  authorId: id.optional(),
  assignedTo: id.optional(),
  planningDate: calendarDateSchema.optional(),
  createdAfter: z.string().datetime({ offset: true }).optional(),
  createdBefore: z.string().datetime({ offset: true }).optional(),
  activityAfter: z.string().datetime({ offset: true }).optional(),
  workState: z
    .enum(["open", "in_progress", "ready_for_review", "resolved", "declined"])
    .optional(),
  topPriority: z.boolean().optional(),
  showResolved: z.boolean().default(false),
  archived: z.boolean().optional(),
  url: z.string().url().max(4096).optional(),
  domain: z.string().trim().min(1).max(253).optional(),
  hostname: z.string().trim().min(1).max(253).optional(),
  deviceClass: z.enum(["mobile", "tablet", "desktop"]).optional(),
  category: categorySchema.optional(),
  tag: tagSchema.optional(),
});
export type ReviewFilters = z.infer<typeof reviewFiltersSchema>;
export const anchorSchema = z.object({
  viewport: z
    .object({
      width: z.number().int().min(1).max(20000),
      height: z.number().int().min(1).max(20000),
    })
    .optional(),
  capturedAt: z.string().datetime().optional(),
  tagName: z.string().max(40).optional(),
  selector: z.string().max(2000).optional(),
  fingerprint: z.string().max(500).optional(),
  recordIdentity: z.string().max(200).optional(),
  confidence: z.enum(["element", "coordinate-only", "unmatched"]).optional(),
  point: z.object({ x: z.number(), y: z.number() }).optional(),
  rect: z
    .object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
    .optional(),
  screenshotPoint: z.object({ x: z.number(), y: z.number() }).optional(),
  pagePoint: z.object({ x: z.number(), y: z.number() }).optional(),
  styles: z
    .object({
      fontFamily: z.string().max(200).optional(),
      fontSize: z.string().max(50).optional(),
      color: z.string().max(100).optional(),
      backgroundColor: z.string().max(100).optional(),
      borderWidth: z.string().max(100).optional(),
      borderStyle: z.string().max(100).optional(),
      borderColor: z.string().max(100).optional(),
      borderRadius: z.string().max(100).optional(),
    })
    .optional(),
});
export const contextSchema = z.object({
  url: z.string().url().max(4096),
  title: z.string().max(300).optional(),
  viewport: z.object({
    width: z.number().int().min(100).max(20000),
    height: z.number().int().min(100).max(20000),
  }),
  devicePixelRatio: z.number().min(0.1).max(10).default(1),
  scroll: z.object({ x: z.number(), y: z.number() }).optional(),
  preset: z.enum(["mobile", "tablet", "desktop", "wide", "custom"]).optional(),
  requestedSize: z.object({ width: z.number(), height: z.number() }).optional(),
  captureDimensions: z.object({ width: z.number(), height: z.number() }).optional(),
  capturedAt: z.string().datetime().optional(),
  captureMarker: z
    .object({
      style: z.enum(["none", "pin", "arrow", "dot", "ring"]),
      size: z.enum(["small", "medium", "large"]),
    })
    .optional(),
  anchor: anchorSchema.optional(),
  annotations: z
    .array(
      z.object({
        id: z.string().uuid(),
        body: z.string().trim().min(1).max(4000),
        anchor: anchorSchema,
      }),
    )
    .max(100)
    .refine(
      (items) => new Set(items.map((item) => item.id)).size === items.length,
      "Point IDs must be distinct",
    )
    .optional(),
});
export const normalizedPointSchema = z.object({
  x: z.number().finite().min(0).max(1),
  y: z.number().finite().min(0).max(1),
});
export const imageMarkupSchema = z
  .array(
    z.object({
      tool: z.enum(["pencil", "ellipse"]),
      points: z.array(normalizedPointSchema).min(2).max(2000),
    }),
  )
  .max(200);
export const screenshotMarkSchema = z.object({
  tool: z.enum([
    "point",
    "pencil",
    "arrow",
    "rectangle",
    "text",
    "highlighter",
    "steps",
    "blur",
    "sticker",
    "image",
  ]),
  bounds: z.object({
    x: z.number().finite().min(0).max(1),
    y: z.number().finite().min(0).max(1),
    width: z.number().finite().min(0).max(1),
    height: z.number().finite().min(0).max(1),
  }),
  endpoints: z.array(normalizedPointSchema).min(1).max(2),
  number: z.number().int().positive().max(100).optional(),
  annotationId: id.optional(),
  origin: z.enum(["element"]).optional(),
  text: z.string().max(200).optional(),
});
export const recordingFrameSchema = z.object({
  recordingId: id,
  atMs: z.number().finite().min(0).max(300000),
  videoTimeMs: z.number().finite().min(0).max(300000).optional(),
  annotationId: id.optional(),
});
export const captureRegionSchema = z.object({
  startY: z.number().finite().min(0),
  endY: z.number().finite().positive(),
  pageWidth: z.number().finite().positive(),
});
export const captureSectionSchema = captureRegionSchema.extend({
  imageTop: z.number().finite().min(0).max(1),
  imageBottom: z.number().finite().min(0).max(1),
});
export const tm = { threadId: id, revision };
export const policy = z.object({
  general: z.number().min(0).max(10).default(1),
  visualDesign: z.number().min(0).max(10).optional(),
  productWorkflow: z.number().min(0).max(10).optional(),
  usabilityAccessibility: z.number().min(0).max(10).optional(),
});
export const captureMode = z.enum(["origins", "any"]);
export const projectInput = z
  .object({
    name,
    origins: z.array(z.string().url()).max(100),
    captureMode: captureMode.optional(),
    repositoryUrl: z.string().url().max(1000).optional(),
    reviewEnabled: z.boolean().optional(),
    documentsEnabled: z.boolean().optional(),
    surveysEnabled: z.boolean().optional(),
  })
  .superRefine((project, ctx) => {
    if ((project.captureMode ?? "origins") === "origins" && !project.origins.length)
      ctx.addIssue({
        code: "custom",
        path: ["origins"],
        message: "At least one approved origin is required",
      });
  });
export const reviewerContextOutput = z.object({
  trust: z.literal("owner_approved_advisory_reviewer_context"),
  items: z.array(
    z.object({
      userId: id,
      name: z.string(),
      guidance: z.string(),
      revision: z.number(),
      policy,
      policyVersion: z.number(),
    }),
  ),
});
export const contextTextInput = {
  body: z.string().max(8000),
  revision: z.number().int().min(0),
};
export const contextTextOutput = z.object({
  currentWork: z.string().optional(),
  body: z.string(),
  revision: z.number(),
  userId: id.optional(),
  projectId: id.optional(),
  updatedBy: id.nullable(),
  updatedAt: z.string().nullable(),
  trust: z.enum([
    "self_authored_advisory",
    "owner_authored_advisory",
    "maintainer_authored_advisory",
    "member_authored_advisory",
  ]),
});
export const assignmentOutput = z.object({
  id,
  projectId: id,
  threadId: id,
  annotationIds: z.array(id),
  userId: id,
  memberName: z.string(),
  agentId: id,
  agentName: z.string(),
  summary: z.string(),
  state: z.enum(["active", "completed", "paused", "expired"]),
  revision: z.number(),
  expiresAt: z.string(),
  updatedAt: z.string(),
});
export const delegationActorOutput = z.object({
  userId: id,
  memberName: z.string(),
  agentId: id.nullable(),
  agentName: z.string().nullable(),
});
export const delegationOutput = z.object({
  id,
  projectId: id,
  threadId: id,
  annotationIds: z.array(id),
  userId: id,
  memberName: z.string(),
  summary: z.string(),
  category: categorySchema,
  tags: z.array(z.string()),
  githubDecision: z.enum(["undecided", "create_issue", "not_needed", "already_linked"]),
  githubRationale: z.string(),
  state: z.enum(["active", "cancelled"]),
  revision,
  createdAt: z.string(),
  updatedAt: z.string(),
  updatedBy: delegationActorOutput,
});
export type Delegation = z.output<typeof delegationOutput>;
export type DelegationActor = z.output<typeof delegationActorOutput>;
export const delegationPage = {
  offset: z.number().int().min(0).max(100000).default(0),
  limit: z.number().int().min(1).max(50).default(10),
};
export interface Actor {
  id: string;
  userId: string;
  kind: "human" | "agent" | "extension" | "guest";
  name: string;
  owner: boolean;
  primaryOwner?: boolean;
  mustChangePassword?: boolean;
  tokenId?: string;
  sessionHash?: string;
  projects?: string[];
  scopes?: string[];
  canResolve?: boolean;
  ownerAdmin?: boolean;
}
export { diagnosticsSchema } from "../diagnostics.js";
export {
  recordingSchema,
  recordingEventSchema,
  RECORDING_EVENTS_PAGE_MAX,
} from "../recordings.js";
