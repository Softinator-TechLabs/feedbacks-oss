import { DeleteThreadsButton, ThreadDeletionCleanup } from "./deletion.js";
import { useEffect, useRef, useState } from "react";
import { calendarDate, localTimeZone } from "../work-plan-model.js";
import { ProjectAssignments } from "../assignments/project-assignments.js";
import type { Assignee } from "../assignments/model.js";
import { usePageLocation, navigate } from "../navigation.js";
import {
  readFilters,
  readOffset,
  filterQuery,
  matchesWorkStatus,
} from "../review-filters.js";
import { api, labels, type Actor, type Project, type Thread } from "../api.js";
import type { ProjectTaxonomy } from "../../shared/taxonomy.js";
import type { ReviewFilters } from "../../shared/contracts.js";
import { Empty, ErrorNotice, Loading, Notice, useAction, useLoad } from "../ui.js";
import { ThreadListFilters } from "./list-filters.js";
import { ThreadComposer } from "./composer.js";
import { ThreadListRow } from "./list-row.js";
export { threadAttachmentLabels } from "./list-row.js";

export function ThreadList({ project, actor }: { project: Project; actor: Actor }) {
  const pageLocation = usePageLocation(),
    query = pageLocation.split("?")[1] ?? "";
  const filters = readFilters(query),
    offset = readOffset(query);
  if (filters.sort === "workPlan" && !filters.planningDate)
    filters.planningDate = calendarDate(new Date(), localTimeZone());
  const {
    search,
    url,
    domain,
    hostname,
    deviceClass,
    sort,
    showResolved,
    category,
    tag,
  } = filters;
  const [creating, setCreating] = useState(false),
    [filtersOpen, setFiltersOpen] = useState(false),
    [draft, setDraft] = useState<ReviewFilters>(filters),
    [version, setVersion] = useState(0),
    [selected, setSelected] = useState<Set<string>>(new Set());
  const filterTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [statusRecovery, setStatusRecovery] = useState<{
    previous: Thread;
    updated: Thread;
    query: string;
    projectId: string;
  }>();
  const recoveryAction = useAction();
  const canUndoStatus =
    project.permissions.canResolve ||
    !["resolved", "declined"].includes(statusRecovery?.previous.work.state ?? "");
  useEffect(() => setSelected(new Set()), [project.id, query]);
  useEffect(() => {
    setDraft(readFilters(query));
    return () => clearTimeout(filterTimer.current);
  }, [project.id, query]);
  const activeFilterCount = [
    search,
    url,
    domain,
    hostname,
    deviceClass,
    category,
    tag,
    sort !== "activity",
    filters.assignedTo,
    filters.workState,
    showResolved,
  ].filter(Boolean).length;
  const {
    data: loaded,
    setData: setLoaded,
    error,
  } = useLoad(
    async () => ({
      query,
      projectId: project.id,
      result: await api<{
        items: Thread[];
        total: number;
        nextOffset: number | null;
        websiteFilters: { domains: string[]; hostnames: string[] };
        summary?: {
          threads: { open: number; closed: number; total: number };
          points: { open: number; resolved: number; closed: number; total: number };
        };
      }>("threads.list", {
        projectId: project.id,
        ...filters,
        offset,
        includeSummary: true,
      }),
    }),
    [project.id, query, version],
    true,
  );
  const { data: taxonomy, error: taxonomyError } = useLoad<ProjectTaxonomy>(
    () => api("projects.taxonomy.get", { projectId: project.id }),
    [project.id, version],
  );
  const { data: members, error: membersError } = useLoad<{ items: Assignee[] }>(
    () => api("members.list", { projectId: project.id }),
    [project.id],
  );
  const data =
    loaded?.query === query && loaded.projectId === project.id
      ? loaded.result
      : undefined;
  const apply = (
    next = filters,
    nextOffset = 0,
    navigationOptions: { replace?: boolean; preservePosition?: boolean } = {},
  ) => {
    clearTimeout(filterTimer.current);
    const safeNext =
      next.url && !URL.canParse(next.url)
        ? {
            ...next,
            url: filters.url && URL.canParse(filters.url) ? filters.url : undefined,
          }
        : next;
    return navigate(
      `/projects/${project.id}${filterQuery(safeNext.sort === "workPlan" && !safeNext.planningDate ? { ...safeNext, planningDate: calendarDate(new Date(), localTimeZone()) } : safeNext, nextOffset)}`,
      navigationOptions,
    );
  };
  const updateFilter = (next: ReviewFilters, debounceMs = 0, editingUrl = false) => {
    setDraft(next);
    clearTimeout(filterTimer.current);
    const invalidUrl = !!next.url && !URL.canParse(next.url);
    if (editingUrl && invalidUrl) return;
    if (debounceMs) {
      filterTimer.current = setTimeout(
        () => apply(next, 0, { replace: true, preservePosition: true }),
        debounceMs,
      );
    } else apply(next, 0, { preservePosition: true });
  };
  const handleSelectionChange = (id: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };
  const handlePrioritySaved = (updated: Thread) => {
    setLoaded((current) =>
      current && current.query === query
        ? {
            ...current,
            result: {
              ...current.result,
              items: current.result.items.map((item) =>
                item.id === updated.id ? updated : item,
              ),
            },
          }
        : current,
    );
    setVersion((value) => value + 1);
  };
  const handleStatusSaved = (updated: Thread, previous?: Thread) => {
    const leavesView = !matchesWorkStatus(updated.work.state, filters);
    if (previous && leavesView) {
      recoveryAction.setError("");
      setStatusRecovery({ previous, updated, query, projectId: project.id });
    }
    setLoaded((current) => {
      if (!current || current.query !== query || current.projectId !== project.id)
        return current;
      return {
        ...current,
        result: {
          ...current.result,
          items: leavesView
            ? current.result.items.filter((item) => item.id !== updated.id)
            : current.result.items.map((item) =>
                item.id === updated.id ? updated : item,
              ),
          total: current.result.total - (leavesView ? 1 : 0),
        },
      };
    });
    setVersion((value) => value + 1);
  };
  return (
    <>
      <div className="page-heading thread-list-heading">
        <div>
          <h1>{filters.archived ? "Archived feedback" : "Feedback"}</h1>
          <p>
            {data
              ? `${data.total} ${data.total === 1 ? "thread" : "threads"}`
              : "Project discussion"}{" "}
          </p>
          {data?.summary && (
            <p className="muted">
              {[
                `${data.summary.points.open} open points`,
                `${data.summary.points.resolved} resolved points`,
                ...(data.summary.points.closed
                  ? [`${data.summary.points.closed} closed points`]
                  : []),
                `${data.summary.threads.closed} closed threads in this selection`,
              ].join(" · ")}
            </p>
          )}
        </div>
        <div className="thread-list-quick-actions">
          {project.permissions.canMaintain && (
            <a
              className="button"
              href={`/projects/${project.id}/settings#project-taxonomy`}
            >
              Manage categories &amp; tags
            </a>
          )}
          <button
            type="button"
            aria-pressed={filters.assignedTo === actor.userId}
            onClick={() =>
              apply({
                ...filters,
                assignedTo:
                  filters.assignedTo === actor.userId ? undefined : actor.userId,
              })
            }
          >
            Assigned to me
          </button>
          <button
            type="button"
            aria-pressed={!!filters.archived}
            onClick={() =>
              apply({
                ...readFilters(""),
                archived: !filters.archived,
                showResolved: !!!filters.archived,
              })
            }
          >
            {filters.archived ? "Back to inbox" : "Archive"}
          </button>
          {actor.owner && (
            <button
              className="thread-priority-button"
              aria-pressed={sort === "priority"}
              title="Sort active feedback by current reviewer importance and view support"
              onClick={() => apply({ ...filters, sort: "priority", showResolved: false })}
            >
              Reviewer signals
            </button>
          )}
          {project.permissions.canWrite && (
            <button className="primary" onClick={() => setCreating(!creating)}>
              {creating ? "Close form" : "New feedback"}
            </button>
          )}
        </div>
      </div>
      {creating && (
        <ThreadComposer
          project={project}
          taxonomy={taxonomy}
          onCreated={(t) => {
            location.href = `/threads/${t.id}`;
          }}
        />
      )}
      <ProjectAssignments key={project.id} project={project} />
      <ErrorNotice error={taxonomyError} />
      <ErrorNotice error={membersError} />
      <ThreadListFilters
        project={project}
        actor={actor}
        filters={filters}
        draft={draft}
        taxonomy={taxonomy}
        members={members}
        data={data}
        filtersOpen={filtersOpen}
        activeFilterCount={activeFilterCount}
        setFiltersOpen={setFiltersOpen}
        setDraft={setDraft}
        updateFilter={updateFilter}
        apply={apply}
      />
      {actor.kind === "human" && project.permissions.canMaintain && (
        <>
          <ThreadDeletionCleanup projectId={project.id} version={version} />
          {!!data?.items.length && (
            <div
              className="thread-bulk-actions"
              role="group"
              aria-label="Select feedback for deletion"
            >
              <label className="thread-select-all">
                <input
                  type="checkbox"
                  checked={data.items.every((item) => selected.has(item.id))}
                  onChange={(event) =>
                    setSelected(
                      event.target.checked
                        ? new Set(data.items.map((item) => item.id))
                        : new Set(),
                    )
                  }
                />
                Select this page
              </label>
              <span>
                {data.items.filter((item) => selected.has(item.id)).length} selected
              </span>
              <DeleteThreadsButton
                projectId={project.id}
                threads={data.items.filter((item) => selected.has(item.id))}
                onDeleted={() => {
                  setSelected(new Set());
                  setVersion((value) => value + 1);
                }}
              />
            </div>
          )}
        </>
      )}
      <ErrorNotice error={error} />
      {statusRecovery?.query === query && statusRecovery.projectId === project.id && (
        <>
          <Notice>
            Status saved: {labels[statusRecovery.updated.work.state]}. This feedback is
            outside the current filters.{" "}
            <a
              href={`/threads/${statusRecovery.updated.id}${filterQuery(filters, offset)}`}
            >
              Open feedback
            </a>{" "}
            <button
              type="button"
              disabled={recoveryAction.busy || !canUndoStatus}
              onClick={() =>
                void recoveryAction.run(async () => {
                  const updated = await api<Thread>("threads.status", {
                    threadId: statusRecovery.updated.id,
                    revision: statusRecovery.updated.revision,
                    state: statusRecovery.previous.work.state,
                    ...(statusRecovery.previous.work.note
                      ? { note: statusRecovery.previous.work.note }
                      : {}),
                    ...(statusRecovery.previous.work.duplicateOf
                      ? { duplicateOf: statusRecovery.previous.work.duplicateOf }
                      : {}),
                  });
                  handleStatusSaved(updated);
                  setStatusRecovery(undefined);
                })
              }
            >
              Undo status change
              {!canUndoStatus && " (permission required)"}
            </button>
          </Notice>
          <ErrorNotice error={recoveryAction.error} />
        </>
      )}
      {error && <button onClick={() => setVersion((v) => v + 1)}>Retry loading</button>}
      {!data && !error ? (
        <Loading />
      ) : data?.items.length ? (
        <>
          <div className="thread-list">
            {data.items.map((t) => (
              <ThreadListRow
                key={t.id}
                thread={t}
                actor={actor}
                project={project}
                taxonomy={taxonomy}
                filters={filters}
                draft={draft}
                offset={offset}
                selected={selected.has(t.id)}
                onSelectionChange={handleSelectionChange}
                onPrioritySaved={handlePrioritySaved}
                onStatusSaved={(updated) => handleStatusSaved(updated, t)}
                apply={apply}
              />
            ))}
          </div>
          <div className="pagination">
            <button
              disabled={offset === 0}
              onClick={() => apply(filters, Math.max(0, offset - 30))}
            >
              Previous
            </button>
            <span>
              {offset + 1}–{offset + data.items.length} of {data.total}
            </span>
            <button
              disabled={data.nextOffset === null}
              onClick={() => apply(filters, data.nextOffset!)}
            >
              Next
            </button>
          </div>
        </>
      ) : (
        data && (
          <Empty title="No feedback in this view">
            {search ||
            url ||
            domain ||
            hostname ||
            deviceClass ||
            showResolved ||
            filters.workState ||
            filters.assignedTo ||
            category ||
            tag
              ? "Change the filters to find other feedback."
              : "Capture a page with the Chrome extension, or create feedback here with its page URL and viewport."}
          </Empty>
        )
      )}
    </>
  );
}
