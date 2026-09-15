import React, { useState } from "react";
import { api, type Actor } from "./api.js";
import { ActionState, ErrorNotice, Field, useAction } from "./ui.js";
export function AuthScreen({
  onAuthenticated,
  inviteToken = "",
  initialError = "",
}: {
  onAuthenticated: (actor: Actor) => void;
  inviteToken?: string;
  initialError?: string;
}) {
  const a = useAction(),
    [accepted, setAccepted] = useState(false);
  const invite = !!inviteToken && !accepted;
  return (
    <main className="auth">
      <a className="brand" href="/">
        Feedbacks
        <span className="brand-dot" />
      </a>
      <h1>{invite ? "Join your team" : "Sign in"}</h1>
      <p>
        {invite
          ? "Accept your invitation to start reviewing."
          : "Review your projects and keep the discussion moving."}
      </p>
      <ErrorNotice error={initialError} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void a.run(
            async () => {
              if (invite) {
                await api("auth.acceptInvite", {
                  token: inviteToken,
                  name: String(f.get("name")),
                  password: String(f.get("password")),
                });
                setAccepted(true);
                history.replaceState(null, "", "/");
              } else {
                const data = await api<{ actor: Actor }>("auth.login", {
                  email: String(f.get("email")),
                  password: String(f.get("password")),
                });
                onAuthenticated(data.actor);
              }
            },
            invite
              ? "Invitation accepted. Sign in with your email and new password."
              : "",
          );
        }}
      >
        {invite ? (
          <Field label="Your name">
            <input name="name" autoComplete="name" required maxLength={120} />
          </Field>
        ) : (
          <Field label="Email">
            <input name="email" inputMode="email" autoComplete="username" required />
          </Field>
        )}
        <Field label="Password" hint={invite ? "Use at least 10 characters." : undefined}>
          <input
            name="password"
            type="password"
            autoComplete={invite ? "new-password" : "current-password"}
            minLength={invite ? 10 : undefined}
            maxLength={1024}
            required
          />
        </Field>
        <ActionState action={a} />
        <button className="primary" disabled={a.busy}>
          {a.busy ? "Please wait…" : invite ? "Accept invitation" : "Sign in"}
        </button>
      </form>
      <p className="muted">Need access or a password reset? Contact your team owner.</p>
      <footer>
        <a href="/help">Help & extension</a>
        <a href="/privacy">Privacy</a>
      </footer>
    </main>
  );
}
export function Pairing({ pairingId }: { pairingId: string }) {
  const a = useAction(),
    [approved, setApproved] = useState(false);
  return (
    <section className="narrow">
      <h1>{approved ? "Extension connected" : "Connect Chrome extension"}</h1>
      <p>
        {approved
          ? "Return to Chrome to finish pairing. Manage or revoke this connection in Account."
          : "Approve only the pairing request you just opened from your Feedbacks extension. It can capture, comment and like within your current projects."}
      </p>
      {!approved && (
        <button
          className="primary"
          disabled={a.busy}
          onClick={() =>
            a.run(async () => {
              await api("pairing.approve", { pairingId });
              setApproved(true);
            })
          }
        >
          {a.busy ? "Connecting…" : "Approve connection"}
        </button>
      )}
      <ActionState action={a} />
    </section>
  );
}
