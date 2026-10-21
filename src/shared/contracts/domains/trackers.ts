import { z } from "zod";
import { id } from "../common.js";

export const trackerProvider = z.enum([
  "jira",
  "linear",
  "asana",
  "clickup",
  "monday",
  "trello",
  "productive",
  "teamwork",
  "firmao",
  "openproject",
]);
export type TrackerProvider = z.infer<typeof trackerProvider>;
export const trackerInstanceOrigin = z
  .string()
  .max(500)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        url.origin === value &&
        !url.username &&
        !url.password
      );
    } catch {
      return false;
    }
  }, "Use an exact HTTPS origin without a path, credentials or query");
export const trackerStates = [
  "open",
  "in_progress",
  "ready_for_review",
  "resolved",
  "declined",
  "closed",
] as const;
const remoteId = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9_-]+$/);
const remoteState = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[^\x00-\x1f]+$/);
export const trackerConfiguration = z
  .object({
    targetId: remoteId,
    workspaceId: remoteId.optional(),
    secondaryId: remoteId.optional(),
    assigneeId: z
      .string()
      .regex(/^[1-9]\d{0,15}$/)
      .refine(
        (value) => Number.isSafeInteger(Number(value)),
        "Use a safe numeric user ID",
      )
      .optional(),
    statusColumn: remoteId.default("status"),
    descriptionColumnType: z.enum(["text", "long_text"]).optional(),
    site: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/)
      .optional(),
    cloudId: z.string().uuid().optional(),
    issueTypeId: remoteId.optional(),
    instanceOrigin: trackerInstanceOrigin.optional(),
    states: z
      .array(
        z.object({
          local: z.enum(trackerStates),
          remote: remoteState,
          transition: remoteId.optional(),
        }),
      )
      .max(6)
      .default([]),
    poll: z.boolean().default(false),
  })
  .superRefine((value, context) => {
    if (
      new Set(value.states.map((entry) => entry.local)).size !== value.states.length ||
      new Set(value.states.map((entry) => entry.remote)).size !== value.states.length
    )
      context.addIssue({ code: "custom", message: "Status mappings must be one-to-one" });
  });
