import { useState } from "react";
import { api, type Project, type Thread } from "../api.js";
import { ErrorNotice, Field, Loading, useLoad } from "../ui.js";
import {
  builtInCategories,
  categoryName,
  type ProjectTaxonomy,
} from "../../shared/taxonomy.js";
import { assignmentScope, type Assignee } from "./model.js";
import { decisions, type DelegationPage } from "./types.js";
export function ProjectAssignments({ project }: { project: Project }) {
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState("");
  const [offset, setOffset] = useState(0);
  const [version, setVersion] = useState(0);
  const { data: taxonomy } = useLoad<ProjectTaxonomy | undefined>(
    () =>
      open
        ? api<ProjectTaxonomy>("projects.taxonomy.get", { projectId: project.id })
        : Promise.resolve(undefined),
    [project.id, open, version],
  );
  const people = useLoad(
    () =>
      open
        ? api<{ items: Assignee[] }>("members.list", { projectId: project.id })
        : Promise.resolve(undefined),
    [project.id, open, version],
  );
  const page = useLoad(
    async () => {
      if (!open) return undefined;
      const result = await api<DelegationPage>("assignments.delegations", {
        projectId: project.id,
        ...(userId ? { userId } : {}),
        state: "active",
        offset,
        limit: 10,
      });
      const threads = new Map<string, Thread>();
      const threadIds = [
        ...new Set(
          result.items
            .filter((item) => item.annotationIds.length)
            .map((item) => item.threadId),
        ),
      ];
      await Promise.all(
        threadIds.map(async (threadId) => {
          const thread = await api<Thread>("threads.get", { threadId });
          threads.set(threadId, thread);
        }),
      );
      return { result, threads, userId, offset };
    },
    [project.id, open, userId, offset, version],
    true,
  );
  const data =
    page.data?.userId === userId && page.data?.offset === offset ? page.data : undefined;
  return (
    <details
      className="project-assignments section compact-details"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Assigned work</summary>
      <p>
        Browse project assignments by member. Current worker claims appear inside each
        thread.
      </p>
      <Field label="Assigned to">
        <select
          value={userId}
          onChange={(event) => {
            setUserId(event.target.value);
            setOffset(0);
          }}
        >
          <option value="">All project members</option>
          {people.data?.items.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
              {!person.active ? " (inactive)" : ""}
            </option>
          ))}
        </select>
      </Field>
      <ErrorNotice error={people.error || page.error} />
      {(people.error || page.error) && (
        <button type="button" onClick={() => setVersion((value) => value + 1)}>
          Retry assigned work
        </button>
      )}
      {!data && !page.error && open && <Loading />}
      {data && !data.result.total && <p>No active assignments for this selection.</p>}
      <ul className="project-assignment-list">
        {data?.result.items.map((item) => (
          <li key={item.id}>
            <div>
              <strong>{item.memberName}</strong>
              <span>
                {item.annotationIds.length
                  ? assignmentScope(item.annotationIds, data.threads.get(item.threadId)!)
                  : "Whole thread"}
              </span>
            </div>
            <a href={`/threads/${item.threadId}#thread-assignments`}>{item.summary}</a>
            <p>
              {categoryName(taxonomy?.categories ?? builtInCategories, item.category)} ·{" "}
              {decisions[item.githubDecision]}
            </p>
          </li>
        ))}
      </ul>
      {data && (data.result.total > 10 || offset > 0) && (
        <div className="actions assignment-pagination">
          <button
            type="button"
            disabled={!offset}
            onClick={() => setOffset(Math.max(0, offset - 10))}
          >
            Previous assignments
          </button>
          <span>
            {offset + 1}–{Math.min(offset + 10, data.result.total)} of {data.result.total}
          </span>
          <button
            type="button"
            disabled={data.result.nextOffset === null}
            onClick={() => setOffset(data.result.nextOffset!)}
          >
            Next assignments
          </button>
        </div>
      )}
    </details>
  );
}
