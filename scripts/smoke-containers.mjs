import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

// Uses only disposable containers, synthetic records and loopback ports.
// Build feedbacks-app:check and feedbacks-site:check before running this script.
const id = `feedbacks-check-${randomBytes(6).toString("hex")}`;
const directory = await mkdtemp(join(tmpdir(), `${id}-`));
const containers = [];
let networkCreated = false;
function docker(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, {
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      timeout: 120000,
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(output.trim());
      else reject(new Error(`Docker ${args[0]} failed (${code}): ${output}`));
    });
    if (input !== undefined) child.stdin.end(input);
  });
}
async function start(name, args) {
  containers.push(name);
  await docker(["run", "--detach", "--name", name, ...args]);
}
async function waitFor(check) {
  const deadline = Date.now() + 45000;
  while (true) {
    try {
      if (await check()) return;
    } catch {
      // Database/container startup is asynchronous.
    }
    if (Date.now() > deadline) throw new Error("Container readiness timed out");
    await delay(400);
  }
}
async function baseUrl(name, port) {
  const address = await docker(["port", name, `${port}/tcp`]);
  assert.match(address, /^127\.0\.0\.1:\d+$/);
  return `http://${address}`;
}
const request = (url, options = {}) =>
  fetch(url, { ...options, signal: AbortSignal.timeout(10000) });

try {
  const databasePassword = randomBytes(24).toString("hex");
  const ownerPassword = randomBytes(24).toString("base64url");
  const origin = "https://feedbacks.example.test";
  const database = `${id}-db`,
    app = `${id}-app`,
    site = `${id}-site`;
  const databaseEnv = join(directory, "database.env");
  const appEnv = join(directory, "app.env");
  await writeFile(
    databaseEnv,
    `POSTGRES_USER=feedbacks\nPOSTGRES_DB=feedbacks\nPOSTGRES_PASSWORD=${databasePassword}\n`,
    { mode: 0o600 },
  );
  await writeFile(
    appEnv,
    [
      "NODE_ENV=production",
      "PORT=3000",
      `APP_ORIGIN=${origin}`,
      `DATABASE_URL=postgresql://feedbacks:${databasePassword}@${database}:5432/feedbacks`,
      "DATABASE_POOL_MAX=5",
      "TRUST_PROXY_HOPS=0",
      "ASSET_DRIVER=s3",
      `ORGANIZATION_ID=${randomUUID()}`,
      "S3_ENDPOINT=https://storage.invalid",
      "S3_REGION=eu-central-1",
      "S3_BUCKET=synthetic-smoke-test",
      `S3_ACCESS_KEY_ID=${randomBytes(16).toString("hex")}`,
      `S3_SECRET_ACCESS_KEY=${randomBytes(24).toString("hex")}`,
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  await docker(["network", "create", id]);
  networkCreated = true;
  await start(database, [
    "--network",
    id,
    "--env-file",
    databaseEnv,
    "--tmpfs",
    "/var/lib/postgresql/data",
    "postgres:17-bookworm",
  ]);
  await waitFor(() =>
    docker(["exec", database, "pg_isready", "-U", "feedbacks", "-d", "feedbacks"]),
  );
  await start(app, [
    "--network",
    id,
    "--env-file",
    appEnv,
    "--init",
    "--read-only",
    "--tmpfs",
    "/tmp:size=128m,mode=1777",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges:true",
    "--publish",
    "127.0.0.1::3000",
    "feedbacks-app:check",
  ]);
  const base = await baseUrl(app, 3000);
  await waitFor(async () => (await request(`${base}/readyz`)).ok);
  assert.notEqual(await docker(["exec", app, "id", "-u"]), "0");
  const bootstrap = [
    "exec",
    "--interactive",
    "--env",
    "BOOTSTRAP_EMAIL=owner@example.test",
    "--env",
    "BOOTSTRAP_NAME=Smoke owner",
    app,
    "node",
    "dist/cli/bootstrap.js",
  ];
  await docker(bootstrap, ownerPassword);
  await assert.rejects(docker(bootstrap, ownerPassword), /Bootstrap refused or failed/);
  const post = (operation, body, headers = {}) =>
    request(`${base}/api/${operation}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  assert.equal((await post("projects.list", {})).status, 401);
  const login = await post(
    "auth.login",
    { email: "owner@example.test", password: ownerPassword },
    { Origin: origin },
  );
  assert.equal(login.status, 200);
  const setCookie = login.headers.get("set-cookie");
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /Secure/i);
  assert.match(setCookie, /SameSite=Strict/i);
  const session = await login.json();
  const headers = { Origin: origin, Cookie: setCookie.split(";")[0] };
  const project = { name: "Container smoke check", origins: ["https://example.test"] };
  assert.equal((await post("projects.create", project, headers)).status, 403);
  headers["X-CSRF-Token"] = session.data.csrf;
  assert.equal((await post("projects.create", project, headers)).status, 200);
  assert.equal((await (await post("projects.list", {}, headers)).json()).ok, true);
  const metadata = await (
    await request(`${base}/downloads/extension-release.json`)
  ).json();
  const zip = Buffer.from(
    await (await request(`${base}/downloads/feedbacks-extension.zip`)).arrayBuffer(),
  );
  assert.equal(zip.length, metadata.bytes);
  assert.equal(createHash("sha256").update(zip).digest("hex"), metadata.sha256);
  const widgetScript = await request(`${base}/widget.js`);
  assert.equal(widgetScript.status, 200);
  assert.match(widgetScript.headers.get("content-type"), /javascript/);
  assert.match(await widgetScript.text(), /feedbacks-widget/);
  const widgetStyles = await request(`${base}/widget.css`);
  assert.equal(widgetStyles.status, 200);
  assert.match(widgetStyles.headers.get("content-type"), /text\/css/);
  assert.match(await widgetStyles.text(), /feedbacks-widget/);
  await start(site, [
    "--network",
    id,
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges:true",
    "--publish",
    "127.0.0.1::8080",
    "feedbacks-site:check",
  ]);
  const website = await baseUrl(site, 8080);
  await waitFor(async () => (await request(`${website}/healthz`)).ok);
  for (const path of ["/", "/privacy.html"]) {
    const response = await request(`${website}${path}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-security-policy"), /script-src 'self'/);
  }
  for (const path of ["/.env", "/.git/config", "/missing-page"]) {
    assert.equal((await request(`${website}${path}`)).status, 404);
  }
  await docker(["stop", "--time", "15", app]);
  assert.equal(await docker(["inspect", "--format", "{{.State.ExitCode}}", app]), "0");
  console.log(
    "Container checks passed: production startup, non-root/read-only app, bootstrap, authentication/CSRF, extension download, static website and graceful shutdown. External S3 and TLS ingress are not exercised.",
  );
} finally {
  try {
    const cleanup = await Promise.allSettled(
      containers.map((container) => docker(["rm", "--force", container])),
    );
    for (const result of cleanup)
      if (result.status === "rejected") console.error(result.reason.message);
    if (networkCreated) await docker(["network", "rm", id]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