export type TrackerConfiguration = z.infer<typeof trackerConfiguration>;
export const trackerCredential = z.object({
  token: z.string().trim().min(5).max(16000),
  key: z.string().trim().max(1000).optional(),
  username: z
    .string()
    .trim()
    .min(1)
    .max(254)
    .regex(/^[^:\r\n]+$/)
    .optional(),
  refreshToken: z.string().trim().max(16000).optional(),
  expiresAt: z.string().datetime().optional(),
  auth: z.enum(["token", "oauth", "basic"]).default("token"),
});
export type TrackerCredential = z.infer<typeof trackerCredential>;
export const trackerDiscoverySelection = z.object({
  workspaceId: remoteId.optional(),
  spaceId: remoteId.optional(),
  folderId: remoteId.optional(),
  targetId: remoteId.optional(),
  secondaryId: remoteId.optional(),
  statusColumn: remoteId.optional(),
  issueTypeId: remoteId.optional(),
  site: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/)
    .optional(),
  cloudId: z.string().uuid().optional(),
  instanceOrigin: trackerInstanceOrigin.optional(),
});
export type TrackerDiscoverySelection = z.infer<typeof trackerDiscoverySelection>;
export const trackerDiscoveryResult = z.object({
  step: z.enum([
    "workspaces",
    "spaces",
    "folders",
    "targets",
    "issueTypes",
    "columns",
    "ready",
  ]),
  title: z.string().max(100),
  choices: z
    .array(
      z.object({
        id: remoteId,
        name: z.string().min(1).max(300),
        selection: trackerDiscoverySelection,
      }),
    )
    .max(100),
  hasMore: z.boolean(),
  nextCursor: z.string().max(1000).optional(),
  configuration: trackerConfiguration.optional(),
  targetName: z.string().max(300).optional(),
  states: z
    .array(z.object({ id: remoteState, name: z.string().min(1).max(300) }))
    .max(1000),
});
export type TrackerDiscoveryResult = z.infer<typeof trackerDiscoveryResult>;
const connection = z.object({
  id,
  projectId: id,
  provider: trackerProvider,
  label: z.string(),
  configuration: trackerConfiguration,
  revision: z.number().int(),
  enabled: z.boolean(),
  health: z.string(),
  errorCode: z.string().nullable(),
  checkedAt: z.string().nullable(),
  createdAt: z.string(),
});
const link = z.object({
  historical: z.boolean(),
  id,
  connectionId: id,
  threadId: id,
  remoteId: z.string(),
  url: z.string(),
  title: z.string(),
  remoteState: z.string(),
  localState: z.string(),
  status: z.string(),
  checkedAt: z.string().nullable(),
});
const job = z.object({
  historical: z.boolean(),
  id,
  connectionId: id,
  threadId: id,
  kind: z.string(),
  status: z.string(),
  attempts: z.number().int(),
  errorCode: z.string().nullable(),
  createdAt: z.string(),
  remoteId: z.string().nullable(),
});
const write = {
  connectionId: id,
  threadId: id,
  revision: z.number().int().positive(),
  idempotencyKey: z.string().min(8).max(120),
};
export const trackersInputs = {
  "trackers.accounts": z.object({ projectId: id, provider: trackerProvider }),
  "trackers.discover": z
    .object({
      projectId: id,
      provider: trackerProvider,
      credential: trackerCredential.optional(),
      sourceConnectionId: id.optional(),
      sourceRevision: z.number().int().positive().optional(),
      selection: trackerDiscoverySelection.default({}),
      cursor: z
        .string()
        .min(1)
        .max(1000)
        .regex(/^[A-Za-z0-9_+=:.,/-]+$/)
        .optional(),
    })
    .superRefine((value, context) => {
      if (
        !!value.credential === !!value.sourceConnectionId ||
        !!value.sourceConnectionId !== !!value.sourceRevision
      )
        context.addIssue({
          code: "custom",
          message: "Choose one credential source and its current revision",
        });
    }),
  "trackers.oauthStart": z.object({
    projectId: id,
    provider: z.literal("jira"),
    label: z.string().trim().min(1).max(100),
    configuration: trackerConfiguration,
  }),
  "trackers.oauthComplete": z.object({
    flowId: id,
    cloudId: z.string().uuid().optional(),
  }),
  "trackers.list": z.object({ projectId: id }),
  "trackers.save": z
    .object({
      projectId: id,
      connectionId: id.optional(),
      revision: z.number().int().positive().optional(),
      provider: trackerProvider,
      label: z.string().trim().min(1).max(100),
      configuration: trackerConfiguration,
      credential: trackerCredential.optional(),
      reuseConnectionId: id.optional(),
      reuseRevision: z.number().int().positive().optional(),
      verifyDestination: z.boolean().default(false),
      idempotencyKey: z.string().min(8).max(120).optional(),
    })
    .superRefine((value, context) => {
      if (
        (value.credential && value.reuseConnectionId) ||
        !!value.reuseConnectionId !== !!value.reuseRevision
      )
        context.addIssue({
          code: "custom",
          message: "Choose one credential source and its current revision",
        });
      if (value.connectionId && value.idempotencyKey)
        context.addIssue({
          code: "custom",
          message: "Retry keys are for new connections",
        });
    }),
  "trackers.enable": z.object({
    connectionId: id,
    revision: z.number().int().positive(),
    enabled: z.boolean(),
  }),
  "trackers.test": z.object({ connectionId: id }),
  "trackers.links": z.object({ threadId: id }),
  "trackers.comments": z.object({ connectionId: id, threadId: id, remoteId }),
  "trackers.refresh": z.object({ connectionId: id, threadId: id, linkId: id }),
  "trackers.create": z.object({
    ...write,
    title: z.string().trim().min(1).max(250),
    body: z.string().max(30000),
  }),
  "trackers.link": z.object({ ...write, remoteId }),
  "trackers.comment": z.object({
    ...write,
    linkId: id,
    body: z.string().trim().min(1).max(12000),
  }),
  "trackers.sync": z.object({
    ...write,
    linkId: id,
    source: z.enum(["feedbacks", "provider"]),
    expectedRemoteState: remoteState,
  }),
  "trackers.reconcile": z.object({
    jobId: id,
    remoteId: remoteId.optional(),
    outcome: z.enum(["linked", "confirmed_delivered", "confirmed_not_delivered"]),
  }),
};
export const trackersOutputs = {
  "trackers.accounts": z.object({
    accounts: z
      .array(
        z.object({
          connectionId: id,
          revision: z.number().int().positive(),
          label: z.string(),
          projectName: z.string(),
          selection: trackerDiscoverySelection,
        }),
      )
      .max(100),
  }),
  "trackers.discover": trackerDiscoveryResult,
  "trackers.oauthStart": z.object({
    flowId: id,
    authorizeUrl: z.string().url(),
    expiresAt: z.string(),
  }),
  "trackers.oauthComplete": z.object({
    status: z.enum(["pending", "choose_site", "connected"]),
    connection: connection.optional(),
    resources: z
      .array(z.object({ id: z.string(), name: z.string(), url: z.string() }))
      .optional(),
  }),
  "trackers.list": z.object({ connections: z.array(connection), jobs: z.array(job) }),
  "trackers.save": connection,
  "trackers.enable": connection,
  "trackers.test": z.object({
    healthy: z.boolean(),
    targetName: z.string(),
    states: z.array(z.object({ id: z.string(), name: z.string() })),
    errorCode: z.string().nullable(),
  }),
  "trackers.links": z.object({ links: z.array(link), jobs: z.array(job) }),
  "trackers.comments": z.object({
    items: z.array(
      z.object({
        id: z.string(),
        body: z.string(),
        author: z.string().nullable(),
        createdAt: z.string().nullable(),
      }),
    ),
    hasMore: z.boolean(),
  }),
  "trackers.refresh": link,
  "trackers.create": job,
  "trackers.link": job,
  "trackers.comment": job,
  "trackers.sync": job,
  "trackers.reconcile": job,
};
