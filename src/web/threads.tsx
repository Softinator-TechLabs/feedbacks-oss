import React, { useEffect, useRef, useState } from "react";
import { ThreadStatus } from "./thread-status.js";
import { ThreadReview } from "./thread-review.js";
import { DiscussionLike } from "./discussion-like.js";
import { ContextPanel } from "./thread-context.js";
import { usePageLocation, navigate, useUnsavedChanges } from "./navigation.js";
import {
  readFilters,
  readOffset,
  filterQuery,
  splitTags,
  categories,
} from "./review-filters.js";
import {
  SavedReviewViews,
  ThreadNavigation,
  ThreadOrganization,
  ScreenshotComparison,
  ThreadDiagnostics,
} from "./review-tools.js";
import { MentionInput } from "./mention-input.js";
import {
  mentionIds,
  reconcileMentionRanges,
  type MentionRange,
} from "./mention-ranges.js";
import { Icon } from "./icons.js";
import { GuestLinks } from "./guest-review.js";
import { GithubIssue } from "./github-issue.js";
import { api, uid, date, labels, type Actor, type Project, type Thread } from "./api.js";
import { HumanTime } from "./human-time.js";
import {
  ActionState,
  Empty,
  ErrorNotice,
  ExternalLink,
  Field,
  Loading,
  Notice,
  ConfirmButton,
  useAction,
  useLoad,
} from "./ui.js";
export function ThreadList({ project, actor }: { project: Project; actor: Actor }) {
  const pageLocation = usePageLocation(),
    query = pageLocation.split("?")[1] ?? "";
  const filters = readFilters(query),
    offset = readOffset(query);
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
    [version, setVersion] = useState(0);
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
      }>("threads.list", { projectId: project.id, ...filters, offset }),
    }),
    [project.id, query, version],
    true,
  );
  const data =
    loaded?.query === query && loaded.projectId === project.id
      ? loaded.result
      : undefined;
  const apply = (next = filters, nextOffset = 0) =>
    navigate(`/projects/${project.id}${filterQuery(next, nextOffset)}`);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Feedback</h1>
          <p>
            {data
              ? `${data.total} ${data.total === 1 ? "thread" : "threads"}`
              : "Project discussion"}{" "}
          </p>
        </div>
        <div className="thread-list-quick-actions">
          {actor.owner && (
            <button
              className={sort === "priority" ? "primary" : undefined}
              aria-pressed={sort === "priority"}
              title="Sort active feedback by current reviewer importance and view support"
              onClick={() => apply({ ...filters, sort: "priority", showResolved: false })}
            >
              Top priority
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
          onCreated={(t) => {
            location.href = `/threads/${t.id}`;
          }}
        />
      )}
      <form
        key={`${project.id}:${query}`}
        className="filters thread-filters"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget),
            p = new URLSearchParams();
          for (const [key, value] of f) if (String(value)) p.set(key, String(value));
          apply(readFilters(p.toString()));
        }}
      >
        <Field label="Search feedback">
          <input
            name="search"
            type="search"
            placeholder="Search discussion"
            defaultValue={search}
            maxLength={200}
          />
        </Field>
        <Field label="Status">
          <select name="showResolved" defaultValue={String(showResolved)}>
            <option value="false">Active</option>
            <option value="true">All statuses</option>
          </select>
        </Field>
        <Field label="Sort">
          <select name="sort" defaultValue={sort}>
            <option value="activity">Latest activity</option>
            <option value="newest">Newest</option>
            <option value="likes">Most liked views</option>
            {actor.owner && <option value="priority">Top priority</option>}
          </select>
        </Field>
        <button className="thread-filter-apply">Apply</button>
        <button
          className="thread-filter-clear"
          type="button"
          onClick={() => apply(readFilters(""))}
        >
          Clear
        </button>
        <details
          className="advanced-filters"
          open={
            !!(url || domain || hostname || deviceClass || category || tag) || undefined
          }
        >
          <summary>
            More filters
            {url || domain || hostname || deviceClass || category || tag
              ? " · active"
              : ""}
          </summary>
          <div className="advanced-filter-fields">
            <Field label="Page URL">
              <input name="url" type="url" placeholder="All pages" defaultValue={url} />
            </Field>
            <Field label="Domain">
              <select name="domain" defaultValue={domain ?? ""}>
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
              <select name="hostname" defaultValue={hostname ?? ""}>
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
              <select name="deviceClass" defaultValue={deviceClass ?? ""}>
                <option value="">All devices</option>
                {["mobile", "tablet", "desktop"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </Field>
            <Field label="Category">
              <select name="category" defaultValue={category ?? ""}>
                <option value="">All categories</option>
                {categories.map((v) => (
                  <option key={v} value={v}>
                    {labels[v]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Tag">
              <input name="tag" defaultValue={tag} maxLength={32} placeholder="Any tag" />
            </Field>
          </div>
        </details>
      </form>
      <SavedReviewViews
        projectId={project.id}
        filters={filters}
        onApply={(next) => apply(next)}
      />
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
                      {!!t.tags?.length && (
                        <div className="tag-list">
                          {t.tags.map((tag) => (
                            <span className="tag" key={tag}>
                              {tag}
                            </span>
                          ))}
                        </div>
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
                        {t.replies?.length ?? 0}{" "}
                        {t.replies?.length === 1 ? "reply" : "replies"}
                      </span>
                      <HumanTime at={t.updatedAt} />
                    </div>
                  </a>
                  <div className="thread-row-actions">
                    <ThreadQuickStatus
                      thread={t}
                      canWrite={project.permissions.canWrite}
                      canResolve={project.permissions.canResolve}
                      onSaved={(updated) =>
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
                        })
                      }
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
function ThreadQuickStatus({
  thread,
  canWrite,
  canResolve,
  onSaved,
}: {
  thread: Thread;
  canWrite: boolean;
  canResolve: boolean;
  onSaved: (thread: Thread) => void;
}) {
  const action = useAction();
  if (!canWrite)
    return (
      <span className={`badge ${thread.work.state}`}>{labels[thread.work.state]}</span>
    );
  const states: Array<Thread["work"]["state"]> = [
    "open",
    "in_progress",
    "ready_for_review",
  ];
  if (canResolve) states.push("resolved", "declined");
  else if (["resolved", "declined"].includes(thread.work.state))
    states.push(thread.work.state);
  return (
    <>
      <select
        aria-label={`Status for ${thread.body.slice(0, 80)}`}
        value={thread.work.state}
        disabled={action.busy}
        onChange={(event) => {
          const state = event.target.value as
            | "open"
            | "in_progress"
            | "ready_for_review"
            | "resolved"
            | "declined";
          void action.run(async () => {
            onSaved(
              await api<Thread>("threads.status", {
                threadId: thread.id,
                revision: thread.revision,
                state,
              }),
            );
          });
        }}
      >
        {states.map((state) => (
          <option key={state} value={state}>
            {labels[state]}
          </option>
        ))}
      </select>
      <ActionState action={action} />
    </>
  );
}
export function ThreadComposer({
  project,
  onCreated,
}: {
  project: Project;
  onCreated: (t: Thread) => void;
}) {
  const a = useAction(),
    retry = useRef<{ signature: string; key: string } | undefined>(undefined);
  return (
    <section className="section">
      <h2>New feedback</h2>
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget),
            input = {
              projectId: project.id,
              body: String(f.get("body")),
              context: {
                url: String(f.get("url")),
                viewport: {
                  width: Number(f.get("width")),
                  height: Number(f.get("height")),
                },
              },
              category: String(f.get("category")) as "general",
              tags: splitTags(String(f.get("tags") ?? "")),
            };
          const signature = JSON.stringify(input);
          if (retry.current?.signature !== signature)
            retry.current = { signature, key: uid() };
          void a.run(async () =>
            onCreated(
              await api<Thread>("threads.create", {
                ...input,
                idempotencyKey: retry.current!.key,
              }),
            ),
          );
        }}
      >
        <Field label="Page URL">
          <input
            name="url"
            type="url"
            required
            placeholder={
              project.captureMode === "any"
                ? "https://example.org/page"
                : project.origins[0]
            }
          />
        </Field>
        <Field label="Category (optional)">
          <select name="category">
            {["general", "visualDesign", "productWorkflow", "usabilityAccessibility"].map(
              (c) => (
                <option key={c} value={c}>
                  {labels[c]}
                </option>
              ),
            )}
          </select>
        </Field>
        <Field label="Tags (optional)" hint="Comma separated, up to 12 tags.">
          <input name="tags" maxLength={394} placeholder="checkout, mobile" />
        </Field>
        <Field label="Viewport width (CSS px)">
          <input
            name="width"
            type="number"
            min={100}
            max={20000}
            defaultValue={1440}
            required
          />
        </Field>
        <Field label="Viewport height (CSS px)">
          <input
            name="height"
            type="number"
            min={100}
            max={20000}
            defaultValue={900}
            required
          />
        </Field>
        <Field label="Feedback">
          <textarea name="body" required maxLength={12000} rows={4} />
        </Field>
        <div className="form-end">
          <p className="muted">
            For an exact element pin and a screenshot, capture from the Chrome extension.
          </p>
          <ActionState action={a} />
          <button className="primary" disabled={a.busy}>
            {a.busy ? "Posting…" : "Post feedback"}
          </button>
        </div>
      </form>
    </section>
  );
}
export function ThreadDetail({
  threadId,
  onProject,
}: {
  threadId: string;
  onProject: (p: Project) => void;
}) {
  const [version, setVersion] = useState(0),
    [projectVersion, setProjectVersion] = useState(0),
    [memberVersion, setMemberVersion] = useState(0),
    {
      data: t,
      setData: setThread,
      error,
    } = useLoad(
      () => api<Thread>("threads.get", { threadId }),
      [threadId, version],
      true,
    ),
    { data: project, error: projectError } = useLoad(
      () =>
        t?.id === threadId
          ? api<Project>("projects.get", { projectId: t.projectId })
          : Promise.resolve(undefined),
      [threadId, t?.projectId, projectVersion],
    );
  const projectCallback = useRef(onProject);
  projectCallback.current = onProject;
  useEffect(() => {
    if (project) projectCallback.current(project);
  }, [project]);
  const a = useAction(),
    [panel, setPanel] = useState(
      location.hash === "#recorded-context" ? "details" : "discussion",
    ),
    [reply, setReply] = useState(""),
    [replyIntent, setReplyIntent] = useState<"request" | "response">("request"),
    [mentions, setMentions] = useState<MentionRange[]>([]),
    replyEditVersion = useRef(0),
    replyRetry = useRef<
      | {
          body: string;
          intent: "request" | "response";
          revision: number;
          key: string;
          mentions: string[];
        }
      | undefined
    >(undefined),
    [image, setImage] = useState(""),
    [approvedImage, setApprovedImage] = useState(false),
    uploadRetry = useRef<{ image: string; revision: number; key: string } | undefined>(
      undefined,
    );
  useUnsavedChanges(!!reply.trim() || mentions.length > 0 || !!image || a.busy);
  useEffect(() => {
    const close = () => {
      for (const open of document.querySelectorAll<HTMLDetailsElement>(
        ".thread-header-actions details.thread-header-popover[open]",
      )) {
        open.open = false;
      }
    };
    const outside = (event: PointerEvent) => {
      if (
        !(event.target instanceof Element) ||
        !event.target.closest(".thread-header-actions")
      ) {
        close();
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [threadId]);
  const { data: members, error: memberError } = useLoad(
    () =>
      project
        ? api<{ items: Array<{ id: string; name: string; active: boolean }> }>(
            "members.list",
            { projectId: project.id },
          )
        : Promise.resolve({ items: [] }),
    [project?.id, memberVersion],
  );
  async function mutate(
    op:
      | "threads.status"
      | "threads.linkIssue"
      | "threads.figmaReference"
      | "threads.evidence"
      | "threads.archive",
    input: Record<string, unknown>,
  ) {
    if (!t) return;
    await a.run(
      async () =>
        setThread(
          await api<Thread>(op, {
            threadId,
            revision: t.revision,
            ...input,
          } as never),
        ),
      "Saved.",
    );
  }
  function openDetail(id: string) {
    setPanel("details");
    requestAnimationFrame(() => {
      const section = document.getElementById(id);
      if (!section) return;
      if (section instanceof HTMLDetailsElement) section.open = true;
      section.scrollIntoView({ block: "start" });
      if (section instanceof HTMLDetailsElement)
        section.querySelector("summary")?.focus({ preventScroll: true });
      else section.focus({ preventScroll: true });
    });
  }
  if (!t)
    return (
      <>
        <ErrorNotice error={error} />
        {error ? (
          <button onClick={() => setVersion((v) => v + 1)}>Retry loading thread</button>
        ) : (
          <Loading />
        )}
      </>
    );
  return (
    <>
      <div className="page-heading thread-page-heading">
        <div>
          <h1>
            <a className="back" href={`/projects/${t.projectId}${location.search}`}>
              ← Feedback
            </a>
          </h1>
          <p>
            {t.author?.name} · <HumanTime at={t.createdAt} />
          </p>
        </div>
        <div
          className="thread-header-actions"
          onClickCapture={(event) => {
            const target = event.target as Element;
            const current = target.closest("details.thread-header-popover");
            for (const open of event.currentTarget.querySelectorAll<HTMLDetailsElement>(
              "details.thread-header-popover[open]",
            )) {
              if (open !== current) open.open = false;
            }
          }}
        >
          {project?.permissions.canWrite && (
            <ThreadStatus
              key={`status:${t.id}`}
              thread={t}
              canResolve={project.permissions.canResolve}
              onSaved={setThread}
            />
          )}
          {project?.reviewEnabled && (
            <ThreadReview
              key={`review:${t.id}`}
              thread={t}
              canWrite={!!project?.permissions.canWrite}
              onSaved={setThread}
            />
          )}
          <div className="thread-tools" role="group" aria-label="Feedback actions">
            <ExternalLink href={t.context.url}>
              <span
                className="icon-action"
                data-tooltip={t.context.document ? "Open document" : "Open original page"}
              >
                <Icon name="external" />
                <span className="sr-only">
                  {t.context.document ? "Open document" : "Open original page"}
                </span>
              </span>
            </ExternalLink>
            {project?.permissions.canMaintain && (
              <button
                type="button"
                className="thread-icon-button"
                aria-label="Create a guest discussion link"
                data-tooltip="Create a guest discussion link"
                onClick={() => openDetail("thread-guest-links")}
              >
                <Icon name="share" />
              </button>
            )}
            <button
              type="button"
              className="thread-icon-button"
              aria-label="View or link issues"
              data-tooltip="View or link issues"
              onClick={() => openDetail("thread-issues")}
            >
              <Icon name="issue" />
            </button>
            <details
              className="thread-action-menu thread-header-popover"
              onClick={(event) => {
                if (
                  (event.target as Element).closest(".thread-action-menu-panel button")
                ) {
                  event.currentTarget.open = false;
                }
              }}
            >
              <summary aria-label="More actions" data-tooltip="More actions">
                <Icon name="more" />
              </summary>
              <div className="thread-action-menu-panel">
                <button type="button" onClick={() => openDetail("thread-details")}>
                  Details
                </button>
                {project?.permissions.canWrite && (
                  <>
                    <button type="button" onClick={() => openDetail("thread-organize")}>
                      Organize
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const upload = document.getElementById(
                          "thread-upload",
                        ) as HTMLDetailsElement | null;
                        if (!upload) return;
                        upload.open = true;
                        upload.scrollIntoView({ block: "center" });
                        upload
                          .querySelector<HTMLInputElement>('input[type="file"]')
                          ?.focus({ preventScroll: true });
                      }}
                    >
                      Attach screenshot
                    </button>
                  </>
                )}
                <button type="button" onClick={() => openDetail("thread-history")}>
                  Activity history
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void a.run(
                      () =>
                        navigator.clipboard.writeText(
                          `${location.origin}/threads/${t.id}`,
                        ),
                      "Thread link copied.",
                    )
                  }
                >
                  Copy link
                </button>
              </div>
            </details>
          </div>
        </div>
      </div>
      <ErrorNotice error={error} />
      {projectError && (
        <section>
          <ErrorNotice error={`Project permissions could not load: ${projectError}`} />
          <button type="button" onClick={() => setProjectVersion((v) => v + 1)}>
            Retry project permissions
          </button>
        </section>
      )}
      <ActionState action={a} />
      {a.error.includes("CONFLICT") && (
        <Notice>
          This thread changed. Your draft is intact.{" "}
          <button
            onClick={() => {
              replyRetry.current = undefined;
              uploadRetry.current = undefined;
              setVersion((v) => v + 1);
            }}
          >
            Reload latest before retrying
          </button>
        </Notice>
      )}
      <div className="thread-content">
        <div className={`detail-grid ${panel === "details" ? "showing-details" : ""}`}>
          <div className="evidence-pane">
            <article className="first-comment">
              {t.category !== "general" && (
                <div className="meta">
                  <span>{labels[t.category] ?? t.category}</span>
                </div>
              )}
              <p className="message">{t.body}</p>
              {!!t.tags?.length && (
                <div className="tag-list">
                  {t.tags.map((tag) => (
                    <span className="tag" key={tag}>
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </article>
            {t.assets?.length > 0 && (
              <section className="attachments">
                <h2 className="sr-only">Attachments</h2>
                {t.assets.map((asset, index) => (
                  <figure key={asset.id}>
                    {asset.contentType === "video/webm" ? (
                      <video
                        controls
                        preload="metadata"
                        src={asset.url}
                        aria-label="Tab video feedback"
                      />
                    ) : (
                      <a href={asset.url} target="_blank" rel="noopener noreferrer">
                        <img
                          src={asset.url}
                          alt={`${asset.rendition} attached to feedback`}
                          width={asset.width}
                          height={asset.height}
                          loading={index === 0 ? "eager" : "lazy"}
                        />
                      </a>
                    )}
                    <figcaption>
                      {asset.contentType === "video/webm"
                        ? `Tab video · ${Math.ceil((asset.durationMs || 0) / 1000)} seconds`
                        : `${asset.width} × ${asset.height} · Open full image`}
                    </figcaption>
                  </figure>
                ))}
              </section>
            )}
            <div className="feedback-reactions">
              <DiscussionLike
                key={t.id}
                threadId={t.id}
                target="original feedback"
                likes={t.likes}
                canWrite={!!project?.permissions.canWrite}
                onSaved={(likes) =>
                  setThread((current) => current && { ...current, likes })
                }
              />
              {t.archived && <span>Archived</span>}
            </div>
            {t.assets?.filter((asset) => asset.contentType !== "video/webm").length >
              0 && (
              <ScreenshotComparison
                assets={t.assets.filter((asset) => asset.contentType !== "video/webm")}
                threadId={t.id}
                canMaintain={!!project?.permissions.canMaintain}
              />
            )}
            {project?.permissions.canWrite && (
              <details className="section" id="thread-upload">
                <summary>Attach screenshot</summary>
                <p>Choose a screenshot to share with your project.</p>
                <Field label="PNG, JPEG or WebP (up to 10 MiB)">
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      if (file.size > 10 * 1024 * 1024) {
                        a.setError("Choose an image no larger than 10 MiB.");
                        return;
                      }
                      const reader = new FileReader();
                      reader.onload = () => {
                        setImage(String(reader.result));
                        setApprovedImage(false);
                      };
                      reader.readAsDataURL(file);
                    }}
                  />
                </Field>
                {image && (
                  <>
                    <img
                      className="upload-preview"
                      src={image}
                      alt="Screenshot awaiting your approval"
                    />
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={approvedImage}
                        onChange={(e) => setApprovedImage(e.target.checked)}
                      />
                      Share this image with the project.
                    </label>
                    <button
                      disabled={a.busy || !approvedImage}
                      onClick={() => {
                        if (uploadRetry.current?.image !== image)
                          uploadRetry.current = {
                            image,
                            revision: t.revision,
                            key: uid(),
                          };
                        const pending = uploadRetry.current;
                        void a.run(async () => {
                          const result = await api<{ thread: Thread }>("assets.upload", {
                            threadId,
                            revision: pending.revision,
                            imageBase64: pending.image,
                            idempotencyKey: pending.key,
                          });
                          setThread(result.thread);
                          setImage((current) =>
                            current === pending.image ? "" : current,
                          );
                          uploadRetry.current = undefined;
                        }, "Screenshot attached.");
                      }}
                    >
                      Upload screenshot
                    </button>
                  </>
                )}
              </details>
            )}
          </div>
          <div className="thread-side">
            <div className="thread-pane">
              <div id="thread-discussion" hidden={panel !== "discussion"}>
                <section className="replies">
                  <h2 id="thread-discussion-heading" tabIndex={-1}>
                    Discussion <span className="muted">{t.replies?.length ?? 0}</span>
                    {(t.response.state !== "unanswered" || !!t.replies?.length) && (
                      <span className="response-state">
                        {t.response.state === "unanswered"
                          ? "Needs reply"
                          : labels[t.response.state]}
                      </span>
                    )}
                  </h2>
                  {t.replies?.length ? (
                    t.replies.map((r) => (
                      <article className="reply" key={r.id}>
                        <div className="meta">
                          <strong>{r.author.name}</strong>
                          <span>
                            {r.author.kind === "agent" ? "Agent" : "Team member"}
                          </span>
                          <span>
                            {(r.intent ??
                              (r.author.kind === "agent" ? "response" : "request")) ===
                            "request"
                              ? "Requests follow-up"
                              : "Response"}
                          </span>
                          <HumanTime at={r.createdAt} />
                        </div>
                        <p className="message">{r.body}</p>
                        <DiscussionLike
                          threadId={t.id}
                          replyId={r.id}
                          target={`reply by ${r.author.name} from ${date(r.createdAt)}`}
                          likes={r.likes}
                          canWrite={!!project?.permissions.canWrite}
                          onSaved={(likes) =>
                            setThread(
                              (current) =>
                                current && {
                                  ...current,
                                  replies: current.replies.map((item) =>
                                    item.id === r.id ? { ...item, likes } : item,
                                  ),
                                },
                            )
                          }
                        />
                      </article>
                    ))
                  ) : (
                    <p className="muted">No replies yet.</p>
                  )}
                  {project?.permissions.canWrite && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (
                          replyRetry.current?.body !== reply ||
                          replyRetry.current?.intent !== replyIntent ||
                          JSON.stringify(replyRetry.current?.mentions) !==
                            JSON.stringify(mentionIds(mentions))
                        )
                          replyRetry.current = {
                            body: reply,
                            intent: replyIntent,
                            revision: t.revision,
                            key: uid(),
                            mentions: mentionIds(mentions),
                          };
                        const pending = replyRetry.current;
                        const submittedEdit = replyEditVersion.current;
                        void a.run(async () => {
                          setThread(
                            await api<Thread>("threads.reply", {
                              threadId,
                              revision: pending.revision,
                              body: pending.body,
                              intent: pending.intent,
                              idempotencyKey: pending.key,
                              mentions: pending.mentions,
                            }),
                          );
                          if (replyEditVersion.current === submittedEdit) {
                            setReply("");
                            setMentions([]);
                          }
                          replyRetry.current = undefined;
                        }, "Reply posted.");
                      }}
                    >
                      <MentionInput
                        value={reply}
                        members={members?.items ?? []}
                        onChange={(value, edit) => {
                          replyEditVersion.current++;
                          setMentions((ranges) =>
                            reconcileMentionRanges(reply, value, ranges, edit),
                          );
                          setReply(value);
                        }}
                        onMention={(mention) =>
                          setMentions((ranges) => [...ranges, mention])
                        }
                      />
                      {memberError && (
                        <>
                          <ErrorNotice
                            error={`Mentionable members could not load: ${memberError}`}
                          />
                          <button
                            type="button"
                            onClick={() => setMemberVersion((v) => v + 1)}
                          >
                            Retry project members
                          </button>
                        </>
                      )}
                      <div className="reply-actions">
                        <details className="reply-options">
                          <summary>Options</summary>
                          <Field label="This reply">
                            <select
                              value={replyIntent}
                              onChange={(e) => {
                                replyEditVersion.current++;
                                setReplyIntent(e.target.value as "request" | "response");
                              }}
                            >
                              <option value="request">Requests follow-up</option>
                              <option value="response">Answers the request</option>
                            </select>
                          </Field>
                        </details>
                        <button className="primary" disabled={a.busy || !reply.trim()}>
                          {a.busy ? "Saving…" : "Post reply"}
                        </button>
                      </div>
                    </form>
                  )}
                </section>
              </div>
              <aside
                className="context-panel"
                id="thread-details"
                tabIndex={-1}
                hidden={panel !== "details"}
              >
                <button
                  type="button"
                  className="context-back"
                  onClick={() => {
                    setPanel("discussion");
                    requestAnimationFrame(() => {
                      document.getElementById("thread-discussion-heading")?.focus();
                    });
                  }}
                >
                  ← Discussion
                </button>
                <h2>Details</h2>
                {!project?.reviewEnabled && !!t.review.history.length && (
                  <details className="section compact-details">
                    <summary>Past review decisions ({t.review.history.length})</summary>
                    <ol>
                      {t.review.history.map((entry, index) => (
                        <li key={`${entry.round}-${index}`}>
                          Round {entry.round}: {entry.decision.replaceAll("_", " ")} by{" "}
                          {entry.actor.name} · <HumanTime at={entry.at} />
                          {entry.note && <p className="message">{entry.note}</p>}
                        </li>
                      ))}
                    </ol>
                  </details>
                )}
                {project?.permissions.canMaintain && <GuestLinks threadId={t.id} />}
                <ThreadOrganization
                  thread={t}
                  canWrite={!!project?.permissions.canWrite}
                  onSaved={setThread}
                />
                <ContextPanel context={t.context} />
                {t.diagnostics && <ThreadDiagnostics diagnostics={t.diagnostics} />}
                <details className="section compact-details">
                  <summary>View preferences</summary>
                  <p>
                    {t.view?.uniqueLikes ?? 0}{" "}
                    {t.view?.uniqueLikes === 1 ? "like" : "likes"} ·{" "}
                    {t.view?.discussionCount ?? 0}{" "}
                    {t.view?.discussionCount === 1 ? "discussion" : "discussions"}
                  </p>
                  {t.view?.weightedPreference !== undefined && (
                    <details className="preference-details">
                      <summary>Preference details</summary>
                      <p>
                        Weighted preference: {t.view.weightedPreference}. Separate from
                        unique likes.
                      </p>
                    </details>
                  )}
                  {project?.permissions.canWrite && (
                    <button
                      aria-pressed={t.view?.liked}
                      disabled={a.busy}
                      onClick={() =>
                        a.run(async () => {
                          const view = await api("views.like", {
                            projectId: t.projectId,
                            context: t.context as never,
                            liked: !t.view?.liked,
                          });
                          setThread({ ...t, view });
                        })
                      }
                    >
                      {t.view?.liked ? "Unlike this view" : "Like this view"}
                    </button>
                  )}
                </details>
                <details className="section compact-details" id="thread-issues">
                  <summary>Linked issues</summary>
                  {t.externalIssues?.length ? (
                    t.externalIssues.map((issue) => (
                      <p key={issue.url}>
                        <strong>
                          {issue.provider === "jira"
                            ? "Jira"
                            : issue.provider === "linear"
                              ? "Linear"
                              : "GitHub"}
                        </strong>{" "}
                        <ExternalLink href={issue.url}>{issue.url}</ExternalLink>
                        <small>
                          {issue.verification === "github_verified"
                            ? "Verified by GitHub"
                            : "Reported · not remotely verified"}
                          {issue.state ? ` · ${issue.state}` : ""}
                          {issue.linkedBy ? ` · ${issue.linkedBy.name}` : ""}
                        </small>
                      </p>
                    ))
                  ) : (
                    <p className="muted">No Issue registered.</p>
                  )}
                  {project?.permissions.canWrite && (
                    <>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          const f = new FormData(e.currentTarget);
                          void mutate("threads.linkIssue", { url: f.get("url") });
                        }}
                      >
                        <Field label="GitHub, Jira Cloud or Linear Issue URL">
                          <input
                            name="url"
                            type="url"
                            required
                            placeholder="https://linear.app/team/issue/ENG-123"
                          />
                        </Field>
                        <button disabled={a.busy}>Register Issue</button>
                      </form>
                    </>
                  )}
                  {project && (
                    <GithubIssue thread={t} project={project} onSaved={setThread} />
                  )}
                </details>
                <details className="section compact-details" id="thread-figma-reference">
                  <summary>Figma design reference</summary>
                  {t.figmaReference ? (
                    <p>
                      <ExternalLink href={t.figmaReference.url}>
                        Open Figma file
                      </ExternalLink>
                      <small>
                        Linked by {t.figmaReference.linkedBy.name} ·{" "}
                        <HumanTime at={t.figmaReference.linkedAt} />
                      </small>
                    </p>
                  ) : (
                    <p className="muted">No Figma file linked.</p>
                  )}
                  {project?.permissions.canMaintain && (
                    <>
                      <p className="muted">
                        Register a Figma file after agreeing on design work. This saves
                        the file link here; it does not copy feedback or screenshots to
                        Figma. Check access in Figma before sharing the file.
                      </p>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          const f = new FormData(e.currentTarget);
                          void mutate("threads.figmaReference", { url: f.get("url") });
                        }}
                      >
                        <Field label="Figma file URL">
                          <input
                            key={t.figmaReference?.url ?? "empty"}
                            name="url"
                            type="url"
                            defaultValue={t.figmaReference?.url ?? ""}
                            required
                            placeholder="https://www.figma.com/design/..."
                          />
                        </Field>
                        <div className="figma-reference-actions">
                          <button disabled={a.busy}>
                            {t.figmaReference ? "Replace reference" : "Link Figma file"}
                          </button>
                          {t.figmaReference && (
                            <button
                              type="button"
                              disabled={a.busy}
                              onClick={() =>
                                void mutate("threads.figmaReference", { url: null })
                              }
                            >
                              Remove reference
                            </button>
                          )}
                        </div>
                      </form>
                    </>
                  )}
                </details>
                <details className="section compact-details">
                  <summary>Delivery evidence</summary>
                  {t.fixEvidence?.length ? (
                    t.fixEvidence.map((item, n) => (
                      <div key={n}>
                        <ExternalLink href={item.url}>
                          {item.kind.replaceAll("_", " ")}
                        </ExternalLink>
                        <p className="message">{item.note}</p>
                      </div>
                    ))
                  ) : (
                    <p className="muted">No delivery evidence recorded.</p>
                  )}
                  {project?.permissions.canWrite && (
                    <>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          const f = new FormData(e.currentTarget);
                          void mutate("threads.evidence", {
                            url: f.get("url"),
                            note: f.get("note"),
                            kind: f.get("kind"),
                          });
                        }}
                      >
                        <Field label="Evidence type">
                          <select name="kind">
                            {["commit", "pull_request", "variant", "incorporated_in"].map(
                              (k) => (
                                <option key={k} value={k}>
                                  {k.replaceAll("_", " ")}
                                </option>
                              ),
                            )}
                          </select>
                        </Field>
                        <Field label="Evidence URL">
                          <input name="url" type="url" required />
                        </Field>
                        <Field label="What does this demonstrate?">
                          <textarea name="note" required maxLength={12000} />
                        </Field>
                        <button disabled={a.busy}>Add evidence</button>
                      </form>
                    </>
                  )}
                </details>
                <details className="section" id="thread-history">
                  <summary>Activity history</summary>
                  <p>
                    Last activity: {t.lastActor?.name} ({t.lastActor?.kind}) ·{" "}
                    <HumanTime at={t.updatedAt} />
                  </p>
                  {t.work.history?.map((h, n) => (
                    <div key={n}>
                      <strong>{labels[h.state ?? ""] ?? h.state}</strong>
                      <p className="message">{h.note}</p>
                      <small>
                        {h.actor?.name}
                        {h.at && (
                          <>
                            {" "}
                            · <HumanTime at={h.at} />
                          </>
                        )}
                      </small>
                    </div>
                  ))}
                </details>
                {project?.permissions.canMaintain && (
                  <ConfirmButton
                    disabled={a.busy}
                    onConfirm={() =>
                      void mutate("threads.archive", { archived: !t.archived })
                    }
                  >
                    {t.archived ? "Unarchive thread" : "Archive thread"}
                  </ConfirmButton>
                )}
              </aside>
            </div>
          </div>
        </div>
        <ThreadNavigation key={threadId} threadId={threadId} />
      </div>
    </>
  );
}
