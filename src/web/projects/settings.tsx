import { EmailSubscription } from "../notifications/subscription.js";
import { TimeTrackingSettings } from "../integrations/time-tracking.js";
import { ChannelSettings } from "../integrations/channels.js";
import { TrackerSettingsPage } from "../integrations/trackers.js";
import { PermanentIntake } from "./permanent-intake.js";
import { EmailSettings } from "../notifications/settings.js";
import React, { useEffect, useState } from "react";
import { type Project, type Actor } from "../api.js";
import { GuestProjectLinks } from "../guest-project-review.js";
import { ProjectTaxonomySettings } from "../project-taxonomy.js";
import { ExternalLink } from "../ui.js";
import { ProjectEditor } from "./editor.js";
import { ScheduledQaSettings } from "./scheduled-qa.js";
import { WebhookSettings } from "./webhooks.js";

import { SectionTabs, type SectionTab } from "../section-tabs.js";

type ProjectSettingsTab =
  | "project"
  | "taxonomy"
  | "integrations"
  | "notifications"
  | "widget"
  | "advanced";
type ProjectIntegrationTab = "tasks" | "channels" | "github" | "webhooks" | "time";
type SettingsSelection = {
  tab: ProjectSettingsTab;
  integration: ProjectIntegrationTab;
};
type SettingsNavigation = SettingsSelection & {
  visitedSections: ProjectSettingsTab[];
  visitedIntegrations: ProjectIntegrationTab[];
};

function projectSettingsSelectionFromHash(canMaintain: boolean): SettingsSelection {
  const hash = typeof window === "undefined" ? "" : window.location.hash.slice(1);
  const defaultIntegration = canMaintain ? "tasks" : "github";
  if (hash === "notifications" || hash === "integrations-email")
    return { tab: "notifications", integration: defaultIntegration };
  const integration = hash.slice("integrations-".length);
  if (
    hash === "integrations" ||
    (hash.startsWith("integrations-") &&
      ["tasks", "channels", "github", "webhooks", "time"].includes(integration))
  )
    return {
      tab: "integrations",
      integration: canMaintain
        ? hash === "integrations"
          ? defaultIntegration
          : (integration as ProjectIntegrationTab)
        : "github",
    };
  if (canMaintain && hash === "widget")
    return { tab: "widget", integration: defaultIntegration };
  if (canMaintain && (hash === "taxonomy" || hash === "project-taxonomy"))
    return { tab: "taxonomy", integration: defaultIntegration };
  if (canMaintain && hash === "advanced")
    return { tab: "advanced", integration: defaultIntegration };
  return { tab: "project", integration: defaultIntegration };
}

function visitSettings(
  selection: SettingsSelection,
  previous?: SettingsNavigation,
): SettingsNavigation {
  const visitedSections = previous?.visitedSections ?? [];
  const visitedIntegrations = previous?.visitedIntegrations ?? [];
  return {
    ...selection,
    visitedSections: visitedSections.includes(selection.tab)
      ? visitedSections
      : [...visitedSections, selection.tab],
    visitedIntegrations:
      selection.tab !== "integrations" ||
      visitedIntegrations.includes(selection.integration)
        ? visitedIntegrations
        : [...visitedIntegrations, selection.integration],
  };
}

type ProjectSettingsProps = {
  project: Project;
  actor: Actor;
  onSaved: (p: Project) => void;
};

export function ProjectSettings(props: ProjectSettingsProps) {
  return (
    <ProjectSettingsContent
      key={`${props.project.id}:${props.actor.id}:${props.actor.owner === true}:${props.project.permissions.canMaintain}`}
      {...props}
    />
  );
}

