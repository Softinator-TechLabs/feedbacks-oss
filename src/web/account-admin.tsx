import React, { useEffect, useId, useState } from "react";
import { api, type Actor, type Project } from "./api.js";
import {
  Field,
  ActionState,
  ErrorNotice,
  Loading,
  Secret,
  ConfirmButton,
  useAction,
  useLoad,
  ExternalLink,
} from "./ui.js";

const PASSWORD_LENGTH = 10;
const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

export function memberWelcomeMessage(
  member: { name: string; email: string; password: string },
  origin: string,
) {
  return `Hey ${member.name}, Feedbacks par join karein: ${origin}/login\nEmail: ${member.email}\nPassword: ${member.password}\nChrome extension aur Codex, Claude Code, Antigravity agent setup: ${origin}/help\nPlease sign in karke password change kar dein.`;
}

export function memberLoginDetails(
  member: { email?: string; password: string },
  origin: string,
) {
  return `Feedbacks login: ${origin}/login${member.email ? `\nEmail: ${member.email}` : ""}\nPassword: ${member.password}\nPlease sign in and change this password.`;
}

function generatePassword() {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues)
    throw new Error("Secure password generation is unavailable in this browser.");
  const unbiasedLimit = 256 - (256 % PASSWORD_ALPHABET.length);
  let password = "";
  while (password.length < PASSWORD_LENGTH) {
    const bytes = cryptoApi.getRandomValues(
      new Uint8Array(PASSWORD_LENGTH - password.length),
    );
    for (const byte of bytes) {
      if (byte >= unbiasedLimit) continue;
      password += PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length];
      if (password.length === PASSWORD_LENGTH) break;
    }
  }
  return password;
}

function PasswordInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId(),
    statusId = `${id}-status`,
    [shown, setShown] = useState(false),
    [status, setStatus] = useState("");
  useEffect(() => {
    if (!value) {
      setShown(false);
      setStatus("");
    }
  }, [value]);
  return (
    <div className="field password-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        name="password"
        type={shown ? "text" : "password"}
        autoComplete="new-password"
        minLength={PASSWORD_LENGTH}
        maxLength={1024}
        required
        value={value}
        aria-describedby={statusId}
        spellCheck={false}
        autoCapitalize="none"
        onChange={(event) => {
          onChange(event.target.value);
          setStatus("");
        }}
      />
      <small>At least 10 characters.</small>
      <div className="password-actions">
        <button
          type="button"
          onClick={() => {
            try {
              onChange(generatePassword());
              setShown(false);
              setStatus("New password generated.");
            } catch (error) {
              setStatus(
                error instanceof Error ? error.message : "Password generation failed.",
              );
            }
          }}
        >
          Generate password
        </button>
        <button
          type="button"
          disabled={!value}
          aria-pressed={shown}
          onClick={() => setShown((current) => !current)}
        >
          {shown ? "Hide" : "Show"}
        </button>
        <button
          type="button"
          disabled={!value}
          onClick={() => {
            const write = navigator.clipboard?.writeText(value);
            if (!write) {
              setStatus("Could not copy. Select and copy the password manually.");
              return;
            }
            void write
              .then(() => setStatus("Password copied."))
              .catch(() =>
                setStatus("Could not copy. Select and copy the password manually."),
              );
          }}
        >
          Copy draft password
        </button>
      </div>
      <small id={statusId} role="status" aria-live="polite">
        {status}
      </small>
    </div>
  );
}

