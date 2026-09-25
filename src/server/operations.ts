import type { Database } from "./db.js";
import type { Config } from "./config.js";
import {
  inputSchemas,
  agentTokenScopes,
  ownerTokenScopes,
  type Actor,
  type OperationName,
} from "../shared/contracts.js";
import { Auth, accountLock } from "./auth.js";
import { accounts, reviewerContext } from "./accounts.js";
import { access, event, ownerOnly } from "./access.js";
import { projects, members } from "./projects.js";
import { feedback } from "./feedback.js";
import {
  assets,
  assetRow,
  assetPreview,
  assetUploadPreflight,
  prepareAssetUpload,
  prepareVideoUpload,
  commitAssetUpload,
  type AssetStore,
} from "./assets.js";
import { instructions, context } from "./context.js";
import { reviewViews } from "./review-views.js";
import { views } from "./views.js";
import { DomainError, fail } from "./errors.js";
import { reserveExportRequest } from "./export-limits.js";
import { manageGuestLinks } from "./guest-links.js";
import { GithubApp } from "./github-app.js";
import { githubOperation } from "./github-operations.js";
import { manageGuestProjectLinks } from "./guest-project-links.js";
import { manageWebhooks } from "./webhooks.js";
import { manageQa, compareQaImages } from "./scheduled-qa.js";
import { manageSurveys } from "./surveys.js";
import {
  documents,
  documentUploadPreflight,
  prepareDocumentUpload,
  commitDocumentUpload,
} from "./documents.js";
export class Operations {
  readonly auth: Auth;
  constructor(
    public db: Database,
    public store: AssetStore,
    public config: Config,
    private github: GithubApp = new GithubApp(config),
  ) {
    this.auth = new Auth(db);
  }
  async executeOperation(actor: Actor, name: string, input: unknown): Promise<any> {
    if (!Object.hasOwn(inputSchemas, name)) fail("NOT_FOUND", "Unknown operation", 404);
    const parsed = inputSchemas[name as OperationName].safeParse(input);
    if (!parsed.success)
      fail(
        "VALIDATION",
        parsed.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join(";"),
      );
    if (name === "assets.upload" || name === "assets.uploadVideo")
      return this.uploadAsset(actor, parsed.data);
    if (name === "documents.upload") return this.uploadDocument(actor, parsed.data);
    if (name === "qa.compare")
      return compareQaImages(this.db, actor, this.store, parsed.data as any);
    if (name.startsWith("github."))
      return githubOperation(this.db, actor, name, parsed.data, this.config, this.github);
    if (name === "context.export" && !(parsed.data as any).snapshotId)
      await reserveExportRequest(this.db, actor, (parsed.data as any).projectId);
    let preview: { objectKey: string; maxDimension: number } | undefined;
    const result = await this.db
      .transaction(async (db) => {
        // Serialize before current-auth reads under READ COMMITTED, including exports:
        // waiting requests must see revocation committed by the previous lock holder.
        await accountLock(db);
        const auth = new Auth(db),
          a = await this.currentForOperation(db, actor, name),
          i: any = parsed.data;
        if (name === "auth.me")
          return {
            actor: {
              id: a.id,
              userId: a.userId,
              name: a.name,
              kind: a.kind,
              owner: a.kind === "human" && a.owner,
              ownerAdmin: !!a.ownerAdmin,
              primaryOwner: a.primaryOwner,
              mustChangePassword: a.mustChangePassword,
            },
            projects: a.mustChangePassword
              ? []
              : (await projects(db, a, "projects.list", {})).items,
          };
        if (name === "auth.changePassword")
          return auth.changePassword(a, i.currentPassword, i.password);
        if (
          [
            "members.create",
            "members.resetPassword",
            "members.owner",
            "members.archive",
          ].includes(name) ||
          name.startsWith("account.links.") ||
          name.startsWith("members.notes.") ||
          name.startsWith("members.guidance.")
        ) {
          const result = await accounts(db, a, name, i);
          // Audit identity/action only: never passwords, links or Markdown bodies.
          await event(db, a, null, i.userId ?? result.id ?? a.userId, name, {});
          return result;
        }
        if (name === "context.reviewers") return reviewerContext(db, a, i.projectId);
        if (name.startsWith("projects.")) return projects(db, a, name, i);
        if (name.startsWith("webhooks.")) return manageWebhooks(db, a, name, i);
        if (name.startsWith("qa.")) return manageQa(db, a, name, i);
        if (name.startsWith("surveys."))
          return manageSurveys(db, a, name, i, this.config);
        if (name.startsWith("documents.")) return documents(db, a, name, i);
        if (name.startsWith("guestLinks."))
          return manageGuestLinks(db, a, name, i, this.config);
        if (name.startsWith("guestProjectLinks."))
          return manageGuestProjectLinks(db, a, name, i, this.config);
        if (name.startsWith("members.")) return members(db, a, name, i);
        if (name.startsWith("threads.")) return feedback(db, a, name, i, this.config);
        if (name.startsWith("reviewViews.")) return reviewViews(db, a, name, i);
        if (name.startsWith("views.")) return views(db, a, name, i);
        if (name.startsWith("assets.")) {
          const result = await assets(db, a, i);
          if (name === "assets.get" && i.includeImage) {
            const row = await assetRow(db, a, i.assetId);
            if (row.data.contentType !== "image/webp")
              fail("VALIDATION", "Video has no image preview");
            preview = { objectKey: row.object_key, maxDimension: i.maxDimension };
          }
          return result;
        }
        if (name.startsWith("instructions.")) return instructions(db, a, name, i);
        if (name.startsWith("context.")) return context(db, a, name, i);
        if (name === "auth.logout") {
          if (a.sessionHash)
            await db.query("DELETE FROM sessions WHERE hash=$1", [a.sessionHash]);
          return { signedOut: true };
        }
        if (name === "tokens.list") {
          if (a.kind !== "human") ownerOnly(a);
          return {
            items: await db.query(
              'SELECT id,name,kind,projects,scopes,can_resolve AS "canResolve",owner_admin AS "ownerAdmin",secret_suffix AS "secretSuffix",expires_at AS "expiresAt",revoked_at AS "revokedAt" FROM tokens WHERE user_id=$1 ORDER BY expires_at DESC',
              [a.userId],
            ),
          };
        }
        if (name === "tokens.create") {
          ownerOnly(a);
          if (a.kind !== "human")
            fail(
              "FORBIDDEN",
              "A human owner must issue keys; agent keys cannot create descendants",
              403,
            );
          const allowed = new Set<string>(
            i.ownerAdmin ? ownerTokenScopes : agentTokenScopes,
          );
          if (i.scopes.some((s: string) => !allowed.has(s)))
            fail("VALIDATION", "Unsupported agent scope");
          if (!i.ownerAdmin && !i.projectIds.length)
            fail("VALIDATION", "Select at least one project for a scoped key");
          for (const id of i.projectIds)
            await access(db, a, id, i.canResolve ? "resolve" : "read");
          const result = await this.auth.issueToken(db, a, i);
          await event(db, a, null, result.id, name, {
            scopes: i.scopes,
            projectIds: i.projectIds,
            ownerAdmin: i.ownerAdmin,
          });
          return result;
        }
        if (name === "tokens.revoke") {
          if (a.kind !== "human") ownerOnly(a);
          const token = await db.one(
            "UPDATE tokens SET revoked_at=now() WHERE id=$1 AND (user_id=$2 OR $3=true) RETURNING id",
            [i.tokenId, a.userId, a.owner],
          );
          if (!token) fail("NOT_FOUND", "Token not found", 404);
          await event(db, a, null, i.tokenId, name, {});
          return { revoked: true };
        }
        if (name === "pairing.approve") {
          if (a.kind !== "human") fail("FORBIDDEN", "Sign in to approve a device", 403);
          const p = await db.one(
            "UPDATE pairing SET approved_by=$1 WHERE id=$2 AND expires_at>now() AND approved_by IS NULL AND consumed_at IS NULL RETURNING id,name",
            [a.userId, i.pairingId],
          );
          if (!p) fail("PAIRING_EXPIRED", "Pairing expired or already approved", 410);
          await event(db, a, null, p.id, name, {});
          return { approved: true, name: p.name };
        }
        return fail(
          "NOT_FOUND",
          "Operation requires its public authentication endpoint",
          404,
        );
      })
      .then((result) => JSON.parse(JSON.stringify(result)));
    if (preview)
      result.image = await assetPreview(
        this.store,
        preview.objectKey,
        preview.maxDimension,
      );
    return result;
  }

