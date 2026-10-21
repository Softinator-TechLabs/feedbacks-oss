import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const requiredJobs = [
  "check (22)",
  "check (24)",
  "containers",
  "extension-browser",
  "android-host",
  "secrets",
];

export function assertSiteDeployment({ sha, mainSha, repository, run, jobs }) {
  if (!/^[a-f0-9]{40}$/.test(sha || "") || sha !== mainSha)
    throw new Error("Deployment must target the current main revision.");
  if (
    !run ||
    run.head_sha !== sha ||
    run.head_branch !== "main" ||
    run.head_repository?.full_name !== repository ||
    run.event !== "push" ||
    run.path !== ".github/workflows/ci.yml" ||
    run.status !== "completed" ||
    run.conclusion !== "success"
  )
    throw new Error("Successful main push CI is required on the exact site revision.");
  for (const name of requiredJobs)
    if (!jobs.some((job) => job.name === name && job.conclusion === "success"))
      throw new Error(`Required CI job did not succeed: ${name}`);
}

function verify() {
  const {
    TARGET_SHA: sha,
    GITHUB_REPOSITORY: repository,
    GITHUB_OUTPUT: output,
  } = process.env;
  if (!/^[a-f0-9]{40}$/.test(sha || "") || !/^[\w.-]+\/[\w.-]+$/.test(repository || ""))
    throw new Error("A source revision and repository are required.");
  const api = (path) =>
    JSON.parse(
      execFileSync("gh", ["api", `repos/${repository}/${path}`], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
  const mainSha = api("git/ref/heads/main").object.sha;
  if (sha !== mainSha) {
    console.log("Main advanced; leaving deployment to its CI run.");
    if (output) appendFileSync(output, "deploy=false\n");
    return;
  }
  const { workflow_runs: runs } = api(
    `actions/workflows/ci.yml/runs?head_sha=${sha}&event=push&branch=main&per_page=100`,
  );
  const run = runs[0];
  const jobs = run ? api(`actions/runs/${run.id}/jobs?per_page=100`).jobs : [];
  assertSiteDeployment({ sha, mainSha, repository, run, jobs });
  if (output) appendFileSync(output, "deploy=true\n");
  console.log(`Verified all CI jobs for ${sha} (run ${run.id}).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  verify();
