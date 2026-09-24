import React, { useEffect, useState } from "react";
import { api, type Project, type Actor } from "./api.js";
import { ActionState, Field, Empty, useAction, ExternalLink } from "./ui.js";
export function ProjectEditor({
  project,
  canSetCaptureMode,
  onSaved,
}: {
  project?: Project;
  canSetCaptureMode: boolean;
  onSaved: (p: Project) => void;
}) {
  const a = useAction();
  const [latest, setLatest] = useState<Project>();
  const [captureMode, setCaptureMode] = useState<"origins" | "any">(
    project?.captureMode ?? "origins",
  );
  return (
    <form
      className="form-grid"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const input = {
          name: String(f.get("name")),
          captureMode,
          origins: String(f.get("origins"))
            .split(/\n/)
            .map((v) => v.trim())
            .filter(Boolean),
          ...(f.get("repositoryUrl")
            ? { repositoryUrl: String(f.get("repositoryUrl")) }
            : {}),
        };
        void a.run(
          async () =>
            onSaved(
              await api<Project>(
                project ? "projects.update" : "projects.create",
                project
                  ? {
                      ...input,
                      projectId: project.id,
                      revision: latest?.revision ?? project.revision,
                    }
                  : input,
              ),
            ),
          "Project saved.",
        );
      }}
    >
      <Field label="Project name">
        <input name="name" defaultValue={project?.name} required maxLength={120} />
      </Field>
      <Field label="Repository URL" hint="Optional">
        <input
          name="repositoryUrl"
          type="url"
          defaultValue={project?.repositoryUrl ?? ""}
        />
      </Field>
      <label className="check wide">
        <input
          name="captureMode"
          type="checkbox"
          value="any"
          checked={captureMode === "any"}
          onChange={(event) => setCaptureMode(event.target.checked ? "any" : "origins")}
          disabled={!canSetCaptureMode}
        />
        Any website
      </label>
      <p className="muted wide">
        Allow feedback from any HTTP(S) website. Only an owner can change this setting.
      </p>
      <Field
        label="Approved origins"
        hint="One origin per line, including https:// or http://. No paths or trailing slashes. Add localhost explicitly."
      >
        <textarea
          name="origins"
          defaultValue={project?.origins.join("\n")}
          placeholder="https://example.org"
          required={captureMode === "origins"}
          rows={3}
        />
      </Field>
      <div className="form-end">
        <ActionState action={a} />
        {project && a.error.includes("CONFLICT") && (
          <button
            type="button"
            onClick={() =>
              a.run(
                async () =>
                  setLatest(
                    await api<Project>("projects.get", {
                      projectId: project.id,
                    }),
                  ),
                "Latest settings loaded below. Compare them with your preserved draft before saving.",
              )
            }
          >
            Load latest settings for review
          </button>
        )}
        {latest && (
          <div className="section">
            <h3>Latest saved settings · revision {latest.revision}</h3>
            <p>{latest.name}</p>
            <p>{latest.captureMode === "any" ? "Any website" : "Approved origins"}</p>
            <p>{latest.origins.join(", ")}</p>
            <p>{latest.repositoryUrl}</p>
          </div>
        )}
        <button className="primary" disabled={a.busy}>
          {a.busy ? "Saving…" : project ? "Save project" : "Create project"}
        </button>
      </div>
    </form>
  );
}
export function Projects({
  projects,
  actor,
  onSaved,
}: {
  projects: Project[];
  actor: Actor;
  onSaved: (p: Project) => void;
}) {
  const [creating, setCreating] = useState(false);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Projects</h1>
          <p>Feedback, context and decisions in one place.</p>
        </div>
        {actor.owner && (
          <button className="primary" onClick={() => setCreating(!creating)}>
            {creating ? "Close form" : "New project"}
          </button>
        )}
      </div>
      {creating && (
        <section className="section">
          <h2>Create project</h2>
          <ProjectEditor
            canSetCaptureMode={actor.owner === true}
            onSaved={(p) => {
              setCreating(false);
              onSaved(p);
            }}
          />
        </section>
      )}
      {projects.length ? (
        <div className="project-list">
          {projects.map((p) => (
            <a className="project-row" key={p.id} href={`/projects/${p.id}`}>
              <div>
                <h2>{p.name}</h2>
                <p>{p.origins.join(" · ")}</p>
                {p.captureMode === "any" && <p>Any website</p>}
              </div>
              <span>{p.permissions.role}</span>
              <span aria-hidden="true">→</span>
            </a>
          ))}
        </div>
      ) : (
        <Empty title="No projects yet">
          {actor.owner
            ? "Create a project and add the origins your team will review."
            : "Your owner can give you access to a project. Refresh after access is granted."}
        </Empty>
      )}
    </>
  );
}
export function ProjectSettings({
  project,
  actor,
  onSaved,
}: {
  project: Project;
  actor: Actor;
  onSaved: (p: Project) => void;
}) {
  return (
    <>
      <h1>Project settings</h1>
      {project.permissions.canMaintain ? (
        <ProjectEditor
          key={project.revision}
          project={project}
          canSetCaptureMode={actor.owner === true}
          onSaved={onSaved}
        />
      ) : (
        <p>You can review this project’s origins. A maintainer can update them.</p>
      )}
      {project.permissions.canMaintain && (
        <GithubConnection project={project} onSaved={onSaved} />
      )}
      <section className="section">
        <h2>{project.captureMode === "any" ? "Website access" : "Approved origins"}</h2>
        {project.captureMode === "any" ? (
          <p>Feedback can be captured from any HTTP(S) website.</p>
        ) : (
          <ul>
            {project.origins.map((o) => (
              <li key={o}>
                <ExternalLink href={o}>{o}</ExternalLink>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

type GithubConnectionState = {
  configured: boolean;
  connected: boolean;
  repositoryUrl: string | null;
  installUrl: string | null;
};

function GithubConnection({
  project,
  onSaved,
}: {
  project: Project;
  onSaved: (p: Project) => void;
}) {
  const action = useAction();
  const [state, setState] = useState<GithubConnectionState | null>(null);
  const [loadError, setLoadError] = useState(false);
  useEffect(() => {
    let active = true;
    void api<GithubConnectionState>("github.connection", { projectId: project.id })
      .then((value) => {
        if (active) {
          setState(value);
          setLoadError(false);
        }
      })
      .catch(() => {
        if (active) {
          setState(null);
          setLoadError(true);
        }
      });
    return () => {
      active = false;
    };
  }, [project.id, project.revision]);
  return (
    <section className="section">
      <h2>GitHub Issues</h2>
      <p>
        Send a reviewed thread to the connected repository. Feedbacks never creates an
        Issue from a new comment by itself.
      </p>
      {state === null ? (
        <p className="muted">
          {loadError
            ? "Could not load the connection. Reload this page to try again."
            : "Checking GitHub connection…"}
        </p>
      ) : !state.configured ? (
        <p className="muted">
          The server owner can enable the optional GitHub App integration.
        </p>
      ) : !state.repositoryUrl ? (
        <p className="muted">Save a GitHub repository URL above, then connect the App.</p>
      ) : (
        <>
          <p>
            {state.connected ? "Connected to" : "Repository:"} {state.repositoryUrl}
          </p>
          {!state.connected && state.installUrl && (
            <p>
              <ExternalLink href={state.installUrl}>
                Install the GitHub App on this repository
              </ExternalLink>
            </p>
          )}
          <button
            type="button"
            disabled={action.busy}
            onClick={() =>
              void action.run(
                async () => {
                  const updated = await api<Project>(
                    state.connected ? "github.disconnect" : "github.connect",
                    {
                      projectId: project.id,
                      revision: project.revision,
                    },
                  );
                  onSaved(updated);
                  setState({ ...state, connected: !state.connected });
                },
                state.connected ? "GitHub App disconnected." : "GitHub App connected.",
              )
            }
          >
            {state.connected ? "Disconnect GitHub" : "Verify and connect"}
          </button>
          <ActionState action={action} />
        </>
      )}
    </section>
  );
}