  private async currentForOperation(db: Database, actor: Actor, name: string) {
    const a = await new Auth(db).current(actor);
    // Existing paired extensions already hold the asset-upload grant.
    const hasScope =
      a.scopes?.includes(name) ||
      (name === "assets.uploadVideo" && a.scopes?.includes("assets.upload"));
    if (a.scopes && !hasScope) fail("FORBIDDEN", "Operation outside token scope", 403);
    if (
      a.mustChangePassword &&
      !["auth.me", "auth.changePassword", "auth.logout"].includes(name)
    )
      fail(
        "PASSWORD_CHANGE_REQUIRED",
        "Replace your temporary password before continuing",
        403,
      );
    return a;
  }

  private async uploadAsset(actor: Actor, i: any) {
    // Keep the organization lock only around authorization and database writes.
    // Image decoding and private object storage can take seconds.
    const preflight = await this.db.transaction(async (db) => {
      await accountLock(db);
      const a = await this.currentForOperation(
        db,
        actor,
        i.videoBase64 === undefined ? "assets.upload" : "assets.uploadVideo",
      );
      return assetUploadPreflight(db, a, i);
    });
    if (preflight.prior) return JSON.parse(JSON.stringify(preflight.prior));

    const prepared =
      i.videoBase64 === undefined
        ? await prepareAssetUpload(i, this.config, preflight.projectId)
        : await prepareVideoUpload(i, this.config, preflight.projectId);
    let committed = false;
    let cleanupAllowed = true;
    try {
      try {
        await this.store.put(prepared.key, prepared.output, prepared.data.contentType);
      } catch {
        fail(
          "UPLOAD_FAILED",
          "Private asset storage is unavailable; your draft can be retried",
          503,
        );
      }
      // A transport error during COMMIT has an unknown outcome. Preserve the
      // private object in that case so a committed asset never loses its bytes.
      cleanupAllowed = false;
      let settled;
      try {
        settled = await this.db.transaction(async (db) => {
          await accountLock(db);
          const a = await this.currentForOperation(
            db,
            actor,
            i.videoBase64 === undefined ? "assets.upload" : "assets.uploadVideo",
          );
          return commitAssetUpload(db, a, i, prepared);
        });
      } catch (error) {
        if (error instanceof DomainError) cleanupAllowed = true;
        throw error;
      }
      committed = settled.committed;
      cleanupAllowed = !committed;
      return JSON.parse(JSON.stringify(settled.result));
    } finally {
      if (!committed && cleanupAllowed)
        await this.store.remove(prepared.key).catch(() => {
          console.error("Uncommitted image cleanup failed");
        });
    }
  }

