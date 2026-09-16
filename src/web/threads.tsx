import React, { useEffect, useRef, useState } from "react";
import { ThreadStatus } from "./thread-status.js";
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
import { api, uid, date, labels, type Project, type Thread } from "./api.js";
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
export function ThreadList({ project }: { project: Project }) {
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
  const { data: loaded, error } = useLoad(
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
        {project.permissions.canWrite && (
          <button className="primary" onClick={() => setCreating(!creating)}>
            {creating ? "Close form" : "New feedback"}
          </button>
        )}
      </div>
      {creating && (
        <ThreadComposer
          project={project}
          onCreated={(t) => {
            location.href = `/threads/${t.id}`;
          }}
        />
      )}
      <SavedReviewViews
        projectId={project.id}
        filters={filters}
        onApply={(next) => apply(next)}
      />
      <form
        key={`${project.id}:${query}`}
        className="filters"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget),
            p = new URLSearchParams();
          for (const [key, value] of f) if (String(value)) p.set(key, String(value));
          apply(readFilters(p.toString()));
        }}
      >
        <Field label="Search">
          <input
            name="search"
            type="search"
            placeholder="Search discussion"
            defaultValue={search}
            maxLength={200}
          />
        </Field>
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
        <Field label="Sort">
          <select name="sort" defaultValue={sort}>
            <option value="activity">Latest activity</option>
            <option value="newest">Newest</option>
            <option value="likes">Most liked views</option>
          </select>
        </Field>
        <label className="check">
          <input
            name="showResolved"
            type="checkbox"
            value="true"
            defaultChecked={showResolved}
          />
          Show resolved &amp; declined
        </label>
        <button>Apply filters</button>
        <button type="button" onClick={() => apply(readFilters(""))}>
          Clear
        </button>
      </form>
      <ErrorNotice error={error} />
      {error && <button onClick={() => setVersion((v) => v + 1)}>Retry loading</button>}
      {!data && !error ? (
        <Loading />
      ) : data?.items.length ? (
        <>
          <div className="thread-list">
            {data.items.map((t) => (
              <a
                className="thread-row"
                key={t.id}
                href={`/threads/${t.id}${filterQuery(filters, offset)}`}
              >
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
                <div className="thread-states">
                  <span className={`badge ${t.work.state}`}>{labels[t.work.state]}</span>
                  <span>{labels[t.response.state]}</span>
                </div>
                <div className="thread-stats">
                  <span>
                    {t.view?.uniqueLikes ?? 0}{" "}
                    {t.view?.uniqueLikes === 1 ? "view like" : "view likes"} ·{" "}
                    {t.replies?.length ?? 0}{" "}
                    {t.replies?.length === 1 ? "reply" : "replies"}
                  </span>
                  <time>{date(t.updatedAt)}</time>
                </div>
              </a>
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
    op: "threads.status" | "threads.linkIssue" | "threads.evidence" | "threads.archive",
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
      <div className="page-heading">
        <div>
          <h1>
            <a className="back" href={`/projects/${t.projectId}${location.search}`}>
              ← Feedback
            </a>
          </h1>
          <p>
            {t.author?.name} · {date(t.createdAt)}
          </p>
        </div>
        <div className="thread-tools" role="group" aria-label="Feedback actions">
          <ExternalLink href={t.context.url}>
            <span className="icon-action" title="Open original page">
              <Icon name="external" />
              <span className="sr-only">Open original page</span>
            </span>
          </ExternalLink>
          {project?.permissions.canWrite && (
            <button
              type="button"
              className="icon-action"
              aria-label="Attach screenshot"
              title="Attach screenshot"
              onClick={() => {
                const upload = document.getElementById(
                  "thread-upload",
                ) as HTMLDetailsElement | null;
                if (upload) {
                  upload.open = true;
                  upload.scrollIntoView({ block: "center" });
                  upload
                    .querySelector<HTMLInputElement>('input[type="file"]')
                    ?.focus({ preventScroll: true });
                }
              }}
            >
              <Icon name="attachment" />
            </button>
          )}
          <button
            type="button"
            className="icon-action"
            aria-label="Activity history"
            title="Activity history"
            onClick={() => {
              setPanel("details");
              requestAnimationFrame(() => {
                const history = document.getElementById(
                  "thread-history",
                ) as HTMLDetailsElement | null;
                if (history) {
                  history.open = true;
                  history.scrollIntoView({ block: "center" });
                  history.querySelector("summary")?.focus({ preventScroll: true });
                }
              });
            }}
          >
            <Icon name="history" />
          </button>
          <button
            className="icon-action"
            aria-label="Copy link"
            title="Copy link"
            onClick={() =>
              a.run(
                () => navigator.clipboard.writeText(`${location.origin}/threads/${t.id}`),
                "Thread link copied.",
              )
            }
          >
            <Icon name="link" />
          </button>
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
      <ThreadNavigation key={threadId} threadId={threadId} />
      <div className="detail-grid">
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
          <div className="state-line">
            <span className={`badge ${t.work.state}`}>{labels[t.work.state]}</span>
            <span>{labels[t.response.state]}</span>
            {t.archived && <span>Archived</span>}
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
          </div>
          {t.assets?.length > 1 && <ScreenshotComparison assets={t.assets} />}
          {t.assets?.length > 0 && (
            <section className="attachments">
              <h2 className="sr-only">Screenshot</h2>
              {t.assets.map((asset, index) => (
                <figure key={asset.id}>
                  <a href={asset.url} target="_blank" rel="noopener noreferrer">
                    <img
                      src={asset.url}
                      alt={`${asset.rendition} attached to feedback`}
                      width={asset.width}
                      height={asset.height}
                      loading={index === 0 ? "eager" : "lazy"}
                    />
                  </a>
                  <figcaption>
                    {asset.width} × {asset.height} · Open full image
                  </figcaption>
                </figure>
              ))}
            </section>
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
                        setImage((current) => (current === pending.image ? "" : current));
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
        <div className="thread-pane">
          <nav className="thread-tabs" aria-label="Thread sections">
            <button
              type="button"
              aria-pressed={panel === "discussion"}
              aria-controls="thread-discussion"
              onClick={() => setPanel("discussion")}
            >
              Discussion <span>{t.replies?.length ?? 0}</span>
            </button>
            <button
              type="button"
              aria-pressed={panel === "details"}
              aria-controls="thread-details"
              onClick={() => setPanel("details")}
            >
              Details
            </button>
          </nav>
          <div id="thread-discussion" hidden={panel !== "discussion"}>
            <section className="replies">
              <h2>
                Discussion <span className="muted">{t.replies?.length ?? 0}</span>
              </h2>
              {t.replies?.length ? (
                t.replies.map((r) => (
                  <article className="reply" key={r.id}>
                    <div className="meta">
                      <strong>{r.author.name}</strong>
                      <span>{r.author.kind === "agent" ? "Agent" : "Team member"}</span>
                      <span>
                        {(r.intent ??
                          (r.author.kind === "agent" ? "response" : "request")) ===
                        "request"
                          ? "Requests follow-up"
                          : "Response"}
                      </span>
                      <time>{date(r.createdAt)}</time>
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
                    onMention={(mention) => setMentions((ranges) => [...ranges, mention])}
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
            hidden={panel !== "details"}
          >
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
                {t.view?.uniqueLikes ?? 0} {t.view?.uniqueLikes === 1 ? "like" : "likes"}{" "}
                · {t.view?.discussionCount ?? 0}{" "}
                {t.view?.discussionCount === 1 ? "discussion" : "discussions"}
              </p>
              {t.view?.weightedPreference !== undefined && (
                <details className="preference-details">
                  <summary>Preference details</summary>
                  <p>
                    Weighted preference: {t.view.weightedPreference}. Separate from unique
                    likes.
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
            {project?.permissions.canWrite && (
              <ThreadStatus
                thread={t}
                canResolve={project.permissions.canResolve}
                onSaved={setThread}
              />
            )}
            <details className="section compact-details">
              <summary>Linked issues</summary>
              {t.externalIssues?.length ? (
                t.externalIssues.map((issue) => (
                  <p key={issue.url}>
                    <ExternalLink href={issue.url}>{issue.url}</ExternalLink>
                    <small>
                      Reported · not remotely verified
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
                    <Field label="GitHub Issue URL">
                      <input
                        name="url"
                        type="url"
                        required
                        placeholder="https://github.com/org/repo/issues/123"
                      />
                    </Field>
                    <button disabled={a.busy}>Register Issue</button>
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
                {date(t.updatedAt)}
              </p>
              {t.work.history?.map((h, n) => (
                <div key={n}>
                  <strong>{labels[h.state ?? ""] ?? h.state}</strong>
                  <p className="message">{h.note}</p>
                  <small>
                    {h.actor?.name}
                    {h.at ? ` · ${date(h.at)}` : ""}
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
    </>
  );
}
