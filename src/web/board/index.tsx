import { useEffect, useRef, useState, type DragEvent } from "react";
import type { BoardColumn } from "../../shared/board.js";
import type { ReviewFilters } from "../../shared/contracts.js";
import type { ProjectTaxonomy } from "../../shared/taxonomy.js";
import { api, type Actor, type Project } from "../api.js";
import { writableAssignees, type Assignee } from "../assignments/model.js";
import { navigate, usePageLocation } from "../navigation.js";
import { filterQuery, readFilters } from "../review-filters.js";
import { ThreadListFilters } from "../threads/list-filters.js";
import { clearListSnapshots } from "../threads/list-cache.js";
import { calendarDate, localTimeZone } from "../work-plan-model.js";
import {
  ActionState,
  ErrorNotice,
  Field,
  Loading,
  Notice,
  useAction,
  useLoad,
} from "../ui.js";
import { BoardCard } from "./card.js";
import { BoardConfigurationEditor } from "./configuration.js";
import type { BoardAction, BoardItem, BoardPage, ProjectBoardData } from "./model.js";
import "./board.css";

function readBoardFilters(query: string) {
  const filters = readFilters(query);
  if (!new URLSearchParams(query).has("showResolved") && !filters.workState)
    filters.showResolved = true;
  if (filters.sort === "workPlan" && !filters.planningDate)
    filters.planningDate = calendarDate(new Date(), localTimeZone());
  return filters;
}

export function BoardLane({
  column,
  board,
  project,
  filters,
  selected,
  busy,
  onSelect,
  onDragStart,
  onDragEnd,
  onDrop,
}: {
  column: BoardColumn;
  board: ProjectBoardData;
  project: Project;
  filters: ReviewFilters;
  selected: Map<string, BoardItem>;
  busy: boolean;
  onSelect: (item: BoardItem, checked: boolean) => void;
  onDragStart: (item: BoardItem, event: DragEvent) => void;
  onDragEnd: () => void;
  onDrop: (column: BoardColumn) => void;
}) {
  const [offset, setOffset] = useState(0);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [over, setOver] = useState(false);
  const load = useLoad<BoardPage>(
    () =>
      api("board.column", {
        projectId: project.id,
        boardRevision: board.revision,
        columnId: column.id,
        filters,
        limit: 15,
        offset,
      }),
    [offset, reloadVersion],
  );
  const allowed =
    project.permissions.canWrite &&
    (project.permissions.canResolve ||
      !["resolved", "declined"].includes(column.entryState));
  return (
    <section
      className={`board-lane${over ? " is-drop-target" : ""}`}
      aria-labelledby={`board-column-${column.id}`}
      onDragOver={(event) => {
        if (
          allowed &&
          !busy &&
          event.dataTransfer.types.includes("application/x-feedbacks-board")
        ) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          setOver(true);
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        if (allowed && !busy) onDrop(column);
      }}
    >
      <div className="board-lane-heading">
        <h2 id={`board-column-${column.id}`}>{column.name}</h2>
        <span
          aria-label={
            load.data ? `${load.data.total} matching feedback` : "Loading count"
          }
        >
          {load.data?.total ?? "…"}
        </span>
      </div>
      {board.configuration.intakeColumnId === column.id && (
        <p className="board-intake-hint">New feedback arrives here</p>
      )}
      <ErrorNotice error={load.error} />
      {!load.data && load.refreshing && <Loading />}
      {load.error && (
        <button type="button" onClick={() => setReloadVersion((value) => value + 1)}>
          Retry loading column
        </button>
      )}
      {load.data && !load.data.items.length && (
        <p className="board-lane-empty">No matching feedback in this column.</p>
      )}
      <div className="board-cards" aria-busy={load.refreshing}>
        {load.data?.items.map((item) => (
          <BoardCard
            key={item.thread.id}
            item={item}
            project={project}
            filters={filters}
            selected={selected.has(item.thread.id)}
            busy={busy || load.refreshing || !!load.error}
            onSelect={onSelect}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          />
        ))}
      </div>
      {load.data && (offset > 0 || load.data.nextOffset !== null) && (
        <nav className="board-column-pages" aria-label={`${column.name} pages`}>
          <button
            type="button"
            disabled={load.refreshing || offset === 0}
            onClick={() => setOffset(Math.max(0, offset - 15))}
          >
            Previous
          </button>
          <span>
            {offset + (load.data.items.length ? 1 : 0)}–{offset + load.data.items.length}{" "}
            of {load.data.total}
          </span>
          <button
            type="button"
            disabled={load.refreshing || load.data.nextOffset === null}
            onClick={() => setOffset(load.data!.nextOffset!)}
          >
            Next
          </button>
        </nav>
      )}
    </section>
  );
}

