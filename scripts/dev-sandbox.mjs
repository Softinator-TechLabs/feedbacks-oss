import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { once } from "node:events";
import { PGlite } from "@electric-sql/pglite";
import { Database } from "../dist/server/db.js";
import { migrate } from "../dist/server/migrations.js";
import { LocalAssets } from "../dist/server/assets.js";
import { Auth } from "../dist/server/auth.js";
import { createApp } from "../dist/server/app.js";

// Deliberately never loads .env, configFromEnv, PostgreSQL URLs or S3 credentials.
// Every invocation has an independent in-memory database and loopback listener.
const root = resolve(import.meta.dirname, "..");
process.chdir(root);
await mkdir(join(root, ".local"), { recursive: true, mode: 0o700 });
const directory = await mkdtemp(join(root, ".local/sandbox-"));
const pg = new PGlite();
const db = new Database(pg);
const email = "owner@example.test";
const password = randomBytes(24).toString("base64url");
let server;
let closing;
async function close() {
  if (closing) return closing;
  closing = (async () => {
    if (server?.listening) {
      server.closeAllConnections();
      await new Promise((done) => server.close(done));
    }
    await pg.close();
    await rm(directory, { recursive: true, force: true });
  })();
  return closing;
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    void close();
  });
try {
  await migrate(db);
  await new Auth(db).bootstrap(email, "Sandbox owner", password);
  const config = {
    production: false,
    appOrigin: "http://127.0.0.1",
    port: 0,
    databaseUrl: "sandbox-only",
    assetDriver: "local",
    assetDirectory: join(directory, "assets"),
    organizationId: randomUUID(),
    trustProxyHops: 0,
    databasePoolMax: 1,
  };
  const app = createApp(config, db, new LocalAssets(config.assetDirectory));
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  config.port = server.address().port;
  config.appOrigin = `http://127.0.0.1:${config.port}`;
  const post = (name, input, headers = {}) =>
    fetch(`${config.appOrigin}/api/${name}`, {
      method: "POST",
      headers: {
        Origin: config.appOrigin,
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(10000),
    });
  const login = await post("auth.login", { email, password });
  if (!login.ok) throw new Error("Sandbox sign-in failed");
  const session = await login.json();
  const headers = {
    Cookie: login.headers.get("set-cookie").split(";")[0],
    "X-CSRF-Token": session.data.csrf,
  };
  const created = await post(
    "projects.create",
    { name: "Sandbox review", origins: ["https://example.com"] },
    headers,
  );
  if (!created.ok) throw new Error("Sandbox project creation failed");
  const project = (await created.json()).data;
  const thread = await post(
    "threads.create",
    {
      projectId: project.id,
      body: "Synthetic review: make the primary action easier to find.",
      context: { url: "https://example.com/", viewport: { width: 1280, height: 800 } },
      idempotencyKey: "sandbox-seed",
    },
    headers,
  );
  if (!thread.ok) throw new Error("Sandbox thread creation failed");
  const threadData = (await thread.json()).data;
  const read = await post("threads.get", { threadId: threadData.id }, headers);
  if (!read.ok || (await read.json()).data.id !== threadData.id)
    throw new Error("Sandbox readback failed");
  const denied = await post("projects.list", {});
  if (denied.status !== 401) throw new Error("Sandbox anonymous access was not denied");
  const ready = await fetch(`${config.appOrigin}/readyz`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!ready.ok) throw new Error("Sandbox readiness failed");
  if (process.argv.includes("--smoke")) {
    console.log(
      JSON.stringify({
        sandbox: "passed",
        checks: [
          "migrations",
          "sign-in",
          "project",
          "thread",
          "readback",
          "anonymous-denial",
          "readiness",
        ],
        productionAccess: false,
      }),
    );
    await close();
  } else {
    const accessFile = join(directory, "access.json");
    await writeFile(
      accessFile,
      JSON.stringify(
        { url: config.appOrigin, email, password, projectId: project.id },
        null,
        2,
      ) + "\n",
      { mode: 0o600 },
    );
    console.log(
      `Sandbox: ${config.appOrigin}\nLocal access file: ${accessFile}\nSynthetic data only. Stop with Ctrl+C; this sandbox is discarded.`,
    );
  }
} catch (error) {
  await close();
  throw error;
}
