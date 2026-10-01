import { WorkPlanSummary } from "./work-plan.js";
import { ThreadQuickPriority, ThreadQuickStatus } from "./row-controls.js";
import { ThreadListPointProgress } from "./list-point-progress.js";
import { HumanTime } from "../human-time.js";
import { ExternalLink } from "../ui.js";
import { filterQuery } from "../review-filters.js";
import {
  builtInCategories,
  categoryName,
  colorForTag,
  type ProjectTaxonomy,
} from "../../shared/taxonomy.js";
import type { ReviewFilters } from "../../shared/contracts.js";
import { labels, type Actor, type Project, type Thread } from "../api.js";
import { threadEvidenceLabels } from "./evidence-types.js";

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

type Props = {
  thread: Thread;
  actor: Actor;
  project: Project;
  taxonomy?: ProjectTaxonomy;
  filters: ReviewFilters;
  draft: ReviewFilters;
  offset: number;
  selected: boolean;
  onSelectionChange: (id: string, checked: boolean) => void;
  onPrioritySaved: (updated: Thread) => void;
  onStatusSaved: (updated: Thread) => void;
  apply: (next: ReviewFilters) => void;
};

export function ThreadListRow({
  thread: t,
  actor,
  project,
  taxonomy,
  filters,
  draft,
  offset,
  selected,
  onSelectionChange,
  onPrioritySaved,
  onStatusSaved,
  apply,
}: Props) {
  const { category, tag } = filters;
  const textEdit = t.context.annotations?.find(
    (point) => point.textEdit && t.annotationStates?.[point.id]?.state !== "removed",
  )?.textEdit;
  const snippet = (text: string) => {
    const compact = text.replace(/\s+/g, " ").trim();
    return compact.length > 160 ? `${compact.slice(0, 160)}…` : compact;
  };
  const image =
    t.assets?.find(
      (asset) => asset.contentType === "image/webp" && asset.rendition === "thumbnail",
    ) ?? t.assets?.find((asset) => asset.contentType === "image/webp");
  return (
    <div className="thread-row">
      <div className="thread-row-leading">
        {actor.kind === "human" && project.permissions.canMaintain && (
          <label className="thread-select">
            <input
              type="checkbox"
              aria-label={`Select feedback: ${t.body.slice(0, 80)}`}
              checked={selected}
              onChange={(event) => onSelectionChange(t.id, event.target.checked)}
            />
          </label>
        )}
        {project.permissions.canMaintain && (
          <ThreadQuickPriority thread={t} onSaved={onPrioritySaved} />
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
            <p className="thread-evidence-types" aria-label="Feedback type">
              {threadEvidenceLabels(t).join(" · ")}
            </p>
            {textEdit && (
              <p className="thread-text-edit-preview" aria-label="Suggested text edit">
                <span>
                  <strong>Original:</strong> {snippet(textEdit.original)}
                </span>
                <span>
                  <strong>Suggested:</strong>{" "}
                  {textEdit.replacement
                    ? snippet(textEdit.replacement)
                    : "Remove selected text"}
                </span>
              </p>
            )}
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
            <span>
              {t.view?.uniqueLikes ?? 0}{" "}
              {t.view?.uniqueLikes === 1 ? "view like" : "view likes"} ·{" "}
              {t.replies?.length ?? 0} {t.replies?.length === 1 ? "reply" : "replies"}
            </span>
            <HumanTime at={t.updatedAt} />
          </div>
        </a>
        <ThreadListPointProgress
          thread={t}
          href={`/threads/${t.id}${filterQuery(filters, offset)}`}
        />
        <div className="thread-taxonomy" aria-label="Filter by category or tag">
          <button
            type="button"
            className="category-badge thread-taxonomy-filter"
            aria-label={`Filter by ${categoryName(taxonomy?.categories ?? builtInCategories, t.category)} category`}
            aria-pressed={category === t.category}
            onClick={() =>
              apply({
                ...draft,
                category: draft.category === t.category ? undefined : t.category,
              })
            }
          >
            {categoryName(taxonomy?.categories ?? builtInCategories, t.category)}
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
          onSaved={onStatusSaved}
        />
        {t.response.state === "unanswered" ? (
          !!t.replies?.length && <span className="muted">Needs team response</span>
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
}