function ProjectSettingsContent({ project, actor, onSaved }: ProjectSettingsProps) {
  const [editorVersion, setEditorVersion] = useState(0);
  const canMaintain = project.permissions.canMaintain;
  const [navigation, setNavigation] = useState<SettingsNavigation>(() =>
    visitSettings(projectSettingsSelectionFromHash(canMaintain)),
  );
  useEffect(() => {
    const selectHash = () =>
      setNavigation((previous) =>
        visitSettings(projectSettingsSelectionFromHash(canMaintain), previous),
      );
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
    ...(canMaintain
      ? [{ id: "widget" as const, label: "Website widget", panelId: "settings-widget" }]
      : []),
    {
      id: "notifications",
      label: "Email notifications",
      panelId: "settings-notifications",
    },
    { id: "integrations", label: "Integrations", panelId: "settings-integrations" },
    ...(canMaintain
      ? [{ id: "advanced" as const, label: "Advanced", panelId: "settings-advanced" }]
      : []),
  ];
  const integrationTabs: SectionTab<ProjectIntegrationTab>[] = canMaintain
    ? [
        { id: "tasks", label: "Tasks", panelId: "integrations-tasks" },
        { id: "channels", label: "Slack & Teams", panelId: "integrations-channels" },
        { id: "github", label: "GitHub", panelId: "integrations-github" },
        { id: "webhooks", label: "Webhooks", panelId: "integrations-webhooks" },
        { id: "time", label: "Time tracking", panelId: "integrations-time" },
      ]
    : [{ id: "github", label: "GitHub", panelId: "integrations-github" }];
  const selected = navigation.tab;
  const selectTab = (next: ProjectSettingsTab) => {
    setNavigation((previous) => visitSettings({ ...previous, tab: next }, previous));
    const hash =
      next === "integrations"
        ? `integrations-${navigation.integration}`
        : next === "taxonomy"
          ? "project-taxonomy"
          : next;
    history.replaceState(history.state, "", `#${hash}`);
    window.scrollTo(0, 0);
  };
  const selectIntegration = (integration: ProjectIntegrationTab) => {
    setNavigation((previous) =>
      visitSettings({ tab: "integrations", integration }, previous),
    );
    history.replaceState(history.state, "", `#integrations-${integration}`);
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
        {navigation.visitedSections.includes("project") && (
          <>
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
              <h2>
                {project.captureMode === "any" ? "Website access" : "Approved origins"}
              </h2>
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
        )}
      </div>
      {canMaintain && (
        <div
          className="section-panel"
          id="settings-taxonomy"
          role="tabpanel"
          aria-labelledby="project-settings-tab-taxonomy"
          hidden={selected !== "taxonomy"}
        >
          {navigation.visitedSections.includes("taxonomy") && (
            <ProjectTaxonomySettings
              projectId={project.id}
              projectRevision={project.revision}
              onProjectSaved={onSaved}
            />
          )}
        </div>
      )}
      <div
        className="section-panel"
        id="settings-notifications"
        role="tabpanel"
        aria-labelledby="project-settings-tab-notifications"
        hidden={selected !== "notifications"}
      >
        {navigation.visitedSections.includes("notifications") && (
          <>
            <EmailSubscription projectId={project.id} />
            {canMaintain && (
              <EmailSettings projectId={project.id} owner={actor.owner === true} />
            )}
          </>
        )}
      </div>
      <div
        className="section-panel"
        id="settings-integrations"
        role="tabpanel"
        aria-labelledby="project-settings-tab-integrations"
        hidden={selected !== "integrations"}
      >
        {navigation.visitedSections.includes("integrations") && (
          <>
            <div className="project-integration-tabs">
              <SectionTabs
                label="Project integration providers"
                idPrefix="project-integration-tab"
                tabs={integrationTabs}
                selected={navigation.integration}
                onSelect={selectIntegration}
              />
            </div>
            {integrationTabs.map(({ id, panelId }) => (
              <div
                key={id}
                className="project-integration-panel"
                id={panelId}
                role="tabpanel"
                aria-labelledby={`project-integration-tab-${id}`}
                hidden={navigation.integration !== id}
              >
                {navigation.visitedIntegrations.includes(id) &&
                  (id === "tasks" ? (
                    <TrackerSettingsPage
                      projects={[]}
                      project={project}
                      owner={actor.owner === true}
                    />
                  ) : id === "channels" ? (
                    <ChannelSettings projectId={project.id} />
                  ) : id === "github" ? (
                    <section className="section project-github-setting">
                      <h2>GitHub Issues</h2>
                      <p className="muted">
                        {project.githubConnected ? "Connected" : "Off"}
                      </p>
                      <a href={`/projects/${project.id}/github`}>
                        {project.githubConnected ? "Manage connection" : "Set up GitHub"}
                      </a>
                    </section>
                  ) : id === "webhooks" ? (
                    <WebhookSettings projectId={project.id} />
                  ) : (
                    <TimeTrackingSettings
                      projectId={project.id}
                      owner={actor.owner === true}
                    />
                  ))}
              </div>
            ))}
          </>
        )}
      </div>
      {canMaintain && (
        <div
          className="section-panel"
          id="settings-widget"
          role="tabpanel"
          aria-labelledby="project-settings-tab-widget"
          hidden={selected !== "widget"}
        >
          {navigation.visitedSections.includes("widget") && (
            <>
              <PermanentIntake project={project} />
              <GuestProjectLinks
                projectId={project.id}
                widget
                origins={project.origins}
                captureMode={project.captureMode}
              />
            </>
          )}
        </div>
      )}
      {canMaintain && (
        <div
          className="section-panel"
          id="settings-advanced"
          role="tabpanel"
          aria-labelledby="project-settings-tab-advanced"
          hidden={selected !== "advanced"}
        >
          {navigation.visitedSections.includes("advanced") && (
            <>
              <h2>Advanced settings</h2>
              <ScheduledQaSettings projectId={project.id} />
              <GuestProjectLinks projectId={project.id} />
            </>
          )}
        </div>
      )}
    </>
  );
}
