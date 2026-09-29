import React, { useEffect, useState } from "react";
import { type Project, type Actor } from "../api.js";
import { GuestProjectLinks } from "../guest-project-review.js";
import { ProjectTaxonomySettings } from "../project-taxonomy.js";
import { ExternalLink } from "../ui.js";
import { ProjectEditor } from "./editor.js";
import { ScheduledQaSettings } from "./scheduled-qa.js";
import { WebhookSettings } from "./webhooks.js";

import { SectionTabs, type SectionTab } from "../section-tabs.js";

type ProjectSettingsTab = "project" | "taxonomy" | "integrations" | "advanced";

function projectSettingsTabFromHash(canMaintain: boolean): ProjectSettingsTab {
  const hash = typeof window === "undefined" ? "" : window.location.hash.slice(1);
  if (hash === "integrations") return "integrations";
  if (canMaintain && (hash === "taxonomy" || hash === "project-taxonomy"))
    return "taxonomy";
  if (canMaintain && hash === "advanced") return "advanced";
  return "project";
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
  const [editorVersion, setEditorVersion] = useState(0);
  const canMaintain = project.permissions.canMaintain;
  const [tab, setTab] = useState<ProjectSettingsTab>(() =>
    projectSettingsTabFromHash(canMaintain),
  );
  useEffect(() => {
    const selectHash = () => setTab(projectSettingsTabFromHash(canMaintain));
    window.addEventListener("hashchange", selectHash);
    return () => window.removeEventListener("hashchange", selectHash);
  }, [canMaintain]);
  const tabs: SectionTab<ProjectSettingsTab>[] = [
    { id: "project", label: "Project", panelId: "settings-project" },
    ...(canMaintain
      ? [
          {
            id: "taxonomy" as const,
            label: "Categories & tags",
            panelId: "settings-taxonomy",
          },
        ]
      : []),
    { id: "integrations", label: "Integrations", panelId: "settings-integrations" },
    ...(canMaintain
      ? [{ id: "advanced" as const, label: "Advanced", panelId: "settings-advanced" }]
      : []),
  ];
  const selected =
    canMaintain || (tab !== "taxonomy" && tab !== "advanced") ? tab : "project";
  const selectTab = (next: ProjectSettingsTab) => {
    setTab(next);
    history.replaceState(null, "", `#${next === "taxonomy" ? "project-taxonomy" : next}`);
    window.scrollTo(0, 0);
  };
  return (
    <>
      <h1>Project settings</h1>
      <SectionTabs
        label="Project settings sections"
        idPrefix="project-settings-tab"
        tabs={tabs}
        selected={selected}
        onSelect={selectTab}
      />
      <div
        className="section-panel"
        id="settings-project"
        role="tabpanel"
        aria-labelledby="project-settings-tab-project"
        hidden={selected !== "project"}
      >
        <h2>Project details</h2>
        {canMaintain ? (
          <ProjectEditor
            key={editorVersion}
            project={project}
            canSetCaptureMode={actor.owner === true}
            onSaved={(saved) => {
              setEditorVersion((version) => version + 1);
              onSaved(saved);
            }}
          />
        ) : (
          <p>You can review this project’s origins. A maintainer can update them.</p>
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
      </div>
      {canMaintain && (
        <div
          className="section-panel"
          id="settings-taxonomy"
          role="tabpanel"
          aria-labelledby="project-settings-tab-taxonomy"
          hidden={selected !== "taxonomy"}
        >
          <ProjectTaxonomySettings
            projectId={project.id}
            projectRevision={project.revision}
            onProjectSaved={onSaved}
          />
        </div>
      )}
      <div
        className="section-panel"
        id="settings-integrations"
        role="tabpanel"
        aria-labelledby="project-settings-tab-integrations"
        hidden={selected !== "integrations"}
      >
        <section className="section project-github-setting">
          <h2>GitHub Issues</h2>
          <p className="muted">
            {project.githubConnected
              ? "Connected to this project."
              : "Off for this project."}{" "}
            Create Issues from feedback only after connecting a repository.
          </p>
          <a href={`/projects/${project.id}/github`}>
            {project.githubConnected ? "Manage GitHub connection" : "Set up GitHub"}
          </a>
        </section>
        {canMaintain && <WebhookSettings projectId={project.id} />}
      </div>
      {canMaintain && (
        <div
          className="section-panel"
          id="settings-advanced"
          role="tabpanel"
          aria-labelledby="project-settings-tab-advanced"
          hidden={selected !== "advanced"}
        >
          <h2>Advanced settings</h2>
          <ScheduledQaSettings projectId={project.id} />
          <GuestProjectLinks projectId={project.id} />
        </div>
      )}
    </>
  );
}
