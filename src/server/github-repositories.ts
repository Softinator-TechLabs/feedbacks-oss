import { fail } from "./errors.js";
import { githubRepo, type GithubRepo } from "./github-app.js";

type ProjectRepositories = {
  repositoryUrl?: string | null;
  githubConnected?: boolean;
  githubRepositories?: string[];
};

export function connectedGithubRepos(project: ProjectRepositories): GithubRepo[] {
  if (!project.githubConnected) return [];
  const urls = project.githubRepositories?.length
    ? project.githubRepositories
    : project.repositoryUrl
      ? [project.repositoryUrl]
      : [];
  const unique = new Map<string, GithubRepo>();
  for (const url of urls) {
    const repo = githubRepo(url);
    unique.set(repo.fullName.toLowerCase(), repo);
  }
  return [...unique.values()];
}

export function hasConnectedGithubRepo(project: ProjectRepositories, repo: GithubRepo) {
  return connectedGithubRepos(project).some(
    (connected) => connected.fullName.toLowerCase() === repo.fullName.toLowerCase(),
  );
}

export function requireConnectedGithubRepo(
  project: ProjectRepositories,
  repositoryUrl?: string,
): GithubRepo {
  const repos = connectedGithubRepos(project);
  if (!repos.length)
    fail("GITHUB_NOT_CONNECTED", "Connect the GitHub App in project settings first", 409);
  if (!repositoryUrl) {
    if (repos.length === 1) return repos[0];
    fail("GITHUB_REPOSITORY_REQUIRED", "Choose a connected Issue repository", 400);
  }
  const requested = githubRepo(repositoryUrl);
  const matched = repos.find(
    (repo) => repo.fullName.toLowerCase() === requested.fullName.toLowerCase(),
  );
  if (!matched)
    fail("GITHUB_NOT_CONNECTED", "This repository is not connected to the project", 409);
  return matched;
}
