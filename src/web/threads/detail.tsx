import { DeleteThreadsButton, ArchiveThreadButton } from "./deletion.js";
import { useEffect, useRef, useState } from "react";
import { ThreadMove } from "./move.js";
import { ThreadTaskCopy } from "./task-copy.js";
import { ThreadWorkPlan } from "./work-plan.js";
import { ThreadStatus } from "./status.js";
import { ThreadAssignments } from "../assignments/thread-assignments.js";
import { ThreadReview } from "./review.js";
import { DiscussionReply } from "./reply.js";
import { DiscussionLike } from "../discussion-like.js";
import { ContextPanel } from "./context.js";
import { ReviewEvidence } from "./detail/evidence.js";
import { ThreadRecordings } from "../recordings/thread-recordings.js";
import { ScreenshotMarkup, type MarkupTarget } from "../screenshot-markup.js";
import { ThreadAttachments } from "./attachments.js";
import { ThreadLinks } from "./links.js";
import {
  DiagnosticEvidencePanel,
  type DiagnosticEvidenceSummary,
} from "./diagnostic-evidence.js";
import { PointProgressRing } from "../point-progress-ring.js";
import { navigate, useUnsavedChanges } from "../navigation.js";
import { ThreadNavigation } from "./detail/navigation.js";
import { ThreadOrganization } from "./detail/organization.js";
import { ScreenshotComparison } from "./detail/comparison.js";
import { ThreadDiagnostics } from "./detail/diagnostics.js";
import { MentionInput } from "../mention-input.js";
import { MarkdownText } from "../markdown-text.js";
import {
  mentionIds,
  reconcileMentionRanges,
  type MentionRange,
} from "../mention-ranges.js";
import { Icon } from "../icons.js";
import { GuestLinks } from "../guest-review.js";
import { GithubIssue } from "../github/issue.js";
import { api, uid, labels, type Actor, type Project, type Thread } from "../api.js";
import {
  builtInCategories,
  categoryName,
  type ProjectTaxonomy,
} from "../../shared/taxonomy.js";
import { TagBadge } from "../project-taxonomy.js";
import { HumanTime } from "../human-time.js";
import {
  ActionState,
  ErrorNotice,
  ExternalLink,
  Field,
  Loading,
  Notice,
  useAction,
  useLoad,
} from "../ui.js";
export function ThreadDetail({
  threadId,
  actor,
  onProject,
}: {
  threadId: string;
  actor: Actor;
  onProject: (p: Project) => void;
}) {
  const [version, setVersion] = useState(0),
    [assignmentToolbar, setAssignmentToolbar] = useState<HTMLDivElement | null>(null),
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
    { data: loadedProject, error: projectError } = useLoad(
      () =>
        t?.id === threadId
          ? api<Project>("projects.get", { projectId: t.projectId })
          : Promise.resolve(undefined),
      [threadId, t?.projectId, projectVersion],
    );
  const project = loadedProject?.id === t?.projectId ? loadedProject : undefined;
  const { data: taxonomy, error: taxonomyError } = useLoad<ProjectTaxonomy | undefined>(
    () =>
      project
        ? api<ProjectTaxonomy>("projects.taxonomy.get", { projectId: project.id })
        : Promise.resolve(undefined),
    [threadId, project?.id, projectVersion],
  );
  const [markupTarget, setMarkupTarget] = useState<MarkupTarget | null>(null);
  const assetIds = t?.assets.map((asset) => asset.id).join(",");
  useEffect(() => {
    if (!t || t.context.annotations?.length) return;
    const openLinkedAsset = () => {
      const linked = t.assets.find((asset) => location.hash === `#asset-${asset.id}`);
      if (!linked) return;
      const element = document.getElementById(`asset-${linked.id}`);
      const group = element?.closest("details");
      if (group) group.open = true;
      element?.scrollIntoView({ block: "start" });
    };
    openLinkedAsset();
    addEventListener("hashchange", openLinkedAsset);
    return () => removeEventListener("hashchange", openLinkedAsset);
  }, [t?.id, assetIds]);
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
    [mentions, setMentions] = useState<MentionRange[]>([]),
    replyEditVersion = useRef(0),
    replyRetry = useRef<
      | {
          body: string;
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
  useUnsavedChanges(
    !!reply.trim() || mentions.length > 0 || !!image || !!markupTarget || a.busy,
  );
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
  const diagnosticEvidence = (
    t as Thread & {
      diagnosticEvidence?: {
        count: number;
        latest: DiagnosticEvidenceSummary[];
      };
    }
  ).diagnosticEvidence;
  return (
    <>
      <div className="page-heading thread-page-heading">
        <div>
          <h1>
            <a className="back" href={`/projects/${t.projectId}${location.search}`}>
              ← Feedback
            </a>
          </h1>
          <div className="thread-heading-meta">
            <p>
              {t.author?.name} · <HumanTime at={t.createdAt} />
            </p>
            <PointProgressRing thread={t} />
          </div>
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
          {project?.permissions.canMaintain && (
            <>
              <ArchiveThreadButton thread={t} onSaved={setThread} headerAction />
              <DeleteThreadsButton
                projectId={t.projectId}
                threads={[t]}
                onDeleted={() => navigate(`/projects/${t.projectId}`)}
                headerAction
              />
            </>
          )}
          <div ref={setAssignmentToolbar} className="thread-assignee-slot" />
          {project?.permissions.canWrite && (
            <ThreadStatus
              key={`status:${t.id}`}
              thread={t}
              canResolve={project.permissions.canResolve}
              onSaved={setThread}
            />
          )}
          {project && (
            <>
              <ThreadWorkPlan
                thread={t}
                onSaved={setThread}
                canWrite={project.permissions.canWrite}
              />
              <ThreadTaskCopy thread={t} project={project} />
              <a
                className="thread-icon-button"
                href={`/api/threads/${encodeURIComponent(t.id)}/archive`}
                aria-label="Download complete thread bundle"
                data-tooltip="Download complete thread bundle"
                title="Download complete thread bundle"
              >
                <Icon name="download" />
              </a>
            </>
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
            {project?.permissions.canMaintain ? (
              <GithubIssue
                key={`github:${t.id}`}
                thread={t}
                project={project}
                onSaved={setThread}
                onViewIssues={() => openDetail("thread-issues")}
              />
            ) : (
              <button
                type="button"
                className="thread-icon-button"
                aria-label="View or link issues"
                data-tooltip="View or link issues"
                onClick={() => openDetail("thread-issues")}
              >
                <Icon name="issue" />
              </button>
            )}
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
                {project?.permissions.canMaintain && (
                  <ThreadMove
                    thread={t}
                    onMoved={(updated) => {
                      setThread(updated);
                      navigate(`/threads/${updated.id}`, {
                        replace: true,
                        preservePosition: true,
                      });
                    }}
                  />
                )}
                {project?.permissions.canMaintain && (
                  <button
                    type="button"
                    onClick={() =>
                      (
                        document.getElementById(
                          "thread-github",
                        ) as HTMLDialogElement | null
                      )?.showModal()
                    }
                  >
                    GitHub issue options
                  </button>
                )}
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
      <ErrorNotice error={taxonomyError} />
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
      {project && (
        <ThreadAssignments
          key={t.id}
          thread={t}
          project={project}
          taxonomy={taxonomy}
          toolbar={assignmentToolbar}
          onRefresh={async () => {
            const latest = await api<Thread>("threads.get", { threadId: t.id });
            setThread(latest);
            return latest;
          }}
          onGithub={() => {
            const dialog = document.getElementById(
              "thread-github",
            ) as HTMLDialogElement | null;
            if (dialog) dialog.showModal();
            else openDetail("thread-issues");
          }}
        />
      )}
      <div className="thread-content">
        <div className={`detail-grid ${panel === "details" ? "showing-details" : ""}`}>
          <div className="evidence-pane">
            <article className="first-comment">
              <div className="thread-taxonomy">
                <span className="category-badge">
                  {categoryName(taxonomy?.categories ?? builtInCategories, t.category)}
                </span>
                {(t.tags ?? []).map((tag) => (
                  <TagBadge key={tag} name={tag} tags={taxonomy?.tags ?? []} />
                ))}
                {project?.permissions.canWrite && (
                  <button
                    type="button"
                    className="thread-taxonomy-edit"
                    onClick={() => openDetail("thread-organize")}
                  >
                    Edit category &amp; tags
                  </button>
                )}
              </div>
              <MarkdownText body={t.body} className="message" />
            </article>
            <ThreadRecordings
              key={t.id}
              thread={t}
              canWrite={!!project?.permissions.canWrite}
              onSaved={setThread}
              onAnnotateFrame={
                project?.permissions.canWrite
                  ? (frame) => setMarkupTarget({ kind: "frame", ...frame })
                  : undefined
              }
            />
            {!!t.context.annotations?.length && (
              <ReviewEvidence
                thread={t}
                canWrite={project?.permissions.canWrite}
                canResolve={project?.permissions.canResolve}
                canMaintain={project?.permissions.canMaintain}
                onSaved={setThread}
                onAnnotate={(asset) => setMarkupTarget({ kind: "asset", asset })}
              />
            )}
            <ThreadAttachments
              thread={t}
              onAnnotate={
                project?.permissions.canWrite
                  ? (asset) => setMarkupTarget({ kind: "asset", asset })
                  : undefined
              }
            />
            {markupTarget && project?.permissions.canWrite && (
              <ScreenshotMarkup
                key={
                  markupTarget.kind === "asset"
                    ? markupTarget.asset.id
                    : `${markupTarget.recordingFrame.recordingId}-${markupTarget.recordingFrame.atMs}`
                }
                thread={t}
                target={markupTarget}
                onSaved={setThread}
                onClose={() => setMarkupTarget(null)}
              />
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
                    Replies <span className="muted">{t.replies?.length ?? 0}</span>
                  </h2>
                  {t.replies?.length ? (
                    t.replies.map((r) => (
                      <DiscussionReply
                        key={r.id}
                        threadId={t.id}
                        revision={t.revision}
                        reply={r}
                        actor={actor}
                        canWrite={!!project?.permissions.canWrite}
                        members={members?.items ?? []}
                        onSaved={setThread}
                        onLikesSaved={(likes) =>
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
                    ))
                  ) : (
                    <p className="muted">
                      No replies yet. The original feedback and numbered comments are
                      shown with the evidence.
                    </p>
                  )}
                  {project?.permissions.canWrite && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (
                          replyRetry.current?.body !== reply ||
                          JSON.stringify(replyRetry.current?.mentions) !==
                            JSON.stringify(mentionIds(mentions))
                        )
                          replyRetry.current = {
                            body: reply,
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
                  taxonomy={taxonomy}
                  onSaved={(saved) => {
                    setThread(saved);
                    setProjectVersion((value) => value + 1);
                  }}
                />
                <ContextPanel context={t.context} />
                {t.diagnostics && <ThreadDiagnostics diagnostics={t.diagnostics} />}
                <DiagnosticEvidencePanel
                  key={t.id}
                  threadId={t.id}
                  summaries={diagnosticEvidence?.latest ?? []}
                  totalCount={diagnosticEvidence?.count ?? 0}
                />
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
                <ThreadLinks
                  thread={t}
                  canWrite={!!project?.permissions.canWrite}
                  canMaintain={!!project?.permissions.canMaintain}
                  busy={a.busy}
                  mutate={mutate}
                />
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
              </aside>
            </div>
          </div>
        </div>
        <ThreadNavigation key={`${threadId}:${t.projectId}`} threadId={threadId} />
      </div>
    </>
  );
}
