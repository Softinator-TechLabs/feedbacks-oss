import { configFromEnv } from "../server/config.js";
import { postgres } from "../server/db.js";
import { migrate } from "../server/migrations.js";
import { Auth } from "../server/auth.js";
try {
  const email = process.env.BOOTSTRAP_EMAIL,
    name = process.env.BOOTSTRAP_NAME ?? "Owner";
  let password = process.env.BOOTSTRAP_PASSWORD;
  if (!password && !process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    password = Buffer.concat(chunks).toString("utf8").trimEnd();
  }
  if (!email || !password) throw new Error("missing bootstrap input");
  const config = configFromEnv(),
    db = postgres(config.databaseUrl);
  await migrate(db);
  await new Auth(db).bootstrap(email, name, password);
  console.info("Owner account created. Sign in through the web application.");
  process.exit(0);
} catch {
  console.error(
    "Bootstrap refused or failed. Supply operator secret input and verify configuration. Existing owners cannot be replaced.",
  );
  process.exit(1);
}
