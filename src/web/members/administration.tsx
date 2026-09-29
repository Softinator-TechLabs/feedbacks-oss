import React, { useState } from "react";
import { api, type Actor } from "../api.js";
import {
  ActionState,
  ConfirmButton,
  ErrorNotice,
  Field,
  Loading,
  Secret,
  useAction,
  useLoad,
} from "../ui.js";
import { memberLoginDetails, PasswordInput } from "./credentials.js";
import { SafeMarkdown } from "./markdown.js";

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
