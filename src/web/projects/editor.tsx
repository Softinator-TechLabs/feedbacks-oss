import React, { useState } from "react";
import { api, type Project } from "../api.js";
import { ActionState, Field, useAction } from "../ui.js";

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
      className="form-grid project-basics-form"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const input = {
          name: String(f.get("name")),
          captureMode,
          reviewEnabled: f.has("reviewEnabled"),
          documentsEnabled: f.has("documentsEnabled"),
          surveysEnabled: f.has("surveysEnabled"),
          origins: String(f.get("origins"))
            .split(/\n/)
            .map((v) => v.trim())
            .filter(Boolean),
          ...(project?.repositoryUrl || f.get("repositoryUrl")
            ? { repositoryUrl: project?.repositoryUrl ?? String(f.get("repositoryUrl")) }
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
      {!project && (
        <Field label="Repository URL" hint="Optional; you can connect GitHub later">
          <input name="repositoryUrl" type="url" />
        </Field>
      )}
      <label className="check wide">
        <input
          name="reviewEnabled"
          type="checkbox"
          defaultChecked={project?.reviewEnabled ?? false}
        />
        Require a separate review decision
      </label>
      <p className="muted wide">
        For client sign-off. Keep this off when status and discussion are enough.
      </p>
      <div className="wide project-optional-tools">
        <strong>Optional tools</strong>
        <p className="muted">Add these tabs only when this project needs them.</p>
        <label className="check">
          <input
            name="documentsEnabled"
            type="checkbox"
            defaultChecked={project?.documentsEnabled ?? false}
          />
          Document review
        </label>
        <label className="check">
          <input
            name="surveysEnabled"
            type="checkbox"
            defaultChecked={project?.surveysEnabled ?? false}
          />
          Surveys and polls
        </label>
      </div>
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
