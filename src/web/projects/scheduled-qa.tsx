import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { HumanTime } from "../human-time.js";
import {
  ActionState,
  ConfirmButton,
  ErrorNotice,
  Field,
  useAction,
  useLoad,
} from "../ui.js";

type QaConfig = { enabled: boolean; urls: string[]; nextAt: string | null };
type QaRun = {
  id: string;
  createdAt: string;
  pages: {
    url: string;
    status: number | null;
    missingAlt: number;
    checkedLinks: number;
    brokenLinks: { path: string; status: number }[];
    error: string | null;
  }[];
};

export function ScheduledQaSettings({ projectId }: { projectId: string }) {
  const action = useAction();
  const [version, setVersion] = useState(0);
  const [draft, setDraft] = useState("");
  const [edited, setEdited] = useState(false);
  const config = useLoad<QaConfig>(
    () => api("qa.get", { projectId }),
    [projectId, version],
  );
  const runs = useLoad<{ items: QaRun[] }>(
    () => api("qa.runs", { projectId }),
    [projectId, version],
    true,
  );
  useEffect(() => {
    if (!edited && config.data) setDraft(config.data.urls.join("\n"));
  }, [config.data, edited]);
  const urls = draft
    .split("\n")
    .map((url) => url.trim())
    .filter(Boolean);
  return (
    <section className="section" aria-labelledby="qa-heading">
      <h2 id="qa-heading">Scheduled page QA</h2>
      <p className="muted">
        Opt in to daily checks of up to three public HTTPS pages on exact approved
        origins. The server checks returned HTML and up to six same-origin links per page.
        It cannot sign in, run JavaScript or capture a browser screenshot. Review findings
        before creating feedback.
      </p>
      <form
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          void action.run(async () => {
            const result = await api<QaConfig>("qa.configure", {
              projectId,
              enabled: true,
              urls,
            });
            config.setData(result);
            setEdited(false);
            setVersion((value) => value + 1);
          }, "QA settings saved. Check when the next scan is eligible below.");
        }}
      >
        <Field
          label="Page URLs, one per line"
          hint="Public HTTPS pages only; no query or fragment. Up to three URLs."
        >
          <textarea
            value={draft}
            rows={3}
            maxLength={1600}
            placeholder="https://example.com/"
            onChange={(event) => {
              setDraft(event.target.value);
              setEdited(true);
            }}
          />
        </Field>
        <div className="actions">
          <button
            className="primary"
            disabled={action.busy || urls.length === 0 || urls.length > 3}
          >
            Save and enable
          </button>
          {config.data?.enabled && (
            <button
              type="button"
              disabled={action.busy}
              onClick={() =>
                void action.run(async () => {
                  await api("qa.runNow", { projectId });
                  setVersion((value) => value + 1);
                }, "Scan queued for the next worker tick.")
              }
            >
              Run soon
            </button>
          )}
          {config.data?.enabled && (
            <ConfirmButton
              disabled={action.busy}
              onConfirm={() =>
                void action.run(async () => {
                  const result = await api<QaConfig>("qa.configure", {
                    projectId,
                    enabled: false,
                    urls: config.data?.urls ?? [],
                  });
                  config.setData(result);
                  setVersion((value) => value + 1);
                }, "Daily QA disabled.")
              }
            >
              Disable QA
            </ConfirmButton>
          )}
        </div>
        <ActionState action={action} />
      </form>
      <ErrorNotice error={config.error || runs.error} />
      {config.data?.enabled && (
        <p className="muted">
          Eligible for next scan:{" "}
          {config.data.nextAt ? <HumanTime at={config.data.nextAt} /> : "pending"}
        </p>
      )}
      <div className="qa-history">
        <h3>Recent scans</h3>
        {runs.data?.items.length ? (
          runs.data.items.map((run) => (
            <details key={run.id} className="compact-details">
              <summary>
                <HumanTime at={run.createdAt} /> · {run.pages.length} page
                {run.pages.length === 1 ? "" : "s"}
              </summary>
              {run.pages.map((page) => (
                <div key={page.url}>
                  <p>
                    <strong>{page.url}</strong> · HTTP {page.status ?? "unknown"}
                  </p>
                  {page.error && <p className="muted">{page.error}</p>}
                  <p>
                    {page.missingAlt >= 10 ? "10+" : page.missingAlt} static image tag
                    {page.missingAlt === 1 ? "" : "s"} without alt ·{" "}
                    {page.brokenLinks.length} definite broken link
                    {page.brokenLinks.length === 1 ? "" : "s"} among {page.checkedLinks}{" "}
                    checked
                  </p>
                  {page.brokenLinks.length > 0 && (
                    <ul>
                      {page.brokenLinks.map((link, index) => (
                        <li key={`${link.path}-${index}`}>
                          HTTP {link.status}: {link.path}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </details>
          ))
        ) : (
          <p className="muted">No scans recorded yet.</p>
        )}
      </div>
    </section>
  );
}
