import { z } from "zod";
import {
  id,
  name,
  revision,
  policy,
  contextTextInput,
  contextTextOutput,
} from "../common.js";
import { actorOutput, projectOutput } from "../output-common.js";

export const identityInputs = {
  "members.profile.get": z.object({ userId: id.optional(), projectId: id.optional() }),
  "members.profile.save": z.object({
    userId: id.optional(),
    ...contextTextInput,
    currentWork: z.string().max(300).optional(),
  }),
  "members.responsibility.get": z.object({ projectId: id, userId: id.optional() }),
  "members.responsibility.save": z.object({
    projectId: id,
    userId: id.optional(),
    ...contextTextInput,
  }),
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
  "auth.logout": z.object({}),
  "auth.changePassword": z.object({
    currentPassword: z.string().max(1024),
    password: z.string().min(10).max(1024),
  }),
  "members.list": z.object({
    projectId: id.optional(),
    includeRemoved: z.boolean().optional(),
  }),
  "members.archive": z.object({ userId: id, archived: z.boolean() }),
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
};

export const identityOutputs = {
  "members.profile.get": contextTextOutput,
  "members.profile.save": contextTextOutput,
  "members.responsibility.get": contextTextOutput,
  "members.responsibility.save": contextTextOutput,
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
  "members.archive": z.object({ updated: z.boolean() }),
  "members.notes.get": z.object({ body: z.string(), revision: z.number() }),
  "members.notes.save": z.object({ body: z.string(), revision: z.number() }),
  "members.guidance.get": z.object({ body: z.string(), revision: z.number() }),
  "members.guidance.save": z.object({ body: z.string(), revision: z.number() }),
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
  "members.list": z.object({
    items: z.array(
      z.object({
        id,
        name: z.string(),
        active: z.boolean(),
        removedAt: z.string().nullable().optional(),
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
        secretSuffix: z.string().nullable().optional(),
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
};
