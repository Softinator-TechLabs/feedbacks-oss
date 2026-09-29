import React, { useState } from "react";
import { type Project, type Actor } from "../api.js";
import { Empty } from "../ui.js";
import { ProjectEditor } from "./editor.js";

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
