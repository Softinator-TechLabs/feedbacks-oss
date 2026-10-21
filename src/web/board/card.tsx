import type { DragEvent } from "react";
import type { BoardItem } from "./model.js";
import type { ReviewFilters } from "../../shared/contracts.js";
import { labels, type Project } from "../api.js";
import { HumanTime } from "../human-time.js";
import { filterQuery } from "../review-filters.js";
import { WorkPlanSummary } from "../threads/work-plan.js";
import { threadEvidenceLabels } from "../threads/evidence-types.js";

export function BoardCard({
  item,
  filters,
  project,
  selected,
  busy,
  onSelect,
  onDragStart,
  onDragEnd,
}: {
  item: BoardItem;
  filters: ReviewFilters;
  project: Project;
  selected: boolean;
  busy: boolean;
  onSelect: (item: BoardItem, checked: boolean) => void;
  onDragStart: (item: BoardItem, event: DragEvent) => void;
  onDragEnd: () => void;
}) {
  const thread = item.thread;
  const image =
    thread.assets?.find((asset) => asset.rendition === "thumbnail") ??
    thread.assets?.find((asset) => asset.contentType === "image/webp");
  return (
    <article
      className={`board-card${selected ? " is-selected" : ""}`}
      data-thread-id={thread.id}
      draggable={project.permissions.canWrite && !busy}
      onDragStart={(event) => onDragStart(item, event)}
      onDragEnd={onDragEnd}
    >
      <div className="board-card-top">
        {project.permissions.canWrite && (
          <label className="board-select">
            <input
              type="checkbox"
              checked={selected}
              disabled={busy}
              aria-label={`Select feedback: ${thread.body.slice(0, 80)}`}
              onChange={(event) => onSelect(item, event.target.checked)}
            />
          </label>
        )}
        <span>{labels[thread.work.state] ?? thread.work.state}</span>
        {thread.topPriority && <strong>Top priority</strong>}
      </div>
      <a
        className="board-card-link"
        href={`/threads/${thread.id}${filterQuery(filters)}`}
      >
        {image && (
          <img
            src={`${image.url}?preview=list`}
            alt=""
            width="160"
            height="100"
            loading="lazy"
            decoding="async"
          />
        )}
        <h3>{thread.body}</h3>
      </a>
      <p className="board-evidence">{threadEvidenceLabels(thread).join(" · ")}</p>
      <WorkPlanSummary workPlan={thread.workPlan} />
      {(thread.tags?.length ?? 0) > 0 && (
        <p className="board-tags">{thread.tags!.join(" · ")}</p>
      )}
      <p className="board-assignees">
        {item.assignments.length
          ? item.assignments
              .map(
                (assignment) =>
                  `${assignment.name}${assignment.annotationIds.length ? " (points)" : ""}`,
              )
              .join(", ")
          : "Unassigned"}
      </p>
      {thread.work.duplicateOf && (
        <a href={`/threads/${thread.work.duplicateOf}`} className="board-duplicate">
          Duplicate of linked feedback
        </a>
      )}
      <div className="board-card-footer">
        <span>
          {thread.replies?.length ?? 0}{" "}
          {thread.replies?.length === 1 ? "reply" : "replies"}
        </span>
        <HumanTime at={thread.updatedAt} />
      </div>
      <p className="board-response">
        {thread.response.state === "responded"
          ? "Team responded"
          : thread.response.state === "needs-follow-up"
            ? "Follow-up needed"
            : "Awaiting team response"}
      </p>
    </article>
  );
}
