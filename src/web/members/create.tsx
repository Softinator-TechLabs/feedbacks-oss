import React, { useState } from "react";
import { api, type Project } from "../api.js";
import { ActionState, ErrorNotice, Field, useAction, useLoad } from "../ui.js";
import { memberWelcomeMessage, PasswordInput } from "./credentials.js";

export function CreateMember({
  onSaved,
  initiallyOpen = false,
  flat = false,
}: {
  project?: Project;
  onSaved: () => void;
  initiallyOpen?: boolean;
  flat?: boolean;
}) {
  const a = useAction(),
    [password, setPassword] = useState(""),
    [created, setCreated] = useState<{
      name: string;
      email: string;
      password: string;
    } | null>(null),
    { data, error } = useLoad(() => api<{ items: Project[] }>("projects.list", {}), []);
  const content = (
    <>
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
    </>
  );
  return flat ? (
    <section className="section member-action-panel">
      <h2>Create a user</h2>
      {content}
    </section>
  ) : (
    <details className="section member-action-panel" open={initiallyOpen}>
      <summary>Create a user</summary>
      {content}
    </details>
  );
}
