import { useRef, useState } from "react";
import { api, date, uid, type Actor, type Thread } from "../api.js";
import { DiscussionLike } from "../discussion-like.js";
import { HumanTime } from "../human-time.js";
import { MarkdownText } from "../markdown-text.js";
import { MentionInput } from "../mention-input.js";
import {
  mentionIds,
  reconcileMentionRanges,
  type MentionRange,
} from "../mention-ranges.js";
import { useUnsavedChanges } from "../navigation.js";
import { ActionState, showToast, useAction } from "../ui.js";

type Reply = Thread["replies"][number];
type Member = { id: string; name: string; active: boolean };

function selectedMentions(reply: Reply, members: Member[]): MentionRange[] {
  const selected = new Set(reply.mentions ?? []);
  const ranges: MentionRange[] = [];
  for (const member of members) {
    if (!member.active || !selected.has(member.id)) continue;
    const token = `@${member.name}`;
    let start = 0;
    while ((start = reply.body.indexOf(token, start)) !== -1) {
      const end = start + token.length;
      const before = reply.body[start - 1];
      const after = reply.body[end];
      if (
        (!before || !/[\p{L}\p{N}_]/u.test(before)) &&
        (!after || !/[\p{L}\p{N}_]/u.test(after))
      )
        ranges.push({ start, end, id: member.id, label: member.name });
      start = end;
    }
  }
  return ranges;
}

export function DiscussionReply({
  threadId,
  revision,
  reply,
  actor,
  canWrite,
  members,
  onSaved,
  onLikesSaved,
}: {
  threadId: string;
  revision: number;
  reply: Reply;
  actor: Actor;
  canWrite: boolean;
  members: Member[];
  onSaved: (thread: Thread) => void;
  onLikesSaved: (likes: Reply["likes"]) => void;
}) {
  const action = useAction();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(reply.body);
  const [mentions, setMentions] = useState<MentionRange[]>([]);
  const editVersion = useRef(0);
  const editRetry = useRef<
    { body: string; mentions: string[]; revision: number; key: string } | undefined
  >(undefined);
  const deleteRetry = useRef<{ revision: number; key: string } | undefined>(undefined);
  const canManage =
    canWrite &&
    actor.kind === "human" &&
    actor.userId === reply.author.userId &&
    ["human", "extension"].includes(reply.author.kind);
  useUnsavedChanges((editing && draft !== reply.body) || action.busy);

  function beginEdit() {
    setDraft(reply.body);
    setMentions(selectedMentions(reply, members));
    editRetry.current = undefined;
    action.setError("");
    setEditing(true);
  }

  async function saveEdit() {
    const selected = mentionIds(mentions);
    if (
      editRetry.current?.body !== draft ||
      editRetry.current.revision !== revision ||
      JSON.stringify(editRetry.current.mentions) !== JSON.stringify(selected)
    )
      editRetry.current = {
        body: draft,
        mentions: selected,
        revision,
        key: uid(),
      };
    const pending = editRetry.current;
    const submittedVersion = editVersion.current;
    await action.run(async () => {
      onSaved(
        await api<Thread>("threads.editReply", {
          threadId,
          replyId: reply.id,
          revision: pending.revision,
          body: pending.body,
          mentions: pending.mentions,
          idempotencyKey: pending.key,
        }),
      );
      editRetry.current = undefined;
      if (editVersion.current === submittedVersion) setEditing(false);
      showToast("Comment updated.");
    });
  }

  async function deleteReply() {
    if (
      !window.confirm("Delete this comment? This permanently removes it and its likes.")
    )
      return;
    if (deleteRetry.current?.revision !== revision)
      deleteRetry.current = { revision, key: uid() };
    const pending = deleteRetry.current;
    await action.run(async () => {
      onSaved(
        await api<Thread>("threads.deleteReply", {
          threadId,
          replyId: reply.id,
          revision: pending.revision,
          idempotencyKey: pending.key,
        }),
      );
      deleteRetry.current = undefined;
      showToast("Comment deleted.");
    });
  }

  return (
    <article className="reply">
      <div className="meta">
        <strong>{reply.author.name}</strong>
        <span>{reply.author.kind === "agent" ? "Agent" : "Team member"}</span>
        <span>
          {(reply.intent ?? (reply.author.kind === "agent" ? "response" : "request")) ===
          "request"
            ? "Requests follow-up"
            : "Response"}
        </span>
        <HumanTime at={reply.createdAt} />
        {reply.editedAt && (
          <span className="reply-edited">
            Edited on <time dateTime={reply.editedAt}>{date(reply.editedAt)}</time>
          </span>
        )}
      </div>
      {editing ? (
        <form
          className="reply-edit-form"
          onSubmit={(event) => {
            event.preventDefault();
            void saveEdit();
          }}
        >
          <MentionInput
            label="Edit comment"
            value={draft}
            members={members}
            onChange={(value, edit) => {
              editVersion.current++;
              setMentions((ranges) => reconcileMentionRanges(draft, value, ranges, edit));
              setDraft(value);
            }}
            onMention={(mention) => {
              editVersion.current++;
              setMentions((ranges) => [...ranges, mention]);
            }}
          />
          <div className="reply-edit-actions">
            <button
              type="button"
              disabled={action.busy}
              onClick={() => {
                setEditing(false);
                editRetry.current = undefined;
                action.setError("");
              }}
            >
              Cancel
            </button>
            <button className="primary" disabled={action.busy || !draft.trim()}>
              {action.busy ? "Saving…" : "Save edit"}
            </button>
          </div>
        </form>
      ) : (
        <MarkdownText body={reply.body} className="message" />
      )}
      <div className="reply-controls">
        <DiscussionLike
          threadId={threadId}
          replyId={reply.id}
          target={`reply by ${reply.author.name} from ${date(reply.createdAt)}`}
          likes={reply.likes}
          canWrite={canWrite}
          onSaved={onLikesSaved}
        />
        {canManage && !editing && (
          <>
            <button
              type="button"
              aria-label={`Edit comment by ${reply.author.name} from ${date(reply.createdAt)}`}
              disabled={action.busy}
              onClick={beginEdit}
            >
              Edit
            </button>
            <button
              type="button"
              className="danger"
              aria-label={`Delete comment by ${reply.author.name} from ${date(reply.createdAt)}`}
              disabled={action.busy}
              onClick={() => void deleteReply()}
            >
              Delete
            </button>
          </>
        )}
      </div>
      <ActionState action={action} />
    </article>
  );
}
