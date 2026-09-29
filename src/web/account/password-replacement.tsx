import React from "react";
import { api } from "../api.js";
import { ActionState, Field, useAction } from "../ui.js";

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
