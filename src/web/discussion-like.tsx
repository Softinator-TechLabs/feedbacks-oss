import React, { useRef, useState } from "react";
import { api, errorText } from "./api.js";
import { ErrorNotice } from "./ui.js";

type Likes = { uniqueLikes: number; liked: boolean };
export function DiscussionLike({
  threadId,
  replyId,
  target,
  likes,
  canWrite,
  onSaved,
}: {
  threadId: string;
  replyId?: string;
  target: string;
  likes: Likes;
  canWrite: boolean;
  onSaved: (likes: Likes) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const pending = useRef<{ liked: boolean } | null>(null);
  const inFlight = useRef(false);
  async function save() {
    if (inFlight.current) return;
    inFlight.current = true;
    // A retry after an uncertain response repeats the same explicit set intent.
    pending.current ??= { liked: !likes.liked };
    setBusy(true);
    setError("");
    try {
      const result = await api<Likes>("threads.like", {
        threadId,
        replyId,
        liked: pending.current.liked,
      });
      onSaved({ uniqueLikes: result.uniqueLikes, liked: result.liked });
      pending.current = null;
    } catch (e) {
      setError(errorText(e));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="discussion-like">
      <button
        type="button"
        aria-pressed={likes.liked}
        aria-label={`${likes.liked ? "Unlike" : "Like"} ${target}; ${likes.uniqueLikes} ${likes.uniqueLikes === 1 ? "like" : "likes"}`}
        disabled={!canWrite || busy}
        onClick={() => void save()}
      >
        {busy ? "Saving…" : error ? "Retry like" : likes.liked ? "Liked" : "Like"} ·{" "}
        {likes.uniqueLikes}
      </button>
      <ErrorNotice error={error} />
    </div>
  );
}
