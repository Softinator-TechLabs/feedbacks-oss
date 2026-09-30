import { currentGithubApp } from "../github-managed-apps.js";
import type { Actor } from "../../shared/contracts.js";
import type { Database } from "../db.js";
import type { Config } from "../config.js";
import { accountLock } from "../auth.js";
import { access, event, ownerOnly } from "../access.js";
import { GithubApp, githubRepo } from "../github-app.js";
import { connectedGithubRepos, hasConnectedGithubRepo } from "../github-repositories.js";
import { DomainError, fail } from "../errors.js";
import { configuredGithubApps, projectGithubAppId } from "../github-app-config.js";
import { human } from "./operation-common.js";

export const connectionOperationNames = new Set([
  "github.apps",
  "github.appSelect",
  "github.connection",
  "github.connect",
  "github.disconnect",
  "github.repositoryConnect",
  "github.repositoryDisconnect",
  "github.statusSyncConfigure",
]);

export async function githubConnectionOperation(
  db: Database,
  actor: Actor,
  name: string,
  i: any,
  config: Config,
  client: GithubApp,
) {
  if (name === "github.apps")
    return db.transaction(async (tx) => {
      await accountLock(tx);
      const a = await human(tx, actor);
      ownerOnly(a);
      return {
        defaultAppId: config.githubAppId ?? null,
        apps: configuredGithubApps(config).map(({ id, name, slug, owners }) => ({
          id,
          name,
          slug,
          owners,
        })),
      };
    });
  if (name === "github.appSelect")
    return db.transaction(async (tx) => {
      await accountLock(tx);
      const a = await human(tx, actor);
      ownerOnly(a);
      const project = await access(tx, a, i.projectId, "maintain");
      if (project.revision !== i.revision)
        fail("CONFLICT", "Project changed; reload first", 409);
      if (i.appId !== null) await currentGithubApp(tx, config, i.appId);
      if (project.githubAppId !== undefined && project.githubAppId === i.appId)
        return project;
      const identityChanged = projectGithubAppId(config, project) !== i.appId;
      if (identityChanged) {
        const pending = await tx.one(
          `SELECT 1 FROM github_issue_requests WHERE project_id=$1 AND status='pending'
        UNION ALL SELECT 1 FROM github_status_sync s JOIN threads t ON t.id=s.thread_id
        WHERE t.project_id=$1 AND (s.status='uncertain' OR s.lease_until>clock_timestamp()) LIMIT 1`,
          [project.id],
        );
        if (pending)
          fail(
            "GITHUB_PENDING",
            "Reconcile pending GitHub writes or wait for active sync before changing the App.",
            409,
          );
        await tx.query(
          `UPDATE projects SET data=data || jsonb_build_object('githubAppId',$2::text,
        'githubConnected',false,'githubStatusSync',false,'githubRepositories','[]'::jsonb),revision=revision+1 WHERE id=$1`,
          [project.id, i.appId],
        );
        await tx.query(
          "DELETE FROM github_status_sync WHERE thread_id IN (SELECT id FROM threads WHERE project_id=$1)",
          [project.id],
        );
      } else {
        await tx.query(
          "UPDATE projects SET data=data || jsonb_build_object('githubAppId',$2::text),revision=revision+1 WHERE id=$1",
          [project.id, i.appId],
        );
      }
      await event(tx, a, project.id, project.id, name, {
        appId: i.appId,
        previousAppId: projectGithubAppId(config, project),
      });
      return access(tx, a, project.id);
    });
  if (name === "github.connection") {
    const connection = await db.transaction(async (tx) => {
      await accountLock(tx);
      const a = await human(tx, actor);
      const project = await access(tx, a, i.projectId);
      const appId = projectGithubAppId(config, project);
      const apps = configuredGithubApps(config);
      const app = apps.find((app) => app.id === appId);
      return {
        appId,
        appName: app?.name ?? null,
        approvedAccounts: app?.owners ?? [],
        canSelectApp: a.owner === true,
        apps: a.owner
          ? apps.map(({ id, name, slug, owners }) => ({ id, name, slug, owners }))
          : [],
        configured: !!app,
        connected: project.githubConnected === true,
        statusSyncEnabled: project.githubStatusSync === true,
        repositoryUrl: project.repositoryUrl ?? null,
        connectedRepositories: connectedGithubRepos(project).map(
          (repo) => `https://github.com/${repo.fullName}`,
        ),
        installUrl: app ? `https://github.com/apps/${app.slug}/installations/new` : null,
      };
    });
    let installation:
      | "not_configured"
      | "no_repository"
      | "installed"
      | "not_installed"
      | "unavailable" = !connection.configured
      ? "not_configured"
      : !connection.repositoryUrl
        ? "no_repository"
        : "unavailable";
    const repositoryUrls = [
      ...new Set(
        [...connection.connectedRepositories, connection.repositoryUrl].filter(
          (value): value is string => !!value,
        ),
      ),
    ].slice(0, 21);
    const repositories = await Promise.all(
      repositoryUrls.map(async (repositoryUrl) => {
        let state: "installed" | "not_installed" | "unavailable" = "unavailable";
        if (connection.configured) {
          try {
            await client.forApp(connection.appId).check(githubRepo(repositoryUrl));
            state = "installed";
          } catch (error) {
            if (error instanceof DomainError && error.code === "GITHUB_NOT_INSTALLED")
              state = "not_installed";
          }
        }
        return {
          repositoryUrl,
          connected: connection.connectedRepositories.some(
            (url) => url.toLowerCase() === repositoryUrl.toLowerCase(),
          ),
          installation: state,
        };
      }),
    );
    if (connection.configured && connection.repositoryUrl)
      installation =
        repositories.find(
          (repo) =>
            repo.repositoryUrl.toLowerCase() === connection.repositoryUrl?.toLowerCase(),
        )?.installation ?? "unavailable";
    const { connectedRepositories: _connectedRepositories, ...summary } = connection;
    return { ...summary, installation, repositories };
  }
  if (name === "github.connect") {
    const target = await db.transaction(async (tx) => {
      await accountLock(tx);
      const a = await human(tx, actor);
      const project = await access(tx, a, i.projectId, "maintain");
      if (project.revision !== i.revision)
        fail("CONFLICT", "Project changed; reload first", 409);
      const appId = projectGithubAppId(config, project);
      await currentGithubApp(tx, config, appId);
      return { repo: githubRepo(project.repositoryUrl), appId };
    });
    const { repo, appId } = target;
    await client.forApp(appId).check(repo);
    return db.transaction(async (tx) => {
      await accountLock(tx);
      const a = await human(tx, actor);
      const project = await access(tx, a, i.projectId, "maintain");
      if (
        project.revision !== i.revision ||
        projectGithubAppId(config, project) !== appId ||
        githubRepo(project.repositoryUrl).fullName.toLowerCase() !==
          repo.fullName.toLowerCase()
      )
        fail("CONFLICT", "Project changed while checking GitHub", 409);
      await currentGithubApp(tx, config, appId, repo.owner);
      if (
        !hasConnectedGithubRepo(project, repo) &&
        connectedGithubRepos(project).length >= 20
      )
        fail("LIMIT", "A project can connect up to 20 GitHub repositories", 400);
      await tx.query(
        "UPDATE projects SET data=data || jsonb_build_object('githubConnected',true,'githubRepositories',$2::jsonb),revision=revision+1 WHERE id=$1",
        [
          project.id,
          JSON.stringify([
            ...new Set([
              ...connectedGithubRepos(project).map(
                (connected) => `https://github.com/${connected.fullName}`,
              ),
              `https://github.com/${repo.fullName}`,
            ]),
          ]),
        ],
      );
      await event(tx, a, project.id, project.id, name, { repository: repo.fullName });
      return access(tx, a, project.id);
    });
  }
  if (name === "github.disconnect")
    return db.transaction(async (tx) => {
      await accountLock(tx);
      const a = await human(tx, actor);
      const project = await access(tx, a, i.projectId, "maintain");
      if (project.revision !== i.revision)
        fail("CONFLICT", "Project changed; reload first", 409);
      await tx.query(
        "UPDATE projects SET data=data || jsonb_build_object('githubConnected',false,'githubStatusSync',false,'githubRepositories','[]'::jsonb),revision=revision+1 WHERE id=$1",
        [project.id],
      );
      await event(tx, a, project.id, project.id, name, {});
      return access(tx, a, project.id);
    });
  if (name === "github.repositoryConnect") {
    const repo = githubRepo(i.repositoryUrl);
    const appId = await db.transaction(async (tx) => {
      await accountLock(tx);
      const a = await human(tx, actor);
      const project = await access(tx, a, i.projectId, "maintain");
      if (project.revision !== i.revision)
        fail("CONFLICT", "Project changed; reload first", 409);
      if (
        !hasConnectedGithubRepo(project, repo) &&
        connectedGithubRepos(project).length >= 20
      )
        fail("LIMIT", "A project can connect up to 20 GitHub repositories", 400);
      const appId = projectGithubAppId(config, project);
      await currentGithubApp(tx, config, appId, repo.owner);
      return appId;
    });
    await client.forApp(appId).check(repo);
    return db.transaction(async (tx) => {
      await accountLock(tx);
      const a = await human(tx, actor);
      const project = await access(tx, a, i.projectId, "maintain");
      if (
        project.revision !== i.revision ||
        projectGithubAppId(config, project) !== appId
      )
        fail("CONFLICT", "Project changed while checking GitHub", 409);
      await currentGithubApp(tx, config, appId, repo.owner);
      const urls = connectedGithubRepos(project).map(
        (connected) => `https://github.com/${connected.fullName}`,
      );
      if (!hasConnectedGithubRepo(project, repo))
        urls.push(`https://github.com/${repo.fullName}`);
      if (urls.length > 20) fail("LIMIT", "Too many repositories", 400);
      await tx.query(
        "UPDATE projects SET data=data || jsonb_build_object('githubConnected',true,'githubRepositories',$2::jsonb),revision=revision+1 WHERE id=$1",
        [project.id, JSON.stringify(urls)],
      );
      await event(tx, a, project.id, project.id, name, { repository: repo.fullName });
      return access(tx, a, project.id);
    });
  }
  if (name === "github.repositoryDisconnect")
    return db.transaction(async (tx) => {
      await accountLock(tx);
      const a = await human(tx, actor);
      const project = await access(tx, a, i.projectId, "maintain");
      if (project.revision !== i.revision)
        fail("CONFLICT", "Project changed; reload first", 409);
      const repo = githubRepo(i.repositoryUrl);
      if (!hasConnectedGithubRepo(project, repo))
        fail("GITHUB_NOT_CONNECTED", "This repository is not connected", 409);
      const urls = connectedGithubRepos(project)
        .filter(
          (connected) => connected.fullName.toLowerCase() !== repo.fullName.toLowerCase(),
        )
        .map((connected) => `https://github.com/${connected.fullName}`);
      await tx.query(
        "UPDATE projects SET data=data || jsonb_build_object('githubConnected',$2::boolean,'githubStatusSync',false,'githubRepositories',$3::jsonb),revision=revision+1 WHERE id=$1",
        [project.id, urls.length > 0, JSON.stringify(urls)],
      );
      await event(tx, a, project.id, project.id, name, { repository: repo.fullName });
      return access(tx, a, project.id);
    });
  if (name === "github.statusSyncConfigure")
    return db.transaction(async (tx) => {
      await accountLock(tx);
      const a = await human(tx, actor);
      const project = await access(tx, a, i.projectId, "maintain");
      if (project.revision !== i.revision)
        fail("CONFLICT", "Project changed; reload first", 409);
      if (i.enabled && !project.githubConnected)
        fail("GITHUB_NOT_CONNECTED", "Connect the GitHub App first", 409);
      if (i.enabled)
        await currentGithubApp(tx, config, projectGithubAppId(config, project));
      if (project.githubStatusSync === i.enabled) return project;
      if (i.enabled)
        await tx.query(
          `UPDATE github_status_sync SET feedbacks_state=NULL,github_state=NULL,
          status='ready',pending_target=NULL,error_code=NULL,next_at=now(),lease_until=NULL,updated_at=now()
          WHERE thread_id IN (SELECT id FROM threads WHERE project_id=$1) AND status<>'uncertain'`,
          [project.id],
        );
      await tx.query(
        "UPDATE projects SET data=jsonb_set(data,'{githubStatusSync}',to_jsonb($1::boolean)),revision=revision+1 WHERE id=$2",
        [i.enabled, project.id],
      );
      await event(tx, a, project.id, project.id, name, { enabled: i.enabled });
      return access(tx, a, project.id);
    });
  fail("NOT_FOUND", "Unknown GitHub connection operation", 404);
}
