import { diagnosticsSchema } from "./diagnostics.js";
import { z } from "zod";
const id = z.string().uuid(),
  text = z.string().trim().min(1).max(12000),
  name = z.string().trim().min(1).max(120),
  revision = z.number().int().positive();
const page = {
  limit: z.number().int().min(1).max(100).default(30),
  offset: z.number().int().min(0).max(100000).default(0),
};
export const categorySchema = z.enum([
  "general",
  "visualDesign",
  "productWorkflow",
  "usabilityAccessibility",
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
export const reviewFiltersSchema = z.object({
  search: z.string().max(200).default(""),
  sort: z.enum(["newest", "activity", "likes"]).default("activity"),
  showResolved: z.boolean().default(false),
  url: z.string().url().max(4096).optional(),
  domain: z.string().trim().min(1).max(253).optional(),
  hostname: z.string().trim().min(1).max(253).optional(),
  deviceClass: z.enum(["mobile", "tablet", "desktop"]).optional(),
  category: categorySchema.optional(),
  tag: tagSchema.optional(),
});
export type ReviewFilters = z.infer<typeof reviewFiltersSchema>;
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
  anchor: z
    .object({
      selector: z.string().max(2000).optional(),
      fingerprint: z.string().max(500).optional(),
      recordIdentity: z.string().max(200).optional(),
      confidence: z.enum(["element", "coordinate-only", "unmatched"]).optional(),
      point: z.object({ x: z.number(), y: z.number() }).optional(),
      rect: z
        .object({
          x: z.number(),
          y: z.number(),
          width: z.number(),
          height: z.number(),
        })
        .optional(),
      screenshotPoint: z.object({ x: z.number(), y: z.number() }).optional(),
      styles: z
        .object({
          fontFamily: z.string().max(200).optional(),
          fontSize: z.string().max(50).optional(),
          color: z.string().max(100).optional(),
          backgroundColor: z.string().max(100).optional(),
        })
        .optional(),
    })
    .optional(),
});
const tm = { threadId: id, revision };
const policy = z.object({
  general: z.number().min(0).max(10).default(1),
  visualDesign: z.number().min(0).max(10).optional(),
  productWorkflow: z.number().min(0).max(10).optional(),
  usabilityAccessibility: z.number().min(0).max(10).optional(),
});
const captureMode = z.enum(["origins", "any"]);
const projectInput = z
  .object({
    name,
    origins: z.array(z.string().url()).max(100),
    captureMode: captureMode.optional(),
    repositoryUrl: z.string().url().max(1000).optional(),
  })
  .superRefine((project, ctx) => {
    if ((project.captureMode ?? "origins") === "origins" && !project.origins.length)
      ctx.addIssue({
        code: "custom",
        path: ["origins"],
        message: "At least one approved origin is required",
      });
  });
