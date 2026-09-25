import { createPrivateKey, sign } from "node:crypto";
import type { Config } from "./config.js";
import { fail } from "./errors.js";

export type GithubRepo = { owner: string; repo: string; fullName: string };

export function githubRepo(value: string | null | undefined): GithubRepo {
  if (!value)
    fail("GITHUB_REPOSITORY_REQUIRED", "Set a GitHub repository for this project");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    fail("GITHUB_REPOSITORY_REQUIRED", "Use an exact https://github.com/OWNER/REPO URL");
  }
  const match = url.pathname.match(/^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/?$/);
  if (
    url.origin !== "https://github.com" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !match ||
    match[2].endsWith(".git")
  )
    fail("GITHUB_REPOSITORY_REQUIRED", "Use an exact https://github.com/OWNER/REPO URL");
  return { owner: match[1], repo: match[2], fullName: `${match[1]}/${match[2]}` };
}

function appJwt(config: Config) {
  if (!config.githubAppId || !config.githubAppPrivateKey)
    fail("GITHUB_UNAVAILABLE", "The GitHub App is not configured on this server", 503);
  const now = Math.floor(Date.now() / 1000);
  const base64url = (value: string) => Buffer.from(value).toString("base64url");
  const content = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(
    JSON.stringify({ iat: now - 60, exp: now + 8 * 60, iss: config.githubAppId }),
  )}`;
  return `${content}.${sign("RSA-SHA256", Buffer.from(content), createPrivateKey(config.githubAppPrivateKey)).toString("base64url")}`;
}

export class GithubApp {
  constructor(
    private config: Config,
    private fetcher: typeof fetch = fetch,
  ) {}

  private async request(path: string, bearer: string, method = "GET", body?: unknown) {
    let response: Response;
    try {
      response = await this.fetcher(`https://api.github.com${path}`, {
        method,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${bearer}`,
          "X-GitHub-Api-Version": "2026-03-10",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        redirect: "error",
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      fail(
        "GITHUB_UNAVAILABLE",
        "GitHub did not respond. Check before retrying a write.",
        503,
      );
    }
    if (!response.ok) {
      const code = response.status;
      if (code === 404)
        fail(
          "GITHUB_NOT_INSTALLED",
          "Install the GitHub App on this repository first",
          409,
        );
      fail("GITHUB_UNAVAILABLE", `GitHub returned HTTP ${code}`, 503);
    }
    try {
      return { status: response.status, data: (await response.json()) as any };
    } catch {
      fail("GITHUB_UNAVAILABLE", "GitHub returned an invalid response", 503);
    }
  }

  async installationToken(repo: GithubRepo, permission: "read" | "write") {
    const installation = await this.request(
      `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/installation`,
      appJwt(this.config),
    );
    if (!Number.isSafeInteger(installation.data.id) || installation.data.id <= 0)
      fail("GITHUB_UNAVAILABLE", "GitHub returned an invalid installation", 503);
    const token = await this.request(
      `/app/installations/${installation.data.id}/access_tokens`,
      appJwt(this.config),
      "POST",
      { repositories: [repo.repo], permissions: { issues: permission } },
    );
    if (typeof token.data.token !== "string" || !token.data.token)
      fail("GITHUB_UNAVAILABLE", "GitHub did not issue an installation token", 503);
    return token.data.token as string;
  }

  async check(repo: GithubRepo) {
    await this.installationToken(repo, "write");
    return true;
  }

  async createIssue(repo: GithubRepo, title: string, body: string) {
    const token = await this.installationToken(repo, "write");
    const created = await this.request(
      `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/issues`,
      token,
      "POST",
      { title, body },
    );
    if (created.status !== 201 || !Number.isSafeInteger(created.data.number))
      fail("GITHUB_UNCERTAIN", "Inspect GitHub before trying again", 503);
    return this.readIssueWithToken(repo, created.data.number, token);
  }

  private async readIssueWithToken(repo: GithubRepo, number: number, token: string) {
    if (!Number.isSafeInteger(number) || number <= 0)
      fail("GITHUB_ISSUE_INVALID", "Invalid GitHub Issue number");
    const result = await this.request(
      `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/issues/${number}`,
      token,
    );
    const url = `https://github.com/${repo.fullName}/issues/${number}`;
    if (
      result.data.html_url?.toLowerCase() !== url.toLowerCase() ||
      result.data.pull_request ||
      !["open", "closed"].includes(result.data.state)
    )
      fail("GITHUB_ISSUE_INVALID", "GitHub readback did not match this repository", 503);
    return {
      url,
      number,
      state: result.data.state as "open" | "closed",
      body: String(result.data.body ?? ""),
    };
  }

  async readIssue(repo: GithubRepo, number: number) {
    const token = await this.installationToken(repo, "read");
    return this.readIssueWithToken(repo, number, token);
  }

  async setIssueState(repo: GithubRepo, number: number, state: "open" | "closed") {
    const token = await this.installationToken(repo, "write");
    await this.request(
      `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/issues/${number}`,
      token,
      "PATCH",
      { state },
    );
    const issue = await this.readIssueWithToken(repo, number, token);
    if (issue.state !== state)
      fail("GITHUB_UNCERTAIN", "GitHub did not confirm the requested state", 503);
    return issue;
  }
}
