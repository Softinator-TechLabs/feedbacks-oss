import type { Dispatch, SetStateAction } from "react";
import { SavedReviewViews } from "./saved-views.js";
import { Field } from "../ui.js";
import { readFilters } from "../review-filters.js";
import { builtInCategories, type ProjectTaxonomy } from "../../shared/taxonomy.js";
import type { ReviewFilters } from "../../shared/contracts.js";
import type { Assignee } from "../assignments/model.js";
import type { Actor, Project } from "../api.js";

type Props = {
  project: Project;
  actor: Actor;
  filters: ReviewFilters;
  draft: ReviewFilters;
  taxonomy?: ProjectTaxonomy;
  members?: { items: Assignee[] };
  data?: { websiteFilters: { domains: string[]; hostnames: string[] } };
  filtersOpen: boolean;
  activeFilterCount: number;
  setFiltersOpen: Dispatch<SetStateAction<boolean>>;
  setDraft: Dispatch<SetStateAction<ReviewFilters>>;
  updateFilter: (next: ReviewFilters, debounceMs?: number, editingUrl?: boolean) => void;
  apply: (next: ReviewFilters) => void;
};

export function ThreadListFilters({
  project,
  actor,
  filters,
  draft,
  taxonomy,
  members,
  data,
  filtersOpen,
  activeFilterCount,
  setFiltersOpen,
  setDraft,
  updateFilter,
  apply,
}: Props) {
  const { url, domain, hostname, deviceClass } = filters;
  return (
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
  );
}
