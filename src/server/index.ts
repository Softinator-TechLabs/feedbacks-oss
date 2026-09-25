import { configFromEnv } from "./config.js";
import { postgres } from "./db.js";
import { migrate } from "./migrations.js";
import { assetStore } from "./assets.js";
import { createApp } from "./app.js";
import type { Pool } from "pg";
import { purgeExpiredExports } from "./export-limits.js";
import { purgeExpiredPairings } from "./auth.js";
import { deliverWebhooks } from "./webhooks.js";
import { pollGithubStatusSync } from "./github-status-worker.js";

try {
  const config = configFromEnv();
  const db = postgres(config.databaseUrl, config.databasePoolMax);
  await migrate(db);
  const server = createApp(config, db, assetStore(config)).listen(
    config.port,
    "0.0.0.0",
    () => console.info(`Feedbacks listening on port ${config.port}`),
  );
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  let maintenanceRunning = false;
  const maintenance = setInterval(() => {
    if (maintenanceRunning) return;
    maintenanceRunning = true;
    void Promise.allSettled([
      purgeExpiredExports(db),
      purgeExpiredPairings(db),
      deliverWebhooks(db),
      pollGithubStatusSync(db, config),
    ])
      .then((results) => {
        if (results.some((result) => result.status === "rejected"))
          console.error("Expiry cleanup failed.");
      })
      .finally(() => {
        maintenanceRunning = false;
      });
  }, 60000).unref();
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    clearInterval(maintenance);
    const deadline = setTimeout(() => process.exit(1), 10000).unref();
    server.close(async () => {
      try {
        await (db.connection as Pool).end();
        clearTimeout(deadline);
        process.exit(0);
      } catch {
        process.exit(1);
      }
    });
  };
  for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, stop);
  server.on("error", () => {
    console.error("Feedbacks listener failed. Verify the configured port.");
    stop();
  });
} catch {
  console.error(
    "Feedbacks startup failed. Verify database, migration and storage configuration.",
  );
  process.exit(1);
}
