import type { Database } from "../db.js";
import type { Config } from "../config.js";
import type { AssetStore } from "../assets.js";
import { accountLock } from "../auth.js";
import { credentialScope, sealCredential } from "../integrations/credential-vault.js";
import { mailTransport, mailIdentity } from "../../shared/notifications.js";

// Explicit deployment configuration seeds an unconfigured installation once.
// Saved settings then remain authoritative, including an owner's later disable.
export async function seedMailEnvironment(
  db: Database,
  store: AssetStore,
  config: Config,
  env: NodeJS.ProcessEnv = process.env,
) {
  const value = (name: string) => env[name]?.trim() || undefined;
  const secret = (name: string) => env[name] || undefined;
  const provider = value("FEEDBACKS_MAIL_PROVIDER");
  if (!provider) return;
  if (await db.one("SELECT scope FROM notification_settings WHERE scope='server'"))
    return;
  const identity = mailIdentity.parse({
    fromEmail: value("MAIL_FROM_EMAIL"),
    fromName: value("MAIL_FROM_NAME") ?? "Feedbacks",
    ...(value("MAIL_REPLY_TO") ? { replyTo: value("MAIL_REPLY_TO") } : {}),
  });
  const transport = mailTransport.parse(
    provider === "smtp"
      ? {
          provider: "smtp",
          host: value("MAIL_SMTP_HOST"),
          port: Number(value("MAIL_SMTP_PORT") ?? 587),
          user: value("MAIL_SMTP_USER"),
          password: secret("MAIL_SMTP_PASSWORD"),
        }
      : provider === "mailjet"
        ? {
            provider: "mailjet",
            apiKey: secret("MAILJET_API_KEY"),
            apiSecret: secret("MAILJET_API_SECRET"),
          }
        : {
            provider,
            authMode:
              secret("MAIL_SES_ACCESS_KEY_ID") || secret("MAIL_SES_SECRET_ACCESS_KEY")
                ? "keys"
                : "role",
            region: value("MAIL_SES_REGION"),
            accessKeyId: secret("MAIL_SES_ACCESS_KEY_ID"),
            secretAccessKey: secret("MAIL_SES_SECRET_ACCESS_KEY"),
            sessionToken: secret("MAIL_SES_SESSION_TOKEN"),
            configurationSet: value("MAIL_SES_CONFIGURATION_SET"),
          },
  );
  if (transport.provider === "smtp" && !transport.password)
    throw Error("SMTP environment requires a password");
  if (transport.provider === "mailjet" && !transport.apiSecret)
    throw Error("Mailjet environment requires an API secret");
  if (
    transport.provider === "ses" &&
    !!transport.accessKeyId !== !!transport.secretAccessKey
  )
    throw Error("SES requires both environment keys or neither");
  await db.transaction(async (tx) => {
    await accountLock(tx);
    if (await tx.one("SELECT scope FROM notification_settings WHERE scope='server'"))
      return;
    const {
      password,
      oauth,
      apiKey,
      apiSecret,
      accessKeyId,
      secretAccessKey,
      sessionToken,
      ...metadata
    } = transport as any;
    const secrets = Object.fromEntries(
      Object.entries({
        password,
        oauth,
        apiKey,
        apiSecret,
        accessKeyId,
        secretAccessKey,
        sessionToken,
      }).filter(([, v]) => v !== undefined),
    );
    const sealed = await sealCredential(
      store,
      credentialScope(config, "email", "server"),
      JSON.stringify(secrets),
    );
    await tx.query(
      "INSERT INTO notification_settings(scope,enabled,transport,identity,envelope,key_object,templates) VALUES('server',true,$1,$2,$3,$4,'{}'::jsonb)",
      [
        JSON.stringify(metadata),
        JSON.stringify(identity),
        JSON.stringify(sealed.envelope),
        sealed.objectKey,
      ],
    );
  });
}
