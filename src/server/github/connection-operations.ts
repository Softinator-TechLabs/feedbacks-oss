import type { Actor } from "../../shared/contracts.js";
import type { Database } from "../db.js";
import type { Config } from "../config.js";
import { accountLock } from "../auth.js";
import { access, event } from "../access.js";
import { GithubApp, githubRepo } from "../github-app.js";
import { connectedGithubRepos, hasConnectedGithubRepo } from "../github-repositories.js";
import { DomainError, fail } from "../errors.js";
import { human, requireApp } from "./operation-common.js";

export const connectionOperationNames = new Set([
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
  if (name === "github.connection") {
    const connection = await db.transaction(async (tx) => {
      await accountLock(tx);
      const a = await human(tx, actor);
      const project = await access(tx, a, i.projectId);
      return {
        configured: !!(
          config.githubAppId &&
          config.githubAppSlug &&
          config.githubAppPrivateKey
        ),
        connected: project.githubConnected === true,
        statusSyncEnabled: project.githubStatusSync === true,
        repositoryUrl: project.repositoryUrl ?? null,
        connectedRepositories: connectedGithubRepos(project).map(
          (repo) => `https://github.com/${repo.fullName}`,
        ),
        installUrl: config.githubAppSlug
          ? `https://github.com/apps/${config.githubAppSlug}/installations/new`
          : null,
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
            await client.check(githubRepo(repositoryUrl));
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
    requireApp(config);
    const repo = await db.transaction(async (tx) => {
      await accountLock(tx);
      const a = await human(tx, actor);
      const project = await access(tx, a, i.projectId, "maintain");
      if (project.revision !== i.revision)
        fail("CONFLICT", "Project changed; reload first", 409);
      return githubRepo(project.repositoryUrl);
    });
    await client.check(repo);
    return db.transaction(async (tx) => {
      await accountLock(tx);
      const a = await human(tx, actor);
      const project = await access(tx, a, i.projectId, "maintain");
      if (
        project.revision !== i.revision ||
        githubRepo(project.repositoryUrl).fullName.toLowerCase() !==
          repo.fullName.toLowerCase()
      )
        fail("CONFLICT", "Project changed while checking GitHub", 409);
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
    requireApp(config);
    const repo = githubRepo(i.repositoryUrl);
    await db.transaction(async (tx) => {
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
    });
    await client.check(repo);
    return db.transaction(async (tx) => {
      await accountLock(tx);
      const a = await human(tx, actor);
      const project = await access(tx, a, i.projectId, "maintain");
      if (project.revision !== i.revision)
        fail("CONFLICT", "Project changed while checking GitHub", 409);
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
      if (i.enabled) requireApp(config);
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
