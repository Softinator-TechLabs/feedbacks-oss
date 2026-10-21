import type { Database } from "../db.js";
import type { Config } from "../config.js";
import type { AssetStore } from "../assets.js";
import type { Actor } from "../../shared/contracts.js";
import { access, ownerOnly } from "../access.js";
import { fail } from "../errors.js";
import {
  credentialScope,
  openCredential,
  sealCredential,
} from "../integrations/credential-vault.js";
import {
  defaultTemplates,
  validateMailTemplates,
  renderMailTemplate,
  type MailIdentity,
  type MailTransport,
  type NotificationEvent,
} from "../../shared/notifications.js";

export function notificationScope(projectId?: string) {
  return projectId ?? "server";
}
export async function notificationAccess(db: Database, a: Actor, projectId?: string) {
  if (a.kind !== "human")
    fail("FORBIDDEN", "A signed-in human must manage email settings", 403);
  if (projectId) await access(db, a, projectId, "maintain");
  else ownerOnly(a);
}
export async function effectiveMailSettings(db: Database, projectId?: string) {
  const server = await db.one("SELECT * FROM notification_settings WHERE scope='server'");
  const project = projectId
    ? await db.one("SELECT * FROM notification_settings WHERE scope=$1", [projectId])
    : null;
  const selected = project ?? server;
  const provider = project?.transport ? project : server;
  return {
    selected,
    provider,
    version: `${server?.revision ?? 0}:${project?.revision ?? 0}`,
    identity: project?.identity ?? provider?.identity ?? null,
    inheritedTemplates: {
      ...defaultTemplates,
      ...(projectId ? (server?.templates ?? {}) : {}),
    },
    templates: {
      ...defaultTemplates,
      ...(server?.templates ?? {}),
      ...(project?.templates ?? {}),
    },
    enabled: !!selected?.enabled && !!provider?.enabled && !!provider?.transport,
  };
}
export async function readMailSettings(db: Database, projectId?: string) {
  const own = await db.one("SELECT * FROM notification_settings WHERE scope=$1", [
    notificationScope(projectId),
  ]);
  const effective = await effectiveMailSettings(db, projectId);
  return {
    revision: own?.revision ?? 0,
    enabled: own?.enabled ?? effective.enabled,
    provider: effective.provider?.transport.provider ?? null,
    sesAuthMode:
      effective.provider?.transport.provider === "ses"
        ? (effective.provider.transport.authMode ?? null)
        : null,
    identity: effective.identity,
    identityOverridden: !!projectId && !!own?.identity,
    inheritedTemplates: effective.inheritedTemplates,
    templates: own?.templates ?? {},
    effectiveTemplates: effective.templates,
    inherited: !!projectId && !own?.transport,
    configured: !!effective.provider?.transport,
  };
}
export async function loadMailTransport(
  db: Database,
  config: Config,
  store: AssetStore,
  projectId?: string,
): Promise<{
  transport: MailTransport;
  identity: MailIdentity;
  settingsVersion: string;
} | null> {
  const effective = await effectiveMailSettings(db, projectId);
  if (!effective.enabled) return null;
  const row = effective.provider;
  const secrets = JSON.parse(
    await openCredential(
      store,
      credentialScope(config, "email", row.scope),
      row.key_object,
      row.envelope,
    ),
  );
  return {
    transport: { ...row.transport, ...secrets },
    identity: effective.identity,
    settingsVersion: effective.version,
  };
}
export async function configureMail(
  db: Database,
  config: Config,
  store: AssetStore,
  a: Actor,
  i: any,
) {
  await notificationAccess(db, a, i.projectId);
  const scope = notificationScope(i.projectId);
  const current = await db.one(
    "SELECT * FROM notification_settings WHERE scope=$1 FOR UPDATE",
    [scope],
  );
  if ((current?.revision ?? 0) !== i.revision)
    fail("CONFLICT", "Email settings changed; reload before saving", 409);
  try {
    validateMailTemplates(i.templates);
  } catch {
    fail("VALIDATION", "Unknown template variable; use the documented names");
  }
  let transport = current?.transport ?? null,
    identity = current?.identity ?? null,
    envelope = current?.envelope ?? null,
    key = current?.key_object ?? null;
  if (i.transport || i.identity || i.inheritTransport) {
    ownerOnly(a);
    if (i.inheritTransport) {
      if (!i.projectId) fail("VALIDATION", "Server settings cannot inherit a transport");
      transport = null;
      identity = null;
      envelope = null;
      key = null;
    } else if (i.identity && !i.transport) {
      identity = i.identity;
    } else {
      if (!i.transport || !i.identity)
        fail("VALIDATION", "Transport and sender identity are required together");
      const previous =
        current?.transport?.provider === i.transport.provider && current.envelope
          ? JSON.parse(
              await openCredential(
                store,
                credentialScope(config, "email", scope),
                current.key_object,
                current.envelope,
              ),
            )
          : {};
      const {
        password,
        oauth,
        apiKey,
        apiSecret,
        accessKeyId,
        secretAccessKey,
        sessionToken,
        ...metadata
      } = i.transport;
      const supplied = Object.fromEntries(
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
      // Explicit transport edits replace authentication modes; omission retains that mode's secret.
      let secrets = { ...previous, ...supplied };
      if (password) delete secrets.oauth;
      if (oauth) delete secrets.password;
      if (i.transport.provider === "smtp" && !secrets.password && !secrets.oauth)
        fail("VALIDATION", "SMTP password or OAuth credentials required");
      if (i.transport.provider === "mailjet" && (!secrets.apiKey || !secrets.apiSecret))
        fail("VALIDATION", "Mailjet API key and secret required");
      if (i.transport.provider === "ses") {
        const authMode =
          i.transport.authMode ?? (accessKeyId || secretAccessKey ? "keys" : "role");
        metadata.authMode = authMode;
        if (authMode === "role") {
          if (accessKeyId || secretAccessKey || sessionToken)
            fail(
              "VALIDATION",
              "Server role authentication cannot include SES access keys or a session token",
            );
          secrets = {};
        } else {
          if (!!accessKeyId !== !!secretAccessKey)
            fail("VALIDATION", "Supply both new SES access keys together");
          if (accessKeyId && secretAccessKey) {
            secrets = {
              accessKeyId,
              secretAccessKey,
              ...(sessionToken ? { sessionToken } : {}),
            };
          }
          if (!secrets.accessKeyId || !secrets.secretAccessKey)
            fail("VALIDATION", "SES access key authentication requires both keys");
        }
      }
      const sealed = await sealCredential(
        store,
        credentialScope(config, "email", scope),
        JSON.stringify(secrets),
      );
      envelope = sealed.envelope;
      key = sealed.objectKey;
      transport = metadata;
      identity = i.identity;
    }
  }
  if (i.enabled && !transport) {
    const server = await db.one(
      "SELECT transport FROM notification_settings WHERE scope='server'",
    );
    if (!i.projectId || !server?.transport)
      fail("VALIDATION", "Configure an email provider before enabling notifications");
  }
  await db.query(
    `INSERT INTO notification_settings(scope,project_id,enabled,transport,identity,envelope,key_object,templates,revision)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,1) ON CONFLICT(scope) DO UPDATE SET enabled=$3,transport=$4,identity=$5,envelope=$6,key_object=$7,templates=$8,revision=notification_settings.revision+1,updated_at=now()`,
    [
      scope,
      i.projectId ?? null,
      i.enabled,
      transport ? JSON.stringify(transport) : null,
      identity ? JSON.stringify(identity) : null,
      envelope ? JSON.stringify(envelope) : null,
      key,
      JSON.stringify(i.templates),
    ],
  );
  return readMailSettings(db, i.projectId);
}
export function previewMail(config: Config, template: any, event: NotificationEvent) {
  try {
    return renderMailTemplate(template, {
      project: "Example project",
      event,
      actor: "Example member",
      title: "Example feedback",
      comment: "Example discussion reply",
      status: "In progress",
      threadUrl: config.appOrigin + "/projects",
      preferencesUrl: config.appOrigin + "/account",
    });
  } catch {
    fail("VALIDATION", "Use only the documented template variables");
  }
}
