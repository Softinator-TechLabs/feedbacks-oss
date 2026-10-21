import { createPrivateKey, sign } from "node:crypto";
import type { Config } from "./config.js";
import { DomainError, fail } from "./errors.js";
import {
  assertGithubOwner,
  requireGithubApp,
  type GithubAppConfig,
} from "./github-app-config.js";

export type GithubRepo = { owner: string; repo: string; fullName: string };
export class GithubCommentError extends DomainError {
  constructor(
    public code: string,
    public uncertain = false,
    public commentId?: number,
    public retryAfterSeconds?: number,
  ) {
    super(
      code,
      uncertain
        ? "The comment may have been sent. Inspect the GitHub Issue before reconciling this action."
        : "GitHub could not verify the requested comment. Check the connection and Issue.",
      code === "GITHUB_COMMENT_RATE_LIMIT" ? 429 : 503,
    );
  }
}
export type GithubIssueComment = {
  id: number;
  url: string;
  body: string;
  author: string | null;
  createdAt: string;
};

async function commentRateLimit(response: Response) {
  if (![403, 429].includes(response.status)) return undefined;
  const retry = response.headers.get("retry-after"),
    reset = response.headers.get("x-ratelimit-reset");
  let limited =
    response.status === 429 ||
    retry !== null ||
    response.headers.get("x-ratelimit-remaining") === "0";
  if (!limited && response.body) {
    const reader = response.body.getReader();
    try {
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > 16384) {
          await reader.cancel();
          break;
        }
        chunks.push(next.value);
      }
      if (size <= 16384) {
        const message = JSON.parse(Buffer.concat(chunks).toString("utf8"))?.message;
        limited =
          typeof message === "string" && /rate limit|abuse detection/i.test(message);
      }
    } catch {
      /* An unreadable rejection never turns into permission to retry a write. */
    } finally {
      reader.releaseLock();
    }
  }
  if (!limited) return undefined;
  const retrySeconds =
    retry === null
      ? NaN
      : /^\d+$/.test(retry.trim())
        ? Number(retry)
        : (Date.parse(retry) - Date.now()) / 1000;
  const resetSeconds = reset === null ? NaN : Number(reset) - Date.now() / 1000;
  const seconds = Math.max(
    Number.isFinite(retrySeconds) ? retrySeconds : 60,
    response.headers.get("x-ratelimit-remaining") === "0" && Number.isFinite(resetSeconds)
      ? resetSeconds
      : 0,
  );
  return Math.max(1, Math.min(86400, Math.ceil(seconds)));
}

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
    private selectedApp?: GithubAppConfig,
  ) {}

  forApp(appId: string | null | undefined) {
    return new GithubApp(this.config, this.fetcher, requireGithubApp(this.config, appId));
  }

  withConfig(config: Config) {
    return new GithubApp(config, this.fetcher);
  }

  private async credentials(owner?: string) {
    const app =
      this.selectedApp ?? requireGithubApp(this.config, this.config.githubAppId);
    return {
      ...this.config,
      githubAppId: app.id,
      githubAppPrivateKey: app.loadPrivateKey
        ? await app.loadPrivateKey(owner)
        : app.privateKey,
    };
  }

  async inspectRegistration() {
    return (await this.request("/app", appJwt(await this.credentials()))).data;
  }

  async convertManifest(code: string) {
    return (
      await this.request(
        `/app-manifests/${encodeURIComponent(code)}/conversions`,
        "",
        "POST",
      )
    ).data;
  }

  private async request(
    path: string,
    bearer: string,
    method = "GET",
    body?: unknown,
    commentMode?: "read" | "write",
  ) {
    let response: Response;
    try {
      response = await this.fetcher(`https://api.github.com${path}`, {
        method,
        headers: {
          Accept: "application/vnd.github+json",
          ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
          "X-GitHub-Api-Version": "2026-03-10",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        redirect: "error",
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      if (commentMode)
        throw new GithubCommentError("GITHUB_COMMENT_NETWORK", commentMode === "write");
      fail(
        "GITHUB_UNAVAILABLE",
        "GitHub did not respond. Check before retrying a write.",
        503,
      );
    }
    if (!response.ok) {
      const code = response.status;
      if (commentMode) {
        const retryAfter = await commentRateLimit(response);
        await response.body?.cancel();
        throw new GithubCommentError(
          retryAfter !== undefined
            ? "GITHUB_COMMENT_RATE_LIMIT"
            : code >= 500
              ? commentMode === "write"
                ? "GITHUB_COMMENT_UNCERTAIN"
                : "GITHUB_UNAVAILABLE"
              : "GITHUB_COMMENT_REJECTED",
          commentMode === "write" && code >= 500,
          undefined,
          retryAfter,
        );
      }
      if (code === 404)
        fail(
          "GITHUB_NOT_INSTALLED",
          "Install the GitHub App on this repository first",
          409,
        );
      fail("GITHUB_UNAVAILABLE", `GitHub returned HTTP ${code}`, 503);
    }
    try {
      if (commentMode) {
        const reader = response.body?.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        if (!reader) throw new Error();
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > 2_000_000) {
            await reader.cancel();
            throw new Error();
          }
          chunks.push(chunk.value);
        }
        return {
          status: response.status,
          data: JSON.parse(Buffer.concat(chunks).toString("utf8")),
        };
      }
      return { status: response.status, data: (await response.json()) as any };
    } catch {
      if (commentMode)
        throw new GithubCommentError(
          "GITHUB_COMMENT_INVALID_RESPONSE",
          commentMode === "write",
        );
      fail("GITHUB_UNAVAILABLE", "GitHub returned an invalid response", 503);
    }
  }

  async installationToken(
    repo: GithubRepo,
    permission: "read" | "write",
    commentMode?: "read",
  ) {
    const app =
      this.selectedApp ?? requireGithubApp(this.config, this.config.githubAppId);
    assertGithubOwner(app, repo.owner);
    const credentials = await this.credentials(repo.owner);
    const installation = await this.request(
      `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/installation`,
      appJwt(credentials),
      "GET",
      undefined,
      commentMode,
    );
    if (!Number.isSafeInteger(installation.data.id) || installation.data.id <= 0)
      fail("GITHUB_UNAVAILABLE", "GitHub returned an invalid installation", 503);
    const token = await this.request(
      `/app/installations/${installation.data.id}/access_tokens`,
      appJwt(credentials),
      "POST",
      { repositories: [repo.repo], permissions: { issues: permission } },
      commentMode,
    );
    if (typeof token.data.token !== "string" || !token.data.token)
      fail("GITHUB_UNAVAILABLE", "GitHub did not issue an installation token", 503);
    return token.data.token as string;
  }

  async check(repo: GithubRepo) {
    await this.installationToken(repo, "write");
    return true;
  }

  async repositoryPrivate(repo: GithubRepo) {
    const token = await this.installationToken(repo, "read");
    const result = await this.request(
      `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}`,
      token,
    );
    if (typeof result.data.private !== "boolean")
      fail("GITHUB_UNAVAILABLE", "GitHub did not report repository visibility", 503);
    return result.data.private as boolean;
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

  private async readIssueWithToken(
    repo: GithubRepo,
    number: number,
    token: string,
    commentMode?: "read",
  ) {
    if (!Number.isSafeInteger(number) || number <= 0)
      fail("GITHUB_ISSUE_INVALID", "Invalid GitHub Issue number");
    const result = await this.request(
      `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/issues/${number}`,
      token,
      "GET",
      undefined,
      commentMode,
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

  private commentRecord(repo: GithubRepo, number: number, data: any): GithubIssueComment {
    const url = `https://github.com/${repo.fullName}/issues/${number}#issuecomment-${data?.id}`;
    const issueApi = `https://api.github.com/repos/${repo.fullName}/issues/${number}`;
    if (
      !Number.isSafeInteger(data?.id) ||
      data.id <= 0 ||
      typeof data.body !== "string" ||
      data.html_url?.toLowerCase() !== url.toLowerCase() ||
      data.issue_url?.toLowerCase() !== issueApi.toLowerCase() ||
      typeof data.created_at !== "string" ||
      !Number.isFinite(Date.parse(data.created_at))
    )
      throw new GithubCommentError("GITHUB_COMMENT_INVALID_RESPONSE");
    return {
      id: data.id,
      url,
      body: data.body,
      author: typeof data.user?.login === "string" ? data.user.login.slice(0, 100) : null,
      createdAt: new Date(data.created_at).toISOString(),
    };
  }
  async readIssueComments(
    repo: GithubRepo,
    number: number,
    page = 1,
    beforeRead?: () => Promise<void>,
  ) {
    if (!Number.isSafeInteger(page) || page < 1 || page > 1000)
      throw new GithubCommentError("GITHUB_COMMENT_INVALID_PAGE");
    const token = await this.installationToken(repo, "read", "read");
    await beforeRead?.();
    await this.readIssueWithToken(repo, number, token, "read");
    const result = await this.request(
      `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/issues/${number}/comments?per_page=20&page=${page}`,
      token,
      "GET",
      undefined,
      "read",
    );
    if (!Array.isArray(result.data) || result.data.length > 20)
      throw new GithubCommentError("GITHUB_COMMENT_INVALID_RESPONSE");
    return {
      items: result.data.map((row) => {
        const comment = this.commentRecord(repo, number, row);
        return { ...comment, body: comment.body.slice(0, 12000) };
      }),
      hasMore: result.data.length === 20,
      page,
    };
  }
  async readIssueComment(
    repo: GithubRepo,
    number: number,
    id: number,
    beforeRead?: () => Promise<void>,
  ) {
    if (!Number.isSafeInteger(id) || id <= 0)
      throw new GithubCommentError("GITHUB_COMMENT_INVALID_RESPONSE");
    const token = await this.installationToken(repo, "read", "read");
    await beforeRead?.();
    await this.readIssueWithToken(repo, number, token, "read");
    const result = await this.request(
      `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/issues/comments/${id}`,
      token,
      "GET",
      undefined,
      "read",
    );
    return this.commentRecord(repo, number, result.data);
  }
  async createIssueComment(
    repo: GithubRepo,
    number: number,
    body: string,
    beforeWrite: () => Promise<void>,
  ) {
    const token = await this.installationToken(repo, "write", "read");
    await this.readIssueWithToken(repo, number, token, "read");
    await beforeWrite();
    const created = await this.request(
      `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/issues/${number}/comments`,
      token,
      "POST",
      { body },
      "write",
    );
    const id =
      Number.isSafeInteger(created.data?.id) && created.data.id > 0
        ? created.data.id
        : undefined;
    try {
      if (created.status !== 201 || !id) throw new Error();
      const result = await this.request(
        `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/issues/comments/${id}`,
        token,
        "GET",
        undefined,
        "read",
      );
      const comment = this.commentRecord(repo, number, result.data);
      if (comment.id !== id || comment.body !== body) throw new Error();
      return comment;
    } catch {
      throw new GithubCommentError("GITHUB_COMMENT_UNCERTAIN", true, id);
    }
  }
}
