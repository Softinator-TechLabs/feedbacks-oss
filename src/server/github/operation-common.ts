import type { Actor } from "../../shared/contracts.js";
import type { Database } from "../db.js";
import { Auth } from "../auth.js";
import type { GithubRepo } from "../github-app.js";
import { fail } from "../errors.js";

export async function human(db: Database, actor: Actor) {
  const current = await new Auth(db).current(actor);
  if (current.kind !== "human")
    fail("FORBIDDEN", "A signed-in project maintainer is required", 403);
  if (current.mustChangePassword)
    fail("PASSWORD_CHANGE_REQUIRED", "Change your password first", 403);
  return current;
}

export function issueNumber(value: string, repo: GithubRepo) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    fail("GITHUB_ISSUE_INVALID", "Use an exact GitHub Issue URL");
  }
  const expected = `/` + repo.fullName + `/issues/`;
  if (
    url.origin !== "https://github.com" ||
    url.pathname.slice(0, expected.length).toLowerCase() !== expected.toLowerCase() ||
    url.search ||
    url.hash ||
    url.username ||
    url.password ||
    !/^[1-9]\d*$/.test(url.pathname.slice(expected.length))
  )
    fail("GITHUB_ISSUE_INVALID", "Use an Issue URL from the connected repository");
  const number = Number(url.pathname.slice(expected.length));
  if (!Number.isSafeInteger(number)) fail("GITHUB_ISSUE_INVALID", "Invalid Issue number");
  return number;
}