export function ProjectBoard({ project, actor }: { project: Project; actor: Actor }) {
  const pageLocation = usePageLocation();
  const query = pageLocation.split("?")[1] ?? "";
  const filters = readBoardFilters(query);
  const filterKey = JSON.stringify(filters);
  const [draft, setDraft] = useState(filters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selected, setSelected] = useState<Map<string, BoardItem>>(new Map());
  const [version, setVersion] = useState(0);
  const [moveColumn, setMoveColumn] = useState("");
  const [assignUser, setAssignUser] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef(false);
  const dragged = useRef<BoardItem[]>([]);
  const retry = useRef<{ signature: string; key: string } | undefined>(undefined);
  const action = useAction();
  const board = useLoad<ProjectBoardData>(
    () => api("board.get", { projectId: project.id }),
    [project.id],
  );
  const members = useLoad<{ items: Assignee[] }>(
    () => api("members.list", { projectId: project.id }),
    [project.id],
  );
  const taxonomy = useLoad<ProjectTaxonomy>(
    () => api("projects.taxonomy.get", { projectId: project.id }),
    [project.id],
  );
  const websites = useLoad<{
    websiteFilters: { domains: string[]; hostnames: string[] };
  }>(
    () =>
      api("threads.list", {
        projectId: project.id,
        limit: 1,
        archived: filters.archived,
      }),
    [project.id, filters.archived],
  );
  useEffect(() => {
    setDraft(readBoardFilters(query));
    setSelected(new Map());
  }, [filterKey]);
  useEffect(() => () => clearTimeout(timer.current), []);
  function apply(next: ReviewFilters) {
    const params = new URLSearchParams(filterQuery(next).slice(1));
    if (!next.showResolved && !next.workState) params.set("showResolved", "false");
    navigate(`/projects/${project.id}/board${params.size ? `?${params}` : ""}`);
  }
  function updateFilter(next: ReviewFilters, debounceMs = 0, editingUrl = false) {
    setDraft(next);
    clearTimeout(timer.current);
    if (editingUrl && next.url && !URL.canParse(next.url)) return;
    if (debounceMs) timer.current = setTimeout(() => apply(next), debounceMs);
    else apply(next);
  }
  function select(item: BoardItem, checked: boolean) {
    setSelected((current) => {
      const next = new Map(current);
      if (checked) {
        if (next.size >= 50) {
          action.setError("Select up to 50 feedback items for one change.");
          return current;
        }
        next.set(item.thread.id, item);
      } else next.delete(item.thread.id);
      return next;
    });
  }
  async function change(changeAction: BoardAction, items = [...selected.values()]) {
    if (!board.data || pending.current || !items.length) return;
    pending.current = true;
    const input = {
      projectId: project.id,
      boardRevision: board.data.revision,
      threads: items
        .map((item) => ({
          threadId: item.thread.id,
          revision: item.thread.revision,
          assignmentVersion: item.assignmentVersion,
        }))
        .sort((left, right) => left.threadId.localeCompare(right.threadId)),
      action: changeAction,
    };
    const signature = JSON.stringify(input);
    if (retry.current?.signature !== signature)
      retry.current = { signature, key: crypto.randomUUID() };
    try {
      await action.run(
        async () => {
          const receipt = await api<{ affected: number }>("board.batch", {
            ...input,
            idempotencyKey: retry.current!.key,
          });
          clearListSnapshots();
          setSelected(new Map());
          setVersion((value) => value + 1);
          retry.current = undefined;
          if (receipt.affected !== items.length)
            throw new Error(
              "The server returned an unexpected change count. Reload the board to check the result.",
            );
        },
        `${items.length} ${items.length === 1 ? "feedback item" : "feedback items"} ${changeAction.type === "move" ? "moved" : changeAction.type === "assign" ? (changeAction.userId ? "assigned" : "unassigned") : changeAction.archived ? "archived" : "restored"}.`,
      );
    } finally {
      pending.current = false;
    }
  }
  async function reload() {
    await action.run(async () => {
      board.setData(await api("board.get", { projectId: project.id }));
      setSelected(new Map());
      setVersion((value) => value + 1);
      retry.current = undefined;
    }, "Board reloaded. Review your selection before making another change.");
  }
  const columns = board.data?.configuration.columns ?? [];
  const activeFilterCount = [
    filters.search,
    filters.category,
    filters.tag,
    filters.assignedTo,
    filters.authorId,
    filters.workState,
    filters.url,
    filters.domain,
    filters.hostname,
    filters.deviceClass,
  ].filter(Boolean).length;
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Board</h1>
          <p>Track feedback through the project workflow.</p>
        </div>
        <div className="actions">
          <a className="button" href={`/projects/${project.id}${filterQuery(filters)}`}>
            List view
          </a>
          <button type="button" disabled={action.busy} onClick={() => void reload()}>
            Reload board
          </button>
        </div>
      </div>
      <ThreadListFilters
        project={project}
        actor={actor}
        filters={filters}
        draft={draft}
        taxonomy={taxonomy.data}
        members={members.data}
        data={websites.data}
        filtersOpen={filtersOpen}
        activeFilterCount={activeFilterCount}
        setFiltersOpen={setFiltersOpen}
        setDraft={setDraft}
        updateFilter={updateFilter}
        apply={apply}
      />
      <ErrorNotice error={board.error} />
      {!board.data && board.refreshing && <Loading />}
      <ActionState action={action} />
      {action.errorCode === "CONFLICT" && (
        <Notice>
          Reload the board to review the current columns, feedback and assignments. Your
          selected change has not been applied.
        </Notice>
      )}
      {project.permissions.canWrite && (
        <section
          className="board-batch"
          aria-label="Selected feedback actions"
          aria-busy={action.busy}
        >
          <div className="board-selection">
            <strong>{selected.size} selected</strong>
            {selected.size > 0 && (
              <button
                type="button"
                disabled={action.busy || !selected.size}
                onClick={() => setSelected(new Map())}
              >
                Clear selection
              </button>
            )}
          </div>
          <p className="board-keyboard-hint">
            Select feedback, then choose an action. You can also drag cards between
            columns.
          </p>
          {selected.size > 0 && (
            <div className="board-batch-actions">
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (moveColumn) void change({ type: "move", columnId: moveColumn });
                }}
              >
                <Field label="Move to column">
                  <select
                    value={moveColumn}
                    disabled={action.busy}
                    onChange={(event) => setMoveColumn(event.target.value)}
                  >
                    <option value="">Choose column</option>
                    {columns.map((column) => (
                      <option
                        key={column.id}
                        value={column.id}
                        disabled={
                          !project.permissions.canResolve &&
                          ["resolved", "declined"].includes(column.entryState)
                        }
                      >
                        {column.name}
                        {!project.permissions.canResolve &&
                        ["resolved", "declined"].includes(column.entryState)
                          ? " (resolution permission required)"
                          : ""}
                      </option>
                    ))}
                  </select>
                </Field>
                <button
                  type="submit"
                  disabled={action.busy || !selected.size || !moveColumn}
                >
                  Move selected
                </button>
              </form>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (assignUser)
                    void change({
                      type: "assign",
                      userId: assignUser === "unassigned" ? null : assignUser,
                    });
                }}
              >
                <Field label="Assign to">
                  <select
                    value={assignUser}
                    disabled={action.busy}
                    onChange={(event) => setAssignUser(event.target.value)}
                  >
                    <option value="">Choose member</option>
                    <option value="unassigned">Unassigned</option>
                    {writableAssignees(members.data?.items ?? []).map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <button
                  type="submit"
                  disabled={action.busy || !selected.size || !assignUser}
                >
                  Assign selected
                </button>
              </form>
              {project.permissions.canMaintain && (
                <button
                  type="button"
                  disabled={action.busy || !selected.size}
                  onClick={() =>
                    void change({ type: "archive", archived: !filters.archived })
                  }
                >
                  {filters.archived ? "Restore selected" : "Archive selected"}
                </button>
              )}
            </div>
          )}
          <label className="board-archive-toggle">
            <input
              type="checkbox"
              checked={filters.archived === true}
              disabled={action.busy}
              onChange={(event) =>
                apply({ ...filters, archived: event.target.checked || undefined })
              }
            />
            Show archived feedback
          </label>
        </section>
      )}
      {board.data && (
        <div className="project-board" aria-label="Project workflow columns">
          {columns.map((column) => (
            <BoardLane
              key={`${column.id}:${board.data!.revision}:${filterKey}:${version}`}
              column={column}
              board={board.data!}
              project={project}
              filters={filters}
              selected={selected}
              busy={action.busy || !!board.error}
              onSelect={select}
              onDragStart={(item, event) => {
                dragged.current = selected.has(item.thread.id)
                  ? [...selected.values()]
                  : [item];
                event.dataTransfer.setData("application/x-feedbacks-board", "selected");
                event.dataTransfer.effectAllowed = "move";
              }}
              onDragEnd={() => {
                dragged.current = [];
              }}
              onDrop={(target) => {
                const items = dragged.current;
                dragged.current = [];
                if (
                  items.length &&
                  !items.every((item) =>
                    target.states.includes(item.thread.work.state as any),
                  )
                )
                  void change({ type: "move", columnId: target.id }, items);
              }}
            />
          ))}
        </div>
      )}
      {board.data && project.permissions.canMaintain && (
        <BoardConfigurationEditor
          key={board.data.revision}
          board={board.data}
          onSaved={(saved) => {
            board.setData(saved);
            setSelected(new Map());
            setVersion((value) => value + 1);
          }}
        />
      )}
    </>
  );
}