const reviewerContextOutput = z.object({
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
export const inputSchemas = {
  "auth.login": z.object({
    email: z.string().trim().min(1).max(254),
    password: z.string().max(1024),
  }),
  "auth.acceptInvite": z.object({
    token: z.string().min(20).max(200),
    name,
    password: z.string().min(10).max(1024),
  }),
  "auth.me": z.object({}),
  "auth.resetPassword": z.object({
    token: z.string().min(20).max(200),
    password: z.string().min(10).max(1024),
  }),
  "auth.consumeLoginLink": z.object({ token: z.string().min(20).max(200) }),
  "account.links.create": z.object({}),
  "account.links.list": z.object({}),
  "account.links.revoke": z.object({ linkId: id }),
  "members.create": z.object({
    name,
    email: z.string().email(),
    username: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9._-]{3,40}$/)
      .optional(),
    password: z.string().min(10).max(1024),
    grants: z
      .array(
        z.object({
          projectId: id,
          role: z.enum(["maintainer", "reviewer", "viewer"]),
        }),
      )
      .max(100)
      .default([]),
  }),
  "members.resetPassword": z.object({
    userId: id,
    password: z.string().min(10).max(1024).optional(),
  }),
  "members.owner": z.object({ userId: id, owner: z.boolean() }),
  "members.notes.get": z.object({ userId: id }),
  "members.notes.save": z.object({
    userId: id,
    body: z.string().max(4000),
    revision: z.number().int().min(0),
  }),
  "members.guidance.get": z.object({ userId: id }),
  "members.guidance.save": z.object({
    userId: id,
    body: z.string().max(4000),
    revision: z.number().int().min(0),
  }),
  "context.reviewers": z.object({ projectId: id }),
  "auth.logout": z.object({}),
  "auth.changePassword": z.object({
    currentPassword: z.string().max(1024),
    password: z.string().min(10).max(1024),
  }),
  "projects.list": z.object({}),
  "projects.create": projectInput,
  "projects.get": z.object({ projectId: id }),
  "projects.update": projectInput.extend({ projectId: id, revision }),
  "members.list": z.object({ projectId: id.optional() }),
  "members.invite": z.object({
    email: z.string().email(),
    projectId: id,
    role: z.enum(["maintainer", "reviewer", "viewer"]),
  }),
  "members.grant": z.object({
    projectId: id,
    userId: id,
    role: z.enum(["maintainer", "reviewer", "viewer"]),
    canResolve: z.boolean().default(false),
    remove: z.boolean().default(false),
  }),
  "members.update": z.object({
    userId: id,
    name,
    active: z.boolean(),
    classification: z.enum(["employee", "external"]),
    expertise: z.array(z.string().max(80)).max(30),
    policy,
  }),
  "members.policy": z.object({
    projectId: id,
    userId: id,
    policy: policy.nullable(),
  }),
  "tokens.list": z.object({}),
  "tokens.create": z.object({
    name,
    projectIds: z.array(id).max(100).default([]),
    scopes: z.array(z.string()).min(1).max(100),
    expiresInDays: z.number().int().min(1).max(90).default(30),
    canResolve: z.boolean().default(false),
    ownerAdmin: z.boolean().default(false),
  }),
  "tokens.revoke": z.object({ tokenId: id }),
  "pairing.request": z.object({ name: name.default("Chrome extension") }),
  "pairing.approve": z.object({ pairingId: id }),
  "pairing.poll": z.object({
    pairingId: id,
    deviceSecret: z.string().min(20).max(200),
  }),
  "threads.list": z.object({
    projectId: id,
    ...page,
    ...reviewFiltersSchema.shape,
  }),
  "threads.neighbors": z.object({ threadId: id, ...reviewFiltersSchema.shape }),
  "threads.organize": z.object({
    ...tm,
    category: categorySchema.default("general"),
    tags: tagsSchema,
  }),
  "reviewViews.list": z.object({ projectId: id }),
  "reviewViews.save": z.object({
    projectId: id,
    viewId: id.optional(),
    revision: z.number().int().min(0).default(0),
    name: z.string().trim().min(1).max(80),
    filters: reviewFiltersSchema,
  }),
  "reviewViews.delete": z.object({ projectId: id, viewId: id, revision }),
  "threads.get": z.object({ threadId: id }),
  "threads.like": z.object({
    threadId: id,
    replyId: id.optional(),
    liked: z.boolean(),
  }),
  "threads.create": z.object({
    projectId: id,
    body: text,
    context: contextSchema,
    category: categorySchema.default("general"),
    tags: tagsSchema.default([]),
    diagnostics: diagnosticsSchema.optional(),
    idempotencyKey: z.string().min(8).max(200),
  }),
  "threads.reply": z.object({
    ...tm,
    body: text,
    intent: z.enum(["request", "response"]).optional(),
    idempotencyKey: z.string().min(8).max(200),
    mentions: z.array(id).max(30).default([]),
  }),
  "threads.status": z.object({
    ...tm,
    state: z.enum(["open", "in_progress", "ready_for_review", "resolved", "declined"]),
    note: z.string().trim().max(12000).optional(),
    duplicateOf: id.optional(),
  }),
  "threads.linkIssue": z.object({
    ...tm,
    url: z.string().url(),
    createdAt: z.string().datetime().optional(),
  }),
  "threads.evidence": z.object({
    ...tm,
    url: z.string().url().max(2000),
    note: text,
    kind: z
      .enum(["commit", "pull_request", "variant", "incorporated_in"])
      .default("incorporated_in"),
  }),
  "threads.archive": z.object({ ...tm, archived: z.boolean() }),
  "views.get": z.object({ projectId: id, context: contextSchema }),
  "views.like": z.object({
    projectId: id,
    context: contextSchema,
    liked: z.boolean(),
  }),
  "assets.upload": z.object({
    ...tm,
    imageBase64: z.string().max(13982000),
    rendition: z.enum(["screenshot", "annotated", "thumbnail"]).default("annotated"),
    idempotencyKey: z.string().min(8).max(200),
  }),
  "assets.get": z.object({
    assetId: id,
    includeImage: z.boolean().default(false),
    maxDimension: z.number().int().min(256).max(2048).default(1600),
  }),
  "instructions.get": z.object({ projectId: id }),
  "instructions.publish": z.object({
    projectId: id,
    body: text,
    revision: z.number().int().min(0),
  }),
  "context.export": z.object({
    projectId: id,
    ...page,
    snapshotId: id.optional(),
  }),
  "context.changes": z.object({
    projectId: id,
    cursor: z.string().regex(/^\d+$/).default("0"),
    limit: z.number().int().min(1).max(100).default(50),
  }),
};
export type OperationName = keyof typeof inputSchemas;
export interface Actor {
  id: string;
  userId: string;
  kind: "human" | "agent" | "extension";
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
const discussionLikesOutput = z.object({
  uniqueLikes: z.number().int().nonnegative(),
  liked: z.boolean(),
});
const assetMetadataOutput = z.object({
  id,
  captureId: id,
  rendition: z.enum(["screenshot", "annotated", "thumbnail"]),
  width: z.number(),
  height: z.number(),
  bytes: z.number(),
  contentType: z.literal("image/webp"),
  createdAt: z.string(),
  url: z.string(),
  projectId: id.optional(),
  threadId: id.optional(),
});
const assetOutput = assetMetadataOutput.extend({
  image: z
    .object({
      data: z.string().max(2800000),
      mimeType: z.literal("image/webp"),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    })
    .optional(),
});
export const threadOutput = z
  .object({
    id,
    projectId: id,
    revision,
    body: z.string(),
    // Older immutable snapshots may predate attachment metadata.
    assets: z.array(assetMetadataOutput).optional(),
    // Pre-migration immutable export snapshots have no discussion-like fields.
    likes: discussionLikesOutput.optional(),
    replies: z.array(
      z.object({ id, likes: discussionLikesOutput.optional() }).passthrough(),
    ),
    context: z.object({}).passthrough(),
    response: z
      .object({ state: z.enum(["unanswered", "responded", "needs-follow-up"]) })
      .passthrough(),
    work: z
      .object({
        state: z.enum([
          "open",
          "in_progress",
          "ready_for_review",
          "resolved",
          "declined",
        ]),
      })
      .passthrough(),
    externalIssues: z.array(
      z.object({ url: z.string(), verification: z.literal("reported") }).passthrough(),
    ),
    fixEvidence: z.array(z.object({}).passthrough()),
    pins: z.object({ defaultVisible: z.boolean() }),
    lastActor: z.object({}).passthrough(),
    updatedAt: z.string(),
    reviewerContext: reviewerContextOutput.optional(),
  })
  .passthrough();
const actorOutput = z.object({
  id,
  userId: id,
  name: z.string(),
  kind: z.enum(["human", "agent", "extension"]),
  owner: z.boolean().optional(),
  primaryOwner: z.boolean().optional(),
  mustChangePassword: z.boolean().optional(),
  ownerAdmin: z.boolean().optional(),
});
const projectOutput = z.object({
  id,
  name: z.string(),
  origins: z.array(z.string()),
  captureMode: captureMode.optional(),
  repositoryUrl: z.string().nullable(),
  revision,
  permissions: z.object({
    role: z.enum(["maintainer", "reviewer", "viewer"]),
    canWrite: z.boolean(),
    canMaintain: z.boolean(),
    canResolve: z.boolean(),
  }),
});
const viewOutput = z.object({
  fingerprint: z.string(),
  uniqueLikes: z.number().int(),
  liked: z.boolean(),
  discussionCount: z.number().int(),
  weightedPreference: z.number().optional(),
});
const instructionsOutput = z.object({
  trust: z.literal("approved_project_instructions"),
  revision: z.number().int(),
  items: z.array(
    z.object({
      id,
      version: z.number().int(),
      body: z.string(),
      actor: actorOutput,
      createdAt: z.string(),
    }),
  ),
});
const reviewViewOutput = z.object({
  id,
  revision,
  name: z.string(),
  filters: reviewFiltersSchema,
});
export const outputSchemas: Record<OperationName, z.ZodObject<any>> = {
  "auth.resetPassword": z.object({
    changed: z.boolean(),
    signInRequired: z.boolean(),
  }),
  "auth.consumeLoginLink": z.object({
    actor: actorOutput,
    csrf: z.string(),
    expiresAt: z.string(),
  }),
  "account.links.create": z.object({
    id,
    loginPath: z.string(),
    expiresAt: z.string(),
  }),
  "account.links.list": z.object({
    items: z.array(
      z.object({
        id,
        expiresAt: z.string(),
        usedAt: z.string().nullable(),
        revokedAt: z.string().nullable(),
      }),
    ),
  }),
  "account.links.revoke": z.object({ revoked: z.boolean() }),
  "members.create": z.object({ id }),
  "members.resetPassword": z.object({
    updated: z.boolean(),
    resetPath: z.string().optional(),
    expiresAt: z.string().optional(),
  }),
  "members.owner": z.object({ updated: z.boolean() }),
  "members.notes.get": z.object({ body: z.string(), revision: z.number() }),
  "members.notes.save": z.object({ body: z.string(), revision: z.number() }),
  "members.guidance.get": z.object({ body: z.string(), revision: z.number() }),
  "members.guidance.save": z.object({ body: z.string(), revision: z.number() }),
  "context.reviewers": reviewerContextOutput,
  "auth.login": z.object({
    actor: actorOutput,
    csrf: z.string(),
    expiresAt: z.string(),
  }),
  "auth.acceptInvite": z.object({ accepted: z.boolean() }),
  "auth.me": z.object({
    actor: actorOutput,
    projects: z.array(projectOutput),
    csrf: z.string().optional(),
  }),
  "auth.logout": z.object({ signedOut: z.boolean() }),
  "auth.changePassword": z.object({
    changed: z.boolean(),
    signInRequired: z.boolean(),
  }),
  "projects.list": z.object({ items: z.array(projectOutput) }),
  "projects.get": projectOutput,
  "projects.create": projectOutput,
  "projects.update": projectOutput,
  "members.list": z.object({
    items: z.array(
      z.object({
        id,
        name: z.string(),
        active: z.boolean(),
        owner: z.boolean(),
        primaryOwner: z.boolean().optional(),
        username: z.string().nullable().optional(),
        role: z.string().nullable().optional(),
        can_resolve: z.boolean().nullable().optional(),
        email: z.string().optional(),
        classification: z.string().optional(),
        expertise: z.array(z.string()).optional(),
        policy: policy.optional(),
        policy_version: z.number().optional(),
        project_policy: policy.nullable().optional(),
      }),
    ),
  }),
  "members.invite": z.object({
    token: z.string(),
    expiresAt: z.string(),
    invitePath: z.string(),
  }),
  "members.grant": z.object({ updated: z.boolean() }),
  "members.update": z.object({ updated: z.boolean() }),
  "members.policy": z.object({ updated: z.boolean() }),
  "tokens.list": z.object({
    items: z.array(
      z.object({
        id,
        name: z.string(),
        kind: z.string(),
        projects: z.array(id),
        scopes: z.array(z.string()),
        canResolve: z.boolean(),
        ownerAdmin: z.boolean().optional(),
        expiresAt: z.string(),
        revokedAt: z.string().nullable(),
      }),
    ),
  }),
  "tokens.create": z.object({
    id,
    name: z.string(),
    kind: z.string(),
    token: z.string(),
    expiresAt: z.string(),
    ownerAdmin: z.boolean().optional(),
  }),
  "tokens.revoke": z.object({ revoked: z.boolean() }),
  "pairing.request": z.object({
    pairingId: id,
    deviceSecret: z.string(),
    expiresAt: z.string(),
    intervalSeconds: z.number(),
    approvalPath: z.string(),
  }),
  "pairing.approve": z.object({ approved: z.boolean(), name: z.string() }),
  "pairing.poll": z.object({
    status: z.enum(["pending", "approved"]),
    id: id.optional(),
    name: z.string().optional(),
    kind: z.string().optional(),
    token: z.string().optional(),
    expiresAt: z.string().optional(),
  }),
  "threads.list": z.object({
    items: z.array(threadOutput),
    total: z.number().int(),
    nextOffset: z.number().int().nullable(),
    websiteFilters: z.object({
      domains: z.array(z.string()),
      hostnames: z.array(z.string()),
    }),
  }),
  "threads.get": threadOutput,
  "threads.neighbors": z.object({
    previous: id.nullable(),
    next: id.nullable(),
    position: z.number().int().nullable(),
    total: z.number().int(),
  }),
  "threads.organize": threadOutput,
  "reviewViews.list": z.object({ items: z.array(reviewViewOutput) }),
  "reviewViews.save": reviewViewOutput,
  "reviewViews.delete": z.object({ deleted: z.boolean() }),
  "threads.like": discussionLikesOutput.extend({
    threadId: id,
    replyId: id.nullable(),
  }),
  "threads.create": threadOutput,
  "threads.reply": threadOutput,
  "threads.status": threadOutput,
  "threads.linkIssue": threadOutput,
  "threads.evidence": threadOutput,
  "threads.archive": threadOutput,
  "views.get": viewOutput,
  "views.like": viewOutput,
  "assets.get": assetOutput,
  "assets.upload": z.object({ asset: assetOutput, thread: threadOutput }),
  "instructions.get": instructionsOutput,
  "instructions.publish": instructionsOutput,
  "context.export": z.object({
    schemaVersion: z.literal(1),
    project: projectOutput,
    approvedInstructions: instructionsOutput,
    discussionTrust: z.literal("untrusted_discussion"),
    cursor: z.string(),
    items: z.array(threadOutput),
    snapshotId: id,
    total: z.number().int(),
    nextOffset: z.number().int().nullable(),
  }),
  "context.changes": z.object({
    schemaVersion: z.literal(1),
    items: z.array(
      z.object({
        cursor: z.string(),
        entityId: z.string(),
        kind: z.string(),
        // Discussion-like changes intentionally omit voter attribution.
        actor: actorOutput.optional(),
        createdAt: z.string(),
      }),
    ),
    cursor: z.string(),
    hasMore: z.boolean(),
  }),
};
// Preserve the existing scoped-key preset. New capabilities never enlarge old keys.
export const scopedAgentOperations = [
  "projects.list",
  "projects.get",
  "threads.list",
  "threads.get",
  "threads.reply",
  "threads.status",
  "threads.linkIssue",
  "threads.evidence",
  "assets.get",
  "instructions.get",
  "context.export",
  "context.changes",
  "context.reviewers",
  "views.get",
] as const;

export const agentTokenScopes = [
  ...scopedAgentOperations,
  "context.policy",
  "threads.neighbors",
  "threads.organize",
  "reviewViews.list",
  "reviewViews.save",
  "reviewViews.delete",
] as const;

// Authentication and browser/device transport are deliberately separate from
// business operations. Every entry uses the same input/output contract as HTTP.
export const transportOperations = [
  "auth.login",
  "auth.acceptInvite",
  "auth.resetPassword",
  "auth.consumeLoginLink",
  "auth.logout",
  "auth.changePassword",
  "pairing.request",
  "pairing.approve",
  "pairing.poll",
  "account.links.create",
] as const satisfies readonly OperationName[];
export const businessOperations = (Object.keys(inputSchemas) as OperationName[]).filter(
  (name) => !(transportOperations as readonly string[]).includes(name),
);
export const agentOperations = businessOperations;
export const ownerTokenScopes = [...businessOperations, "context.policy"];
const readOperations = new Set<string>([
  "auth.me",
  "projects.list",
  "projects.get",
  "members.list",
  "members.notes.get",
  "members.guidance.get",
  "account.links.list",
  "tokens.list",
  "threads.list",
  "threads.get",
  "threads.neighbors",
  "reviewViews.list",
  "views.get",
  "assets.get",
  "instructions.get",
  "context.export",
  "context.changes",
  "context.reviewers",
]);
export const operationRegistry = Object.fromEntries(
  businessOperations.map((name) => [
    name,
    {
      input: inputSchemas[name],
      output: outputSchemas[name],
      readOnly: readOperations.has(name),
    },
  ]),
) as Record<string, { input: z.ZodType; output: z.ZodObject<any>; readOnly: boolean }>;