  private async uploadDocument(actor: Actor, input: any) {
    const prior = await this.db.transaction(async (db) => {
      await accountLock(db);
      const current = await this.currentForOperation(db, actor, "documents.upload");
      return documentUploadPreflight(db, current, input);
    });
    if (prior) return prior;
    const prepared = await prepareDocumentUpload(input, this.config);
    let committed = false;
    let cleanupAllowed = true;
    try {
      try {
        await this.store.put(
          prepared.key,
          prepared.output,
          String(prepared.data.contentType),
        );
      } catch {
        fail(
          "UPLOAD_FAILED",
          "Private document storage is unavailable; retry your upload",
          503,
        );
      }
      cleanupAllowed = false;
      let settled;
      try {
        settled = await this.db.transaction(async (db) => {
          await accountLock(db);
          const current = await this.currentForOperation(db, actor, "documents.upload");
          return commitDocumentUpload(db, current, input, prepared);
        });
      } catch (error) {
        if (error instanceof DomainError) cleanupAllowed = true;
        throw error;
      }
      committed = settled.committed;
      cleanupAllowed = !committed;
      return settled.result;
    } finally {
      if (!committed && cleanupAllowed)
        await this.store
          .remove(prepared.key)
          .catch(() => console.error("Uncommitted document cleanup failed"));
    }
  }
}
