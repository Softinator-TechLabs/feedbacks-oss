import { z } from "zod";
import { inputSchemas, outputSchemas, type OperationName } from "./registry.js";

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
  "assignments.delegations",
  "assignments.assign",
  "assignments.cancel",
  "assignments.history",
  "assignments.list",
  "assignments.claim",
  "assignments.renew",
  "assignments.release",
  "auth.me",
  "members.list",
  "members.profile.get",
  "members.profile.save",
  "members.responsibility.get",
  "members.responsibility.save",
  "projects.context.get",
  "projects.context.save",
  "projects.taxonomy.get",
  "recordings.list",
  "recordings.get",
  "recordings.events",
  "recordings.export",
  "diagnostics.begin",
  "diagnostics.putChunk",
  "diagnostics.finalize",
  "diagnostics.list",
  "diagnostics.describe",
  "diagnostics.read",
  "diagnostics.search",
  ...scopedAgentOperations,
  "threads.annotationStatus",
  "threads.annotationPlan",
  "qa.get",
  "qa.runs",
  "qa.baselineGet",
  "qa.compare",
  "documents.list",
  "documents.get",
  "documents.threads",
  "context.policy",
  "threads.neighbors",
  "threads.issueDraft",
  "github.issueCreate",
  "threads.plan",
  "threads.organize",
  "threads.priority",
  "threads.move",
  "reviewViews.list",
  "reviewViews.save",
  "reviewViews.delete",
] as const;

// Self-service never delegates owner-only policy visibility or external GitHub writes.
export const selfAgentOptionalScopes = ["github.issueCreate"] as const;
export const selfAgentTokenScopes = agentTokenScopes.filter(
  (name) => !["context.policy", "context.reviewers", "github.issueCreate"].includes(name),
);
export const profileOnlyAgentScopes = [
  "auth.me",
  "projects.list",
  "members.profile.get",
  "members.profile.save",
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
export const agentOperations = businessOperations.filter(
  (name) =>
    name !== "members.archive" &&
    name !== "threads.review" &&
    !["threads.delete", "threads.deletions", "threads.retryDeletion"].includes(name) &&
    name !== "threads.figmaReference" &&
    !name.startsWith("webhooks.") &&
    name !== "documents.upload" &&
    (name === "github.issueCreate" || !name.startsWith("github.")),
);
// The one-click owner setup must not silently grant external GitHub writes.
// Issue creation is available only through a separately issued scoped key.
export const ownerTokenScopes = [
  ...agentOperations.filter(
    (name) =>
      name !== "github.issueCreate" &&
      !name.startsWith("recordings.") &&
      !name.startsWith("diagnostics."),
  ),
  "context.policy",
];
const readOperations = new Set<string>([
  "assignments.delegations",
  "assignments.history",
  "assignments.list",
  "members.profile.get",
  "members.responsibility.get",
  "projects.context.get",
  "threads.deletions",
  "auth.me",
  "projects.list",
  "projects.get",
  "projects.taxonomy.get",
  "surveys.list",
  "surveys.results",
  "documents.list",
  "documents.get",
  "documents.threads",
  "github.connection",
  "github.issueState",
  "github.statusSyncState",
  "webhooks.get",
  "webhooks.deliveries",
  "qa.get",
  "qa.runs",
  "qa.baselineGet",
  "qa.compare",
  "members.list",
  "members.notes.get",
  "members.guidance.get",
  "account.links.list",
  "tokens.list",
  "threads.list",
  "threads.get",
  "threads.issueDraft",
  "threads.neighbors",
  "reviewViews.list",
  "views.get",
  "assets.get",
  "recordings.list",
  "recordings.get",
  "recordings.events",
  "recordings.export",
  "diagnostics.list",
  "diagnostics.describe",
  "diagnostics.read",
  "diagnostics.search",
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
