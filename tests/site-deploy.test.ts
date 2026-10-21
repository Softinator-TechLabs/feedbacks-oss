import assert from "node:assert/strict";
import test from "node:test";
import { assertSiteDeployment } from "../scripts/verify-site-deploy.mjs";

function target() {
  const sha = "a".repeat(40);
  const repository = "example/feedbacks";
  return {
    sha,
    mainSha: sha,
    repository,
    run: {
      head_sha: sha,
      head_branch: "main",
      head_repository: { full_name: repository },
      event: "push",
      path: ".github/workflows/ci.yml",
      status: "completed",
      conclusion: "success",
    },
    jobs: [
      "check (22)",
      "check (24)",
      "containers",
      "extension-browser",
      "android-host",
      "secrets",
    ].map((name) => ({ name, conclusion: "success" })),
  };
}

test("public site deployment requires every CI job on the current main revision", () => {
  assert.doesNotThrow(() => assertSiteDeployment(target()));
  const stale = target();
  stale.mainSha = "b".repeat(40);
  assert.throws(() => assertSiteDeployment(stale), /current main/);
  for (const name of target().jobs.map((job) => job.name)) {
    const missing = target();
    missing.jobs = missing.jobs.filter((job) => job.name !== name);
    assert.throws(() => assertSiteDeployment(missing), /Required CI job/);
    const failed = target();
    failed.jobs.find((job) => job.name === name)!.conclusion = "failure";
    assert.throws(() => assertSiteDeployment(failed), /Required CI job/);
  }
});

test("PR, fork, unrelated workflow and mismatched revision cannot authorize deployment", () => {
  for (const patch of [
    { event: "pull_request" },
    { head_branch: "feature" },
    { head_sha: "b".repeat(40) },
    { head_repository: { full_name: "fork/feedbacks" } },
    { path: ".github/workflows/other.yml" },
    { status: "in_progress" },
    { conclusion: "failure" },
  ]) {
    const invalid = target();
    Object.assign(invalid.run, patch);
    assert.throws(() => assertSiteDeployment(invalid), /Successful main push CI/);
  }
});
