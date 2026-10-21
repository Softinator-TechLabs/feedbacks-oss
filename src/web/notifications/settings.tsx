import React, { useState } from "react";
import { api } from "../api.js";
import { Field, ActionState, ErrorNotice, Loading, useAction, useLoad } from "../ui.js";
import {
  defaultTemplates,
  notificationEvents,
  templateVariables,
  type MailIdentity,
  type MailTransport,
  type MailTemplate,
  type NotificationEvent,
} from "../../shared/notifications.js";
import { useUnsavedChanges } from "../navigation.js";
type Settings = {
  revision: number;
  enabled: boolean;
  provider: "smtp" | "mailjet" | "ses" | null;
  sesAuthMode: "role" | "keys" | null;
  identity: MailIdentity | null;
  templates: Partial<Record<NotificationEvent, MailTemplate>>;
  effectiveTemplates: Record<NotificationEvent, MailTemplate>;
  inherited: boolean;
  identityOverridden: boolean;
  inheritedTemplates: Record<NotificationEvent, MailTemplate>;
  configured: boolean;
};
export function EmailSettings({
  projectId,
  owner,
}: {
  projectId?: string;
  owner: boolean;
}) {
  const scope = projectId ? { projectId } : {};
  const [editSender, setEditSender] = useState(false);
  const [sesAuthMode, setSesAuthMode] = useState<"role" | "keys">("role");
  const [version, setVersion] = useState(0),
    [draft, setDraft] = useState<Settings>(),
    [kind, setKind] = useState<NotificationEvent>("created"),
    [provider, setProvider] = useState<"smtp" | "mailjet" | "ses">("smtp"),
    [editTransport, setEditTransport] = useState(false),
    [preview, setPreview] = useState<{ subject: string; text: string }>();
  const { data, error, setData } = useLoad(
    () => api<Settings>("notifications.settings", scope),
    [projectId, version],
  );
  const action = useAction(),
    test = useAction();
  const current = draft ?? data;
  useUnsavedChanges(!!draft || editTransport || editSender || action.busy);
  const [testKey, setTestKey] = useState(() => crypto.randomUUID());
  const { data: history, error: historyError } = useLoad(
    () =>
      api<{
        items: Array<{
          id: string;
          recipient: string;
          event: string;
          status: string;
          attempts: number;
          revision: number;
          errorCode: string | null;
        }>;
      }>("notifications.deliveries", scope),
    [projectId, version],
    true,
  );
  const patch = (value: Partial<Settings>) =>
    current && setDraft({ ...current, ...value });
  async function save(form: HTMLFormElement) {
    if (!current) return;
    const fields = new FormData(form);
    let transport: MailTransport | undefined;
    let identity: MailIdentity | undefined;
    if (editTransport) {
      const value = (key: string) => String(fields.get(key) ?? "").trim();
      const secret = (key: string) => String(fields.get(key) ?? "") || undefined;
      identity = {
        fromName: value("fromName"),
        fromEmail: value("fromEmail"),
        ...(value("replyTo") ? { replyTo: value("replyTo") } : {}),
      };
      transport =
        provider === "smtp"
          ? {
              provider,
              host: value("host"),
              port: Number(value("port")) as 465 | 587,
              user: value("user"),
              password: secret("password"),
              ...(value("oauthClientId")
                ? {
                    oauth: {
                      clientId: value("oauthClientId"),
                      clientSecret: value("oauthClientSecret"),
                      refreshToken: value("oauthRefreshToken"),
                    },
                  }
                : {}),
            }
          : provider === "mailjet"
            ? { provider, apiKey: value("apiKey"), apiSecret: secret("apiSecret") }
            : {
                provider,
                authMode: sesAuthMode,
                region: value("region"),
                ...(sesAuthMode === "keys"
                  ? {
                      accessKeyId: secret("accessKeyId"),
                      secretAccessKey: secret("secretAccessKey"),
                      sessionToken: secret("sessionToken"),
                    }
                  : {}),
                configurationSet: value("configurationSet") || undefined,
              };
    }
    if (!editTransport && editSender && owner && projectId) {
      identity = {
        fromEmail: String(fields.get("projectFromEmail") ?? "").trim(),
        fromName: String(fields.get("projectFromName") ?? "").trim(),
        ...(fields.get("projectReplyTo")
          ? { replyTo: String(fields.get("projectReplyTo")).trim() }
          : {}),
      };
    }
    await action.run(async () => {
      const saved = await api<Settings>("notifications.configure", {
        ...scope,
        revision: current.revision,
        enabled: current.enabled,
        templates: current.templates,
        ...(transport ? { transport, identity } : identity ? { identity } : {}),
      });
      setData(saved);
      setDraft(undefined);
      setEditTransport(false);
      setEditSender(false);
      setVersion((v) => v + 1);
    }, "Email settings saved.");
  }
  if (!current)
    return (
      <>
        <ErrorNotice error={error} />
        {!error && <Loading />}
      </>
    );
  const template =
    current.templates[kind] ?? current.inheritedTemplates[kind] ?? defaultTemplates[kind];
  return (
    <section className="email-settings">
      <h2>{projectId ? "Project email notifications" : "Server email notifications"}</h2>
      <ErrorNotice error={error} />
      <p>
        {current.configured
          ? `Provider: ${current.provider}${current.inherited ? " · inherited from server" : ""}.`
          : "Configure a provider to enable email."}{" "}
        Each member chooses their own subscription.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save(e.currentTarget);
        }}
      >
        <fieldset disabled={action.busy}>
          <legend>Delivery and templates</legend>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={current.enabled}
              onChange={(e) => patch({ enabled: e.target.checked })}
            />
            Enable email notifications {projectId ? "for this project" : "by default"}
          </label>
          {owner && (
            <details
              open={editTransport}
              onToggle={(e) => {
                const open = e.currentTarget.open;
                if (open && !editTransport) {
                  setProvider(current.provider ?? "smtp");
                  setSesAuthMode(current.sesAuthMode ?? "role");
                }
                setEditTransport(open);
              }}
            >
              <summary>
                {current.inherited ? "Override server provider" : "Configure provider"}
              </summary>
              {editTransport && (
                <>
                  <Field label="Provider">
                    <select
                      value={provider}
                      onChange={(e) => setProvider(e.target.value as typeof provider)}
                    >
                      <option value="smtp">Google or custom SMTP</option>
                      <option value="mailjet">Mailjet API</option>
                      <option value="ses">Amazon SES API</option>
                    </select>
                  </Field>
                  <Field label="Sender name">
                    <input
                      name="fromName"
                      required
                      maxLength={100}
                      defaultValue={current.identity?.fromName ?? "Feedbacks"}
                    />
                  </Field>
                  <Field label="Sender email">
                    <input
                      type="email"
                      name="fromEmail"
                      required
                      defaultValue={current.identity?.fromEmail ?? ""}
                    />
                  </Field>
                  <Field label="Reply-to email (optional)">
                    <input
                      type="email"
                      name="replyTo"
                      defaultValue={current.identity?.replyTo ?? ""}
                    />
                  </Field>
                  {provider === "smtp" ? (
                    <>
                      <Field label="SMTP host">
                        <input name="host" required placeholder="smtp.gmail.com" />
                      </Field>
                      <Field label="TLS connection">
                        <select name="port" defaultValue="587">
                          <option value="587">STARTTLS · port 587</option>
                          <option value="465">TLS · port 465</option>
                        </select>
                      </Field>
                      <Field label="SMTP username">
                        <input name="user" required autoComplete="off" />
                      </Field>
                      <Field label="SMTP password or Google app password">
                        <input
                          type="password"
                          name="password"
                          autoComplete="new-password"
                        />
                      </Field>
                      <p className="muted">
                        Google requires an app password with two-step verification, or
                        OAuth. Existing secrets remain when left blank for the same
                        provider.
                      </p>
                      <details>
                        <summary>Google OAuth credentials</summary>
                        {["oauthClientId", "oauthClientSecret", "oauthRefreshToken"].map(
                          (key, index) => (
                            <Field
                              key={key}
                              label={
                                ["Client ID", "Client secret", "Refresh token"][index]
                              }
                            >
                              <input
                                name={key}
                                type="password"
                                autoComplete="new-password"
                              />
                            </Field>
                          ),
                        )}
                      </details>
                    </>
                  ) : provider === "mailjet" ? (
                    <>
                      <Field label="API key">
                        <input
                          name="apiKey"
                          type="password"
                          autoComplete="new-password"
                          required
                        />
                      </Field>
                      <Field label="API secret">
                        <input
                          name="apiSecret"
                          type="password"
                          autoComplete="new-password"
                        />
                      </Field>
                      <p className="muted">
                        Use a sender verified in your Mailjet account.
                      </p>
                    </>
                  ) : (
                    <>
                      <Field label="AWS region">
                        <input name="region" required placeholder="us-east-1" />
                      </Field>
                      <Field label="AWS authentication">
                        <select
                          value={sesAuthMode}
                          onChange={(event) =>
                            setSesAuthMode(event.target.value as typeof sesAuthMode)
                          }
                        >
                          <option value="role">Use the server AWS role</option>
                          <option value="keys">
                            Use saved or replacement access keys
                          </option>
                        </select>
                      </Field>
                      {sesAuthMode === "keys" && (
                        <>
                          {["accessKeyId", "secretAccessKey", "sessionToken"].map(
                            (key, index) => (
                              <Field
                                key={key}
                                label={
                                  [
                                    "Access key ID (leave both blank to keep saved keys)",
                                    "Secret access key",
                                    "Session token (optional)",
                                  ][index]
                                }
                              >
                                <input
                                  name={key}
                                  type="password"
                                  autoComplete="new-password"
                                />
                              </Field>
                            ),
                          )}
                          <p className="muted">
                            Replacement keys clear the previous session token unless you
                            supply a new one.
                          </p>
                        </>
                      )}
                      <Field label="Configuration set (optional)">
                        <input name="configurationSet" />
                      </Field>
                      <p className="muted">
                        Use a verified SES sender. Sandbox accounts can send only to
                        verified recipients.
                      </p>
                    </>
                  )}
                </>
              )}
            </details>
          )}
          {owner && projectId && !editTransport && (
            <details
              open={editSender}
              onToggle={(event) => setEditSender(event.currentTarget.open)}
            >
              <summary>Project sender</summary>
              <p>Use a different verified sender with the server’s email credentials.</p>
              {editSender && (
                <>
                  <Field label="Project sender name">
                    <input
                      name="projectFromName"
                      defaultValue={current.identity?.fromName ?? "Feedbacks"}
                      required
                    />
                  </Field>
                  <Field label="Project sender email">
                    <input
                      type="email"
                      name="projectFromEmail"
                      defaultValue={current.identity?.fromEmail ?? ""}
                      required
                    />
                  </Field>
                  <Field label="Project reply-to (optional)">
                    <input
                      type="email"
                      name="projectReplyTo"
                      defaultValue={current.identity?.replyTo ?? ""}
                    />
                  </Field>
                </>
              )}
            </details>
          )}
          <details>
            <summary>Configure notification templates</summary>
            <p>
              Plain-text templates support{" "}
              {templateVariables.map((v) => `{{${v}}}`).join(", ")}. Excerpts are included
              only when the recipient opts in.
            </p>
            <Field label="Event">
              <select
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value as NotificationEvent);
                  setPreview(undefined);
                }}
              >
                {notificationEvents.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </Field>
            <Field label="Subject">
              <input
                maxLength={200}
                value={template.subject}
                onChange={(e) =>
                  patch({
                    templates: {
                      ...current.templates,
                      [kind]: { ...template, subject: e.target.value },
                    },
                  })
                }
              />
            </Field>
            <Field label="Email text">
              <textarea
                rows={9}
                maxLength={20000}
                value={template.text}
                onChange={(e) =>
                  patch({
                    templates: {
                      ...current.templates,
                      [kind]: { ...template, text: e.target.value },
                    },
                  })
                }
              />
            </Field>
            <div className="actions">
              <button
                type="button"
                onClick={() =>
                  void action.run(async () =>
                    setPreview(
                      await api("notifications.preview", {
                        ...scope,
                        event: kind,
                        template,
                      }),
                    ),
                  )
                }
              >
                Preview template
              </button>
              <button
                type="button"
                onClick={() => {
                  const templates = { ...current.templates };
                  delete templates[kind];
                  patch({ templates });
                  setPreview(undefined);
                }}
              >
                Use inherited/default template
              </button>
            </div>
            {preview && (
              <div className="email-preview">
                <strong>{preview.subject}</strong>
                <pre>{preview.text}</pre>
              </div>
            )}
          </details>
          <button type="submit" className="primary">
            Save email settings
          </button>
        </fieldset>
        <ActionState action={action} />
        {action.errorCode === "CONFLICT" && (
          <button
            type="button"
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                const saved = await api<Settings>("notifications.settings", scope);
                setData(saved);
                setDraft(undefined);
                setEditTransport(false);
                setEditSender(false);
                setProvider(saved.provider ?? "smtp");
                setSesAuthMode(saved.sesAuthMode ?? "role");
                setPreview(undefined);
              }, "Saved email settings reloaded. Review them before editing again.")
            }
          >
            Reload saved settings
          </button>
        )}
      </form>
      {owner && projectId && !current.inherited && (
        <button
          type="button"
          disabled={action.busy}
          onClick={() =>
            void action.run(async () => {
              setData(
                await api("notifications.configure", {
                  projectId,
                  revision: current.revision,
                  enabled: current.enabled,
                  templates: current.templates,
                  inheritTransport: true,
                }),
              );
              setDraft(undefined);
            }, "Using server provider.")
          }
        >
          Use server provider
        </button>
      )}
      <div className="section">
        <button
          type="button"
          disabled={test.busy || !current.configured || !current.enabled}
          onClick={() =>
            void test.run(async () => {
              await api("notifications.test", { ...scope, idempotencyKey: testKey });
              setTestKey(crypto.randomUUID());
              setVersion((v) => v + 1);
            }, "Test queued to your own account. Check its acceptance status below.")
          }
        >
          Send test email to me
        </button>
        <ActionState action={test} />
        <h3>Recent email attempts</h3>
        <p className="muted">
          Accepted means the provider accepted the message; inbox delivery is not
          confirmed.
        </p>
        <ErrorNotice error={historyError} />
        {!history?.items.length ? (
          <p>No email attempts yet.</p>
        ) : (
          <ul className="email-deliveries">
            {history.items.map((item) => (
              <li key={item.id}>
                <span>
                  {item.recipient} · {item.event} · <strong>{item.status}</strong> ·{" "}
                  {item.attempts} attempts{item.errorCode ? ` · ${item.errorCode}` : ""}
                </span>
                {["failed", "uncertain"].includes(item.status) && (
                  <details>
                    <summary>Reconcile send</summary>
                    <p>
                      Check your provider before retrying. The original attempt may
                      already have been accepted.
                    </p>
                    <button
                      type="button"
                      disabled={action.busy}
                      onClick={() =>
                        void action.run(async () => {
                          await api("notifications.reconcile", {
                            ...scope,
                            deliveryId: item.id,
                            revision: item.revision,
                            decision: "accepted",
                          });
                          setVersion((v) => v + 1);
                        })
                      }
                    >
                      Provider confirms accepted
                    </button>
                    <button
                      type="button"
                      disabled={action.busy}
                      onClick={() =>
                        void action.run(async () => {
                          await api("notifications.reconcile", {
                            ...scope,
                            deliveryId: item.id,
                            revision: item.revision,
                            decision: "retry",
                            confirmedNotAccepted: true,
                          });
                          setVersion((v) => v + 1);
                        })
                      }
                    >
                      Confirmed not accepted · retry
                    </button>
                    <button
                      type="button"
                      disabled={action.busy}
                      onClick={() =>
                        void action.run(async () => {
                          await api("notifications.reconcile", {
                            ...scope,
                            deliveryId: item.id,
                            revision: item.revision,
                            decision: "cancel",
                          });
                          setVersion((v) => v + 1);
                        })
                      }
                    >
                      Cancel send
                    </button>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
