import React, { useEffect, useState } from "react";
import { api, date } from "./api.js";
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

type ProjectLink = {
  id: string;
  label: string;
  expiresAt: string;
  revokedAt: string | null;
  submissions: number;
  maxSubmissions: number;
  widget: boolean;
};

export function GuestProjectLinks({ projectId }: { projectId: string }) {
  const [version, setVersion] = useState(0);
  const [newLink, setNewLink] = useState("");
  const [newLinkLabel, setNewLinkLabel] = useState("");
  const links = useLoad(
    () => api<{ items: ProjectLink[] }>("guestProjectLinks.list", { projectId }),
    [projectId, version],
  );
  const action = useAction();
  return (
    <section className="section">
      <h2>Guest feedback links</h2>
      <p className="muted">
        Invite someone to send new feedback to this project without an account. A link
        cannot show existing feedback, screenshots, member notes or reviewer guidance.
        Each submission needs a page URL and a Turnstile check. A website widget can add
        page and viewport context. For private screenshots, use the extension.
      </p>
      <form
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          void action.run(async () => {
            const widget = data.get("widget") === "on";
            const result = await api<{ path: string; widgetSnippet?: string }>(
              "guestProjectLinks.create",
              {
                projectId,
                label: String(data.get("label")),
                expiresInDays: Number(data.get("days")),
                maxSubmissions: Number(data.get("maxSubmissions")),
                widget,
              },
            );
            setNewLink(
              widget ? (result.widgetSnippet ?? "") : `${location.origin}${result.path}`,
            );
            setNewLinkLabel(
              widget
                ? "Copy this script into an approved website. It is shown only once."
                : "Copy this private link now. It is shown only once.",
            );
            form.reset();
            setVersion((value) => value + 1);
          });
        }}
      >
        <Field label="Link label" hint="For your records">
          <input name="label" maxLength={80} required placeholder="Client intake" />
        </Field>
        <Field label="Expires after">
          <select name="days" defaultValue="7">
            <option value="1">1 day</option>
            <option value="7">7 days</option>
            <option value="30">30 days</option>
          </select>
        </Field>
        <Field label="Maximum submissions">
          <input
            name="maxSubmissions"
            type="number"
            min={1}
            max={50}
            defaultValue={10}
            required
          />
        </Field>
        <label className="widget-option">
          <input name="widget" type="checkbox" />
          <span>
            Website widget: create a launcher script for the project's exact approved
            origins
          </span>
        </label>
        <button disabled={action.busy}>Create guest feedback link</button>
      </form>
      <ActionState action={action} />
      {newLink && <Secret value={newLink} label={newLinkLabel} />}
      <ErrorNotice error={links.error} />
      {!links.data && !links.error && <Loading />}
      {links.data?.items.length === 0 && (
        <p className="muted">No guest feedback links yet.</p>
      )}
      {links.data?.items.map((link) => (
        <div className="guest-link-row" key={link.id}>
          <div>
            <strong>{link.label}</strong>
            {link.widget && <span className="muted"> · Website widget</span>}
            <p className="muted">
              {link.revokedAt
                ? "Revoked"
                : new Date(link.expiresAt).getTime() <= Date.now()
                  ? "Expired"
                  : link.submissions >= link.maxSubmissions
                    ? "Limit reached"
                    : `Expires ${date(link.expiresAt)}`}
              {` · ${link.submissions} of ${link.maxSubmissions} submissions`}
            </p>
          </div>
          {!link.revokedAt && (
            <ConfirmButton
              disabled={action.busy}
              onConfirm={() =>
                void action.run(async () => {
                  await api("guestProjectLinks.revoke", { linkId: link.id });
                  setVersion((value) => value + 1);
                })
              }
            >
              Revoke
            </ConfirmButton>
          )}
        </div>
      ))}
    </section>
  );
}

export function GuestProjectReview({ token }: { token: string }) {
  const [posted, setPosted] = useState(false);
  const details = useLoad(
    () =>
      token
        ? api<{ projectName: string; expiresAt: string; turnstileSiteKey: string }>(
            "guestProject.inspect",
            { token },
          )
        : Promise.reject(new Error("Open the complete guest feedback link.")),
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
        <p className="eyebrow">Guest feedback</p>
        <h1>Send feedback to the team</h1>
        <ErrorNotice error={details.error} />
        {!details.data && !details.error && <Loading />}
        {details.data && (
          <>
            <p className="muted">
              {details.data.projectName} · Link expires {date(details.data.expiresAt)}
            </p>
            {posted ? (
              <section className="section" role="status">
                <h2>Feedback sent</h2>
                <p>The project team can see your feedback. You can close this page.</p>
              </section>
            ) : (
              <form
                className="section form-grid"
                onSubmit={(event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  void (async () => {
                    const verified = await action.run(async () => {
                      await api("guestProject.submit", {
                        token,
                        name: String(data.get("name")),
                        url: String(data.get("url")),
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
                <h2>New feedback</h2>
                <Field label="Your name">
                  <input name="name" maxLength={120} required autoComplete="name" />
                </Field>
                <Field
                  label="Page URL"
                  hint="Use a page on the website this project reviews."
                >
                  <input
                    name="url"
                    type="url"
                    maxLength={4096}
                    required
                    placeholder="https://example.com/page"
                  />
                </Field>
                <Field label="Feedback">
                  <textarea name="body" maxLength={12000} rows={6} required />
                </Field>
                <p className="muted">
                  Your name, page URL and feedback will be visible to this project's team.
                  This link does not open the team's existing feedback.
                </p>
                <div
                  className="cf-turnstile"
                  data-sitekey={details.data.turnstileSiteKey}
                  data-action="guest_project_submit"
                  data-theme="auto"
                />
                <ActionState action={action} />
                <button className="primary" disabled={action.busy}>
                  Send feedback
                </button>
              </form>
            )}
          </>
        )}
      </div>
    </main>
  );
}
