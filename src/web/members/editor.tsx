import React from "react";
import { MemberAdministration } from "../account-admin.js";
import { api, type Actor, type Project } from "../api.js";
import { ActionState, ConfirmButton, Field, useAction } from "../ui.js";
import type { Member } from "./types.js";
import { PolicyFields, readPolicy, expertiseCategories } from "./policy.js";
import { RoleSelect } from "./role-select.js";

export function MemberEditor({
  member: m,
  project,
  owner,
  actor,
  onSaved,
  onArchived,
}: {
  member: Member;
  project?: Project;
  owner: boolean;
  actor: Actor;
  onSaved: () => void;
  onArchived: () => void;
}) {
  const a = useAction();
  return (
    <section className="member-editor">
      <div className="member-editor-heading">
        <div>
          <h2>{m.name}</h2>
          {owner && <small>{m.email}</small>}
        </div>
        <span>
          {m.primaryOwner ? "Primary owner" : m.owner ? "Owner" : (m.role ?? "Member")}
          {!m.active ? " · Disabled" : ""}
        </span>
      </div>
      {owner && (!m.primaryOwner || actor.primaryOwner) ? (
        <>
          {project && !m.owner && (
            <form
              className="form-grid section"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void a.run(async () => {
                  await api("members.grant", {
                    projectId: project.id,
                    userId: m.id,
                    role: String(f.get("role")) as "reviewer",
                    canResolve: f.has("canResolve"),
                  });
                  onSaved();
                }, "Project permission saved.");
              }}
            >
              <Field label="Project role">
                <RoleSelect value={m.role} />
              </Field>
              <label className="check">
                <input name="canResolve" type="checkbox" defaultChecked={m.can_resolve} />
                May resolve feedback
              </label>
              <button disabled={a.busy}>Save permission</button>
              <ConfirmButton
                disabled={a.busy}
                onConfirm={() =>
                  a.run(async () => {
                    await api("members.grant", {
                      projectId: project.id,
                      userId: m.id,
                      role: "viewer",
                      remove: true,
                    });
                    onSaved();
                  }, "Project access removed.")
                }
              >
                Remove access
              </ConfirmButton>
            </form>
          )}
          <form
            className="form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void a.run(async () => {
                await api("members.update", {
                  userId: m.id,
                  name: String(f.get("name")),
                  active: actor.userId === m.id || f.has("active"),
                  classification: String(f.get("classification")) as "employee",
                  expertise: [
                    ...f.getAll("expertiseCategory").map(String),
                    ...String(f.get("otherExpertise") ?? "")
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  ],
                  policy: readPolicy(f),
                });
                onSaved();
              }, "Member saved.");
            }}
          >
            <Field label="Name">
              <input name="name" defaultValue={m.name} required maxLength={120} />
            </Field>
            <Field label="Classification">
              <select name="classification" defaultValue={m.classification ?? "external"}>
                <option value="employee">Employee</option>
                <option value="external">External</option>
              </select>
            </Field>
            <fieldset className="wide expertise-choices">
              <legend>Expertise</legend>
              <p className="muted">
                Select the topics this person knows. Agents use these as context, not as
                permissions.
              </p>
              <div className="expertise-options">
                {expertiseCategories.map((category) => (
                  <label className="check" key={category}>
                    <input
                      type="checkbox"
                      name="expertiseCategory"
                      value={category}
                      defaultChecked={m.expertise?.includes(category)}
                    />
                    {category}
                  </label>
                ))}
              </div>
              <Field label="Other expertise" hint="Optional, separated by commas">
                <input
                  name="otherExpertise"
                  defaultValue={m.expertise
                    ?.filter((item) => !expertiseCategories.includes(item))
                    .join(", ")}
                  placeholder="Typesetting, research"
                />
              </Field>
            </fieldset>
            <label className="check">
              <input
                name="active"
                type="checkbox"
                defaultChecked={m.active}
                disabled={actor.userId === m.id}
              />
              Account active
            </label>
            <details className="wide importance-details">
              <summary>Feedback importance (advanced)</summary>
              <p className="muted">
                This affects preference summaries, not access or permissions.
              </p>
              <PolicyFields policy={m.policy} />
            </details>
            <button disabled={a.busy}>Save person</button>
          </form>
          <details className="section compact-details">
            <summary>Account access and reviewer notes</summary>
            <MemberAdministration actor={actor} member={m} onSaved={onSaved} />
          </details>
          {project && !m.owner && (
            <form
              className="section"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void a.run(async () => {
                  await api("members.policy", {
                    projectId: project.id,
                    userId: m.id,
                    policy: f.has("inherit") ? null : readPolicy(f, "project-"),
                  });
                  onSaved();
                }, "Project importance saved.");
              }}
            >
              <h3>Project feedback weighting (advanced)</h3>
              <p className="muted">
                Use only when this person's input should count differently in this
                project.
              </p>
              <label className="check">
                <input
                  name="inherit"
                  type="checkbox"
                  defaultChecked={!m.project_policy}
                />
                Use global importance
              </label>
              <PolicyFields policy={m.project_policy ?? m.policy} prefix="project-" />
              <button disabled={a.busy}>Save project importance</button>
            </form>
          )}
          <ActionState action={a} />
          {!project && !m.owner && (!m.active || !!m.removedAt) && (
            <ConfirmButton
              disabled={a.busy}
              onConfirm={() =>
                a.run(
                  async () => {
                    await api("members.archive", {
                      userId: m.id,
                      archived: !m.removedAt,
                    });
                    onArchived();
                  },
                  m.removedAt
                    ? "Person restored to People. Account remains disabled."
                    : "Disabled person removed from People. History is kept.",
                )
              }
            >
              {m.removedAt ? "Restore to People" : "Remove disabled person from People"}
            </ConfirmButton>
          )}
        </>
      ) : (
        <p>{m.active ? "Active project member." : "Account disabled."}</p>
      )}
    </section>
  );
}
