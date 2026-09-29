import { DeleteThreadsButton, ThreadDeletionCleanup } from "./deletion.js";
import { useEffect, useRef, useState } from "react";
import { WorkPlanSummary } from "./work-plan.js";
import { calendarDate, localTimeZone } from "../work-plan-model.js";
import { ProjectAssignments } from "../assignments/project-assignments.js";
import type { Assignee } from "../assignments/model.js";
import { PointProgressRing } from "../point-progress-ring.js";
import { usePageLocation, navigate } from "../navigation.js";
import { readFilters, readOffset, filterQuery } from "../review-filters.js";
import { SavedReviewViews } from "../review-tools.js";
import { api, labels, type Actor, type Project, type Thread } from "../api.js";
import {
  builtInCategories,
  categoryName,
  colorForTag,
  type ProjectTaxonomy,
} from "../../shared/taxonomy.js";
import type { ReviewFilters } from "../../shared/contracts.js";
import { HumanTime } from "../human-time.js";
import { Empty, ErrorNotice, ExternalLink, Field, Loading, useLoad } from "../ui.js";
import { ThreadComposer } from "./composer.js";
import { ThreadQuickPriority, ThreadQuickStatus } from "./row-controls.js";
export function threadAttachmentLabels(thread: Pick<Thread, "assets">) {
  const counts = { screenshots: 0, videos: 0, files: 0 };
  for (const asset of thread.assets ?? []) {
    if (asset.rendition === "thumbnail") continue;
    if (asset.contentType?.startsWith("image/")) counts.screenshots++;
    else if (asset.contentType?.startsWith("video/")) counts.videos++;
    else counts.files++;
  }
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => `${count} ${count === 1 ? kind.slice(0, -1) : kind}`);
}

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
      <section
        className={`thread-filter-panel${filtersOpen ? " is-expanded" : ""}`}
        aria-label="Feedback filters and views"
      >
        <button
          className="thread-filter-mobile-toggle"
          type="button"
          aria-expanded={filtersOpen}
          aria-controls="feedback-filter-form"
          onClick={() => setFiltersOpen((open) => !open)}
        >
          <span>Search &amp; filters</span>
          {activeFilterCount > 0 && (
            <span className="thread-filter-active-count">{activeFilterCount} active</span>
          )}
          <span className="thread-filter-chevron" aria-hidden="true" />
        </button>
        <form
          id="feedback-filter-form"
          className="filters thread-filters"
          onSubmit={(e) => {
            e.preventDefault();
            updateFilter(draft);
          }}
        >
          <Field label="Search feedback">
            <input
              name="search"
              type="search"
              placeholder="Search discussion"
              value={draft.search ?? ""}
              onChange={(event) =>
                updateFilter({ ...draft, search: event.currentTarget.value }, 350)
              }
              maxLength={200}
            />
          </Field>
          <Field label="Category">
            <select
              name="category"
              value={draft.category ?? ""}
              onChange={(event) =>
                updateFilter({
                  ...draft,
                  category: event.currentTarget.value || undefined,
                })
              }
            >
              <option value="">All categories</option>
              {(taxonomy?.categories ?? builtInCategories).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Tag">
            <select
              name="tag"
              value={draft.tag ?? ""}
              onChange={(event) =>
                updateFilter({ ...draft, tag: event.currentTarget.value || undefined })
              }
            >
              <option value="">All tags</option>
              {[
                ...new Set([
                  ...(draft.tag ? [draft.tag] : []),
                  ...(taxonomy?.tags ?? []).map((item) => item.name),
                ]),
              ].map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Assigned to">
            <select
              name="assignedTo"
              value={draft.assignedTo ?? ""}
              onChange={(event) =>
                updateFilter({
                  ...draft,
                  assignedTo: event.currentTarget.value || undefined,
                })
              }
            >
              <option value="">Anyone</option>
              <option value={actor.userId}>Me</option>
              {(members?.items ?? [])
                .filter((member) => member.id !== actor.userId)
                .map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                    {member.active ? "" : " (inactive)"}
                  </option>
                ))}
              {draft.assignedTo &&
                draft.assignedTo !== actor.userId &&
                !members?.items.some((member) => member.id === draft.assignedTo) && (
                  <option value={draft.assignedTo}>Unavailable member</option>
                )}
            </select>
          </Field>
          <Field label="Work status">
            <select
              name="workState"
              value={draft.workState ?? (draft.showResolved ? "all" : "active")}
              onChange={(event) => {
                const value = event.currentTarget.value;
                updateFilter({
                  ...draft,
                  workState:
                    value === "active" || value === "all"
                      ? undefined
                      : (value as ReviewFilters["workState"]),
                  showResolved: value === "all",
                });
              }}
            >
              <option value="active">Active</option>
              <option value="open">Open</option>
              <option value="in_progress">In progress</option>
              <option value="ready_for_review">Ready for review</option>
              <option value="resolved">Resolved</option>
              <option value="declined">Declined</option>
              <option value="all">All statuses</option>
            </select>
          </Field>
          <Field label="Sort">
            <select
              name="sort"
              value={draft.sort}
              onChange={(event) =>
                updateFilter({
                  ...draft,
                  sort: event.currentTarget.value as ReviewFilters["sort"],
                })
              }
            >
              <option value="activity">Latest activity</option>
              <option value="newest">Newest</option>
              <option value="likes">Most liked views</option>
              <option value="workPlan">Work priority & timing</option>
              {actor.owner && <option value="priority">Reviewer signals</option>}
            </select>
          </Field>
          <button
            className="thread-filter-clear"
            type="button"
            onClick={() => {
              updateFilter(readFilters(""));
            }}
          >
            Clear
          </button>
          <details
            className="advanced-filters"
            open={!!(url || domain || hostname || deviceClass) || undefined}
          >
            <summary>
              More filters
              {url || domain || hostname || deviceClass ? " · active" : ""}
            </summary>
            <div className="advanced-filter-fields">
              <Field
                label="Page URL"
                hint={
                  draft.url && !URL.canParse(draft.url)
                    ? "Enter a complete URL to filter."
                    : undefined
                }
              >
                <input
                  name="url"
                  type="url"
                  placeholder="All pages"
                  value={draft.url ?? ""}
                  onChange={(event) =>
                    updateFilter({ ...draft, url: event.currentTarget.value }, 400, true)
                  }
                />
              </Field>
              <Field label="Domain">
                <select
                  name="domain"
                  value={draft.domain ?? ""}
                  onChange={(event) =>
                    updateFilter({
                      ...draft,
                      domain: event.currentTarget.value || undefined,
                    })
                  }
                >
                  <option value="">All domains</option>
                  {[
                    ...new Set([
                      ...(domain ? [domain] : []),
                      ...(data?.websiteFilters.domains ?? []),
                    ]),
                  ].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </Field>
              <Field label="Hostname">
                <select
                  name="hostname"
                  value={draft.hostname ?? ""}
                  onChange={(event) =>
                    updateFilter({
                      ...draft,
                      hostname: event.currentTarget.value || undefined,
                    })
                  }
                >
                  <option value="">All hostnames</option>
                  {[
                    ...new Set([
                      ...(hostname ? [hostname] : []),
                      ...(data?.websiteFilters.hostnames ?? []),
                    ]),
                  ].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </Field>
              <Field label="Device">
                <select
                  name="deviceClass"
                  value={draft.deviceClass ?? ""}
                  onChange={(event) =>
                    updateFilter({
                      ...draft,
                      deviceClass:
                        (event.currentTarget.value as ReviewFilters["deviceClass"]) ||
                        undefined,
                    })
                  }
                >
                  <option value="">All devices</option>
                  {["mobile", "tablet", "desktop"].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </Field>
            </div>
          </details>
        </form>
        <SavedReviewViews
          projectId={project.id}
          filters={draft}
          onApply={(next) => {
            setFiltersOpen(false);
            setDraft(next);
            apply(next);
          }}
        />
      </section>
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
      {error && <button onClick={() => setVersion((v) => v + 1)}>Retry loading</button>}
      {!data && !error ? (
        <Loading />
      ) : data?.items.length ? (
        <>
          <div className="thread-list">
            {data.items.map((t) => {
              const image =
                t.assets?.find(
                  (asset) =>
                    asset.contentType === "image/webp" && asset.rendition === "thumbnail",
                ) ?? t.assets?.find((asset) => asset.contentType === "image/webp");
              return (
                <div className="thread-row" key={t.id}>
                  <div className="thread-row-leading">
                    {actor.kind === "human" && project.permissions.canMaintain && (
                      <label className="thread-select">
                        <input
                          type="checkbox"
                          aria-label={`Select feedback: ${t.body.slice(0, 80)}`}
                          checked={selected.has(t.id)}
                          onChange={(event) =>
                            setSelected((current) => {
                              const next = new Set(current);
                              if (event.target.checked) next.add(t.id);
                              else next.delete(t.id);
                              return next;
                            })
                          }
                        />
                      </label>
                    )}
                    {project.permissions.canMaintain && (
                      <ThreadQuickPriority
                        thread={t}
                        onSaved={(updated) => {
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
                        }}
                      />
                    )}
                  </div>
                  <div className="thread-row-content">
                    <a
                      className={`thread-row-main${image ? " has-thumbnail" : ""}`}
                      href={`/threads/${t.id}${filterQuery(filters, offset)}`}
                    >
                      {image && (
                        <img
                          className="thread-row-thumbnail"
                          src={`${image.url}?preview=list`}
                          alt=""
                          width="160"
                          height="100"
                          loading="lazy"
                          decoding="async"
                        />
                      )}
                      <div className="thread-summary">
                        <h2>{t.body}</h2>
                        {t.workPlan &&
                          (t.workPlan.priority !== "normal" ||
                            t.workPlan.schedule !== "unscheduled") && (
                            <WorkPlanSummary workPlan={t.workPlan} />
                          )}
                        {t.topPriority && !project.permissions.canMaintain && (
                          <span className="thread-priority-label">Top priority</span>
                        )}
                        <div className="meta">
                          <span>{t.author?.name ?? "Member"}</span>
                          <span>
                            {t.context.deviceClass} · {t.context.viewport.width} ×{" "}
                            {t.context.viewport.height}
                          </span>
                          <span>{t.context.url}</span>
                        </div>
                      </div>
                      <div className="thread-stats">
                        <PointProgressRing thread={t} compact />
                        <span>
                          {t.view?.uniqueLikes ?? 0}{" "}
                          {t.view?.uniqueLikes === 1 ? "view like" : "view likes"} ·{" "}
                          {t.replies?.length ?? 0}{" "}
                          {t.replies?.length === 1 ? "reply" : "replies"}
                        </span>
                        <HumanTime at={t.updatedAt} />
                      </div>
                    </a>
                    <div
                      className="thread-taxonomy"
                      aria-label="Filter by category or tag"
                    >
                      <button
                        type="button"
                        className="category-badge thread-taxonomy-filter"
                        aria-label={`Filter by ${categoryName(taxonomy?.categories ?? builtInCategories, t.category)} category`}
                        aria-pressed={category === t.category}
                        onClick={() =>
                          apply({
                            ...draft,
                            category:
                              draft.category === t.category ? undefined : t.category,
                          })
                        }
                      >
                        {categoryName(
                          taxonomy?.categories ?? builtInCategories,
                          t.category,
                        )}
                      </button>
                      {(t.tags ?? []).map((name) => (
                        <button
                          type="button"
                          className={`tag tag-color-${colorForTag(taxonomy?.tags ?? [], name)} thread-taxonomy-filter`}
                          aria-label={`Filter by ${name} tag`}
                          aria-pressed={tag === name}
                          onClick={() =>
                            apply({
                              ...draft,
                              tag: draft.tag === name ? undefined : name,
                            })
                          }
                          key={name}
                        >
                          {name}
                        </button>
                      ))}
                    </div>
                    <div className="thread-row-evidence">
                      <ExternalLink href={t.context.url}>Open website ↗</ExternalLink>
                      <span>
                        {t.context.annotations?.filter(
                          (point) => t.annotationStates?.[point.id]?.state !== "removed",
                        ).length ?? (t.context.anchor ? 1 : 0)}{" "}
                        annotations
                      </span>
                      {threadAttachmentLabels(t).map((label) => (
                        <span key={label}>{label}</span>
                      ))}
                    </div>
                  </div>
                  <div className="thread-row-actions">
                    <ThreadQuickStatus
                      thread={t}
                      canWrite={project.permissions.canWrite}
                      canResolve={project.permissions.canResolve}
                      onSaved={(updated) => {
                        setLoaded((current) => {
                          if (!current || current.query !== query) return current;
                          const leavesView =
                            !showResolved &&
                            ["resolved", "declined"].includes(updated.work.state);
                          return {
                            ...current,
                            result: {
                              ...current.result,
                              items: leavesView
                                ? current.result.items.filter(
                                    (item) => item.id !== updated.id,
                                  )
                                : current.result.items.map((item) =>
                                    item.id === updated.id ? updated : item,
                                  ),
                              total: current.result.total - (leavesView ? 1 : 0),
                            },
                          };
                        });
                        setVersion((value) => value + 1);
                      }}
                    />
                    {t.response.state === "unanswered" ? (
                      !!t.replies?.length && (
                        <span className="muted">Needs team response</span>
                      )
                    ) : (
                      <span className="muted">
                        {t.response.state === "responded"
                          ? "Team responded"
                          : t.response.state === "needs-follow-up"
                            ? "Follow-up needed"
                            : (labels[t.response.state] ?? t.response.state)}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
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
