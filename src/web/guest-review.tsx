import React, { useEffect, useState } from "react";
import { api } from "./api.js";
import { HumanTime } from "./human-time.js";
import {
  ActionState,
  ConfirmButton,
  ErrorNotice,
  Field,
  Loading,
  Secret,
  useAction,
  useLoad,
} from "./ui.js";

type Link = {
  id: string;
  label: string;
  expiresAt: string;
  revokedAt: string | null;
  replies: number;
};

export function GuestLinks({ threadId }: { threadId: string }) {
  const [version, setVersion] = useState(0);
  const [newLink, setNewLink] = useState("");
  const links = useLoad(
    () => api<{ items: Link[] }>("guestLinks.list", { threadId }),
    [threadId, version],
  );
  const action = useAction();
  return (
    <details className="section compact-details" id="thread-guest-links">
      <summary>Guest discussion links</summary>
      <p className="muted">
        Each link lets someone read this feedback and add a reply without an account. It
        does not share screenshots, other replies, internal notes or reviewer guidance.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          void action.run(async () => {
            const result = await api<{ path: string }>("guestLinks.create", {
              threadId,
              label: String(data.get("label")),
              expiresInDays: Number(data.get("days")),
            });
            setNewLink(`${location.origin}${result.path}`);
            form.reset();
            setVersion((value) => value + 1);
          });
        }}
      >
        <Field label="Link label" hint="For your records">
          <input name="label" maxLength={80} required placeholder="Client review" />
        </Field>
        <Field label="Expires after">
          <select name="days" defaultValue="7">
            <option value="1">1 day</option>
            <option value="7">7 days</option>
            <option value="30">30 days</option>
          </select>
        </Field>
        <button disabled={action.busy}>Create guest link</button>
      </form>
      <ActionState action={action} />
      {newLink && (
        <Secret
          value={newLink}
          label="Copy this private link now. It is shown only once."
        />
      )}
      <ErrorNotice error={links.error} />
      {!links.data && !links.error && <Loading />}
      {links.data?.items.length === 0 && <p className="muted">No links yet.</p>}
      {links.data?.items.map((link) => (
        <div className="guest-link-row" key={link.id}>
          <div>
            <strong>{link.label}</strong>
            <p className="muted">
              {link.revokedAt ? (
                "Revoked"
              ) : new Date(link.expiresAt).getTime() <= Date.now() ? (
                "Expired"
              ) : (
                <>
                  Expires <HumanTime at={link.expiresAt} />
                </>
              )}
              {" · "}
              {link.replies} {link.replies === 1 ? "reply" : "replies"}
            </p>
          </div>
          {!link.revokedAt && (
            <ConfirmButton
              disabled={action.busy}
              onConfirm={() =>
                void action.run(async () => {
                  await api("guestLinks.revoke", { linkId: link.id });
                  setVersion((value) => value + 1);
                })
              }
            >
              Revoke
            </ConfirmButton>
          )}
        </div>
      ))}
    </details>
  );
}

export function GuestReview({ token }: { token: string }) {
  const [posted, setPosted] = useState(false);
  const details = useLoad(
    () =>
      token
        ? api<{
            projectName: string;
            threadBody: string;
            expiresAt: string;
            turnstileSiteKey: string;
          }>("guest.inspect", { token })
        : Promise.reject(
            new Error("Open the complete guest link to review this feedback."),
          ),
    [token],
  );
  const action = useAction();
  useEffect(() => {
    if (!details.data?.turnstileSiteKey) return;
    if (document.querySelector('script[data-feedbacks-turnstile="true"]')) return;
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    script.async = true;
    script.defer = true;
    script.dataset.feedbacksTurnstile = "true";
    document.head.append(script);
  }, [details.data?.turnstileSiteKey]);
  return (
    <main className="guest-review" id="content">
      <a className="brand" href="/">
        Feedbacks
        <span className="brand-dot" />
      </a>
      <div className="guest-review-content">
        <p className="eyebrow">Guest discussion</p>
        <h1>Review this feedback</h1>
        <ErrorNotice error={details.error} />
        {!details.data && !details.error && <Loading />}
        {details.data && (
          <>
            <p className="muted">
              {details.data.projectName} · Link expires{" "}
              <HumanTime at={details.data.expiresAt} />
            </p>
            <section className="section">
              <h2>Feedback</h2>
              <p className="message">{details.data.threadBody}</p>
            </section>
            {posted ? (
              <section className="section" role="status">
                <h2>Reply sent</h2>
                <p>The team can see your reply. You can close this page.</p>
              </section>
            ) : (
              <form
                className="section form-grid"
                onSubmit={(event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  void (async () => {
                    const verified = await action.run(async () => {
                      await api("guest.reply", {
                        token,
                        name: String(data.get("name")),
                        body: String(data.get("body")),
                        turnstileToken: String(data.get("cf-turnstile-response") ?? ""),
                      });
                      setPosted(true);
                    });
                    if (!verified)
                      (
                        window as typeof window & { turnstile?: { reset: () => void } }
                      ).turnstile?.reset();
                  })();
                }}
              >
                <h2>Add your reply</h2>
                <Field label="Your name">
                  <input name="name" maxLength={120} required autoComplete="name" />
                </Field>
                <Field label="Reply">
                  <textarea name="body" maxLength={12000} rows={6} required />
                </Field>
                <p className="muted">
                  Your name and reply will be visible to this project's team.
                </p>
                <div
                  className="cf-turnstile"
                  data-sitekey={details.data.turnstileSiteKey}
                  data-action="guest_reply"
                  data-theme="auto"
                />
                <ActionState action={action} />
                <button className="primary" disabled={action.busy}>
                  Send reply
                </button>
              </form>
            )}
          </>
        )}
      </div>
    </main>
  );
}