// React escapes all text. This deliberately small Markdown subset never loads
// remote images or accepts HTML; unsupported syntax stays visible as text.
export function SafeMarkdown({ body }: { body: string }) {
  const inline = (text: string) =>
    text
      .split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g)
      .map((part, n) => {
        if (part.startsWith("`")) return <code key={n}>{part.slice(1, -1)}</code>;
        if (part.startsWith("**")) return <strong key={n}>{part.slice(2, -2)}</strong>;
        const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
        return link ? (
          <ExternalLink key={n} href={link[2]}>
            {link[1]}
          </ExternalLink>
        ) : (
          part
        );
      });
  return (
    <div className="message">
      {body
        .split("\n")
        .map((line, n) =>
          line.startsWith("## ") ? (
            <h3 key={n}>{inline(line.slice(3))}</h3>
          ) : line.startsWith("# ") ? (
            <h2 key={n}>{inline(line.slice(2))}</h2>
          ) : (
            <p key={n}>{inline(line) || "\u00a0"}</p>
          ),
        )}
    </div>
  );
}
export function PasswordReplacement({
  resetToken,
  onChanged,
}: {
  resetToken?: string;
  onChanged: () => void;
}) {
  const a = useAction();
  return (
    <main className="auth">
      <a className="brand" href="/">
        Feedbacks
      </a>
      <h1>{resetToken ? "Reset password" : "Replace temporary password"}</h1>
      <p>
        Choose a new password before accessing projects. All existing sessions and
        connected tokens will be revoked.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void a.run(async () => {
            const password = String(f.get("password"));
            if (password !== f.get("confirm"))
              throw new Error("New passwords do not match.");
            if (resetToken)
              await api("auth.resetPassword", { token: resetToken, password });
            else
              await api("auth.changePassword", {
                currentPassword: String(f.get("currentPassword")),
                password,
              });
            history.replaceState(
              null,
              "",
              resetToken
                ? "/"
                : location.pathname === "/sign-in" &&
                    new URLSearchParams(location.search).get("returnTo") === "/help"
                  ? "/sign-in?returnTo=%2Fhelp"
                  : location.pathname,
            );
            onChanged();
          });
        }}
      >
        {!resetToken && (
          <Field label="Temporary password">
            <input
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
            />
          </Field>
        )}
        <Field label="New password" hint="At least 10 characters">
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={10}
            maxLength={1024}
            required
          />
        </Field>
        <Field label="Confirm new password">
          <input
            name="confirm"
            type="password"
            autoComplete="new-password"
            minLength={10}
            maxLength={1024}
            required
          />
        </Field>
        <button className="primary" disabled={a.busy}>
          Save password & sign in
        </button>
        <ActionState action={a} />
      </form>
    </main>
  );
}
export function CreateMember({
  onSaved,
  initiallyOpen = false,
}: {
  project?: Project;
  onSaved: () => void;
  initiallyOpen?: boolean;
}) {
  const a = useAction(),
    [password, setPassword] = useState(""),
    [created, setCreated] = useState<{
      name: string;
      email: string;
      password: string;
    } | null>(null),
    { data, error } = useLoad(() => api<{ items: Project[] }>("projects.list", {}), []);
  return (
    <details className="section member-action-panel" open={initiallyOpen}>
      <summary>Create a user</summary>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget,
            f = new FormData(form);
          void a.run(async () => {
            const details = {
              name: String(f.get("name")),
              email: String(f.get("email")),
              password: String(f.get("password")),
            };
            await api("members.create", {
              ...details,
              grants: f
                .getAll("projectIds")
                .map(String)
                .map((projectId) => ({
                  projectId,
                  role: String(f.get(`role:${projectId}`)) as
                    | "maintainer"
                    | "reviewer"
                    | "viewer",
                })),
            });
            form.reset();
            setPassword("");
            setCreated(details);
            onSaved();
          }, "User created. Deliver the password privately; it can be used immediately.");
        }}
      >
        <div className="form-grid">
          <Field label="Display name">
            <input name="name" maxLength={120} required autoComplete="off" />
          </Field>
          <Field label="Email">
            <input name="email" type="email" required autoComplete="off" />
          </Field>
          <PasswordInput label="Password" value={password} onChange={setPassword} />
        </div>
        <fieldset className="project-access">
          <legend>Project access</legend>
          <ErrorNotice error={error} />
          {data?.items.map((p) => (
            <div className="form-grid" key={p.id}>
              <label className="check">
                <input name="projectIds" type="checkbox" value={p.id} defaultChecked />
                {p.name}
              </label>
              <Field label={`Role in ${p.name}`}>
                <select name={`role:${p.id}`} defaultValue="maintainer">
                  <option value="viewer">Viewer</option>
                  <option value="reviewer">Reviewer</option>
                  <option value="maintainer">Maintainer</option>
                </select>
              </Field>
            </div>
          ))}
        </fieldset>
        <button className="primary" disabled={a.busy || !data}>
          Create user
        </button>
        <ActionState action={a} />
      </form>
      {created && (
        <div className="created-member-actions">
          <p>Created {created.name}. Send access in a private message.</p>
          <button
            type="button"
            onClick={() =>
              void a.run(
                () =>
                  navigator.clipboard.writeText(
                    memberWelcomeMessage(created, location.origin),
                  ),
                "Welcome message copied. Send it privately.",
              )
            }
          >
            Copy login and setup message
          </button>
          <button type="button" onClick={() => setCreated(null)}>
            Clear message
          </button>
        </div>
      )}
    </details>
  );
}
function MemberText({ userId, kind }: { userId: string; kind: "notes" | "guidance" }) {
  const { data, error, setData } = useLoad(
      () =>
        api<{ body: string; revision: number }>(
          kind === "notes" ? "members.notes.get" : "members.guidance.get",
          { userId },
        ),
      [userId],
    ),
    a = useAction(),
    [draft, setDraft] = useState<string>();
  const body = draft ?? data?.body ?? "";
  return (
    <section className="section">
      <h3>{kind === "notes" ? "Private Markdown" : "Agent guidance Markdown"}</h3>
      <p>
        {kind === "notes"
          ? "Only the primary owner can read or edit this text. It is never sent to agents."
          : "This advisory context can be sent to authorized agents with context.policy. Describe relevant expertise; never discount feedback based on language, age or family relationship."}
      </p>
      <ErrorNotice error={error} />
      {data ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void a.run(async () => {
              setData(
                await api(
                  kind === "notes" ? "members.notes.save" : "members.guidance.save",
                  { userId, body, revision: data.revision },
                ),
              );
            }, "Saved.");
          }}
        >
          <Field
            label={kind === "notes" ? "Private Markdown text" : "Agent guidance text"}
          >
            <textarea
              value={body}
              onChange={(e) => setDraft(e.target.value)}
              rows={5}
              maxLength={4000}
            />
          </Field>
          <details>
            <summary>Preview</summary>
            <SafeMarkdown body={body} />
          </details>
          <button disabled={a.busy}>
            Save {kind === "notes" ? "private text" : "agent guidance"}
          </button>
          <ActionState action={a} />
        </form>
      ) : (
        !error && <Loading />
      )}
    </section>
  );
}
export function MemberAdministration({
  actor,
  member,
  onSaved,
}: {
  actor: Actor;
  member: {
    id: string;
    email?: string;
    owner: boolean;
    primaryOwner?: boolean;
    active: boolean;
  };
  onSaved: () => void;
}) {
  const a = useAction(),
    [link, setLink] = useState(""),
    [password, setPassword] = useState(""),
    [savedPassword, setSavedPassword] = useState("");
  const protectedAccount = member.primaryOwner && !actor.primaryOwner;
  return (
    <>
      {actor.primaryOwner && (
        <>
          <MemberText userId={member.id} kind="notes" />
          <MemberText userId={member.id} kind="guidance" />
          {!member.primaryOwner && (
            <section className="section">
              <h3>Organization role</h3>
              <p>Owners manage all projects. Project roles remain project-specific.</p>
              <ConfirmButton
                disabled={a.busy}
                onConfirm={() =>
                  a.run(async () => {
                    await api("members.owner", {
                      userId: member.id,
                      owner: !member.owner,
                    });
                    onSaved();
                  }, "Organization role updated; existing sessions and tokens revoked.")
                }
              >
                {member.owner ? "Remove owner role" : "Make owner"}
              </ConfirmButton>
            </section>
          )}
        </>
      )}
      {!protectedAccount && member.active && (
        <section className="section">
          <h3>Reset password</h3>
          <p>
            Revokes sessions, agent and extension tokens, approved pairings and previous
            account links. No email is sent.
          </p>
          <form
            className="password-reset-form"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget,
                f = new FormData(form);
              const enteredPassword = String(f.get("password"));
              setSavedPassword("");
              void a.run(async () => {
                await api("members.resetPassword", {
                  userId: member.id,
                  password: enteredPassword,
                });
                form.reset();
                setPassword("");
                setLink("");
                setSavedPassword(enteredPassword);
              }, "Password saved. Deliver it privately; it can be used immediately.");
            }}
          >
            <PasswordInput label="New password" value={password} onChange={setPassword} />
            <button disabled={a.busy}>Set password</button>
          </form>
          {savedPassword && (
            <div className="created-member-actions">
              <p>New password saved. Copy the login details and send them privately.</p>
              <button
                type="button"
                disabled={a.busy}
                onClick={() =>
                  void a.run(
                    () =>
                      navigator.clipboard.writeText(
                        memberLoginDetails(
                          { email: member.email, password: savedPassword },
                          location.origin,
                        ),
                      ),
                    "Login details copied. Send them privately.",
                  )
                }
              >
                Copy password and login link
              </button>
              <button type="button" onClick={() => setSavedPassword("")}>
                Clear login details
              </button>
            </div>
          )}
          <button
            disabled={a.busy}
            onClick={() =>
              a.run(async () => {
                const r = await api("members.resetPassword", {
                  userId: member.id,
                });
                setSavedPassword("");
                setLink(`${location.origin}${r.resetPath}`);
              })
            }
          >
            Create seven-day single-use reset link
          </button>
          {link && (
            <Secret
              value={link}
              label="Reset link — copy and deliver privately; shown once."
            />
          )}
        </section>
      )}
      <ActionState action={a} />
    </>
  );
}
