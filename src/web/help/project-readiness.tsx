import React from "react";
import { api, type Actor, type Project } from "../api.js";
import { Icon } from "../icons.js";
import { useLoad } from "../ui.js";
import { WatchStep } from "./watch-step.js";

export function ProjectReadiness({ actor, project }: { actor: Actor; project: Project }) {
  const { data, error } = useLoad(async () => {
    const [members, context] = await Promise.all([
      api<{ items: { id: string; active: boolean; removedAt?: string | null }[] }>(
        "members.list",
        { projectId: project.id },
      ),
      api<{ items: { body: string }[] }>("instructions.get", { projectId: project.id }),
    ]);
    return {
      colleagues: members.items.some(
        (member) => member.id !== actor.userId && member.active && !member.removedAt,
      ),
      context: !!context.items[0]?.body.trim(),
    };
  }, [project.id, actor.userId]);
  return (
    <>
      {data && (
        <p className="help-readiness-title">
          {data.colleagues && data.context ? "Project ready" : "Project setup"}
        </p>
      )}
      {!data && !error && <p className="muted">Checking project…</p>}
      {error && (
        <p className="muted">
          Couldn’t check setup. <a href={`/projects/${project.id}`}>Open project</a> to
          check.
        </p>
      )}
      {data && (
        <div className="help-project-status" role="status">
          <span>
            {data.colleagues ? (
              <>
                <Icon name="check" /> Members ready
              </>
            ) : actor.owner ? (
              <a href={`/projects/${project.id}/members`}>Add teammates</a>
            ) : (
              "Ask your owner to add teammates."
            )}
          </span>
          <span>
            {data.context ? (
              <>
                <Icon name="check" /> Context ready
              </>
            ) : project.permissions.canMaintain ? (
              <a href={`/projects/${project.id}/instructions`}>Add project context</a>
            ) : (
              "Ask a maintainer to add project context."
            )}
          </span>
        </div>
      )}
      {data && actor.owner && (!data.colleagues || !data.context) && (
        <WatchStep step="project" title="Show project setup" />
      )}
    </>
  );
}
