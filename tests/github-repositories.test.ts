import assert from "node:assert/strict";
import { test } from "node:test";
import {
  connectedGithubRepos,
  requireConnectedGithubRepo,
} from "../src/server/github-repositories.js";

test("legacy projects keep their single connected repository", () => {
  const project = {
    repositoryUrl: "https://github.com/One/primary",
    githubConnected: true,
  };
  assert.deepEqual(
    connectedGithubRepos(project).map((repo) => repo.fullName),
    ["One/primary"],
  );
  assert.equal(requireConnectedGithubRepo(project).fullName, "One/primary");
});

test("multiple installations require an explicit Issue destination", () => {
  const project = {
    repositoryUrl: "https://github.com/One/primary",
    githubConnected: true,
    githubRepositories: [
      "https://github.com/One/primary",
      "https://github.com/Two/other",
    ],
  };
  assert.throws(() => requireConnectedGithubRepo(project), {
    code: "GITHUB_REPOSITORY_REQUIRED",
  });
  assert.equal(
    requireConnectedGithubRepo(project, "https://github.com/Two/other").fullName,
    "Two/other",
  );
  assert.throws(
    () => requireConnectedGithubRepo(project, "https://github.com/Three/ungranted"),
    { code: "GITHUB_NOT_CONNECTED" },
  );
});
