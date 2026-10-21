import React, { useState } from "react";
import { api } from "../api.js";
import { ActionState, ErrorNotice, Field, useAction, useLoad } from "../ui.js";
export function ExternalReplayLinks({
  thread,
  canWrite,
}: {
  thread: { id: string; revision: number; context: { url?: string } };
  canWrite: boolean;
}) {
  const [version, setVersion] = useState(0);
  const action = useAction();
  const { data, error } = useLoad(
    () =>
      api<{
        items: { id: string; provider: string; sessionUrl: string; capturedAt: string }[];
      }>("replayLinks.list", { threadId: thread.id }),
    [thread.id, version],
  );
  return (
    <details>
      <summary>
        Fullstory and LogRocket sessions
        {data?.items.length ? ` (${data.items.length})` : ""}
      </summary>
      <ErrorNotice error={error} />
      <ActionState action={action} />
      <p>
        Reviewer-provided links for this exact page. Provider login and retention still
        apply.
      </p>
      <ul>
        {data?.items.map((item) => (
          <li key={item.id}>
            <a href={item.sessionUrl} target="_blank" rel="noreferrer">
              {item.provider === "fullstory" ? "Fullstory" : "LogRocket"} ·{" "}
              {new Date(item.capturedAt).toLocaleString()}
            </a>
            {canWrite && (
              <button
                type="button"
                disabled={action.busy}
                onClick={() =>
                  action.run(async () => {
                    await api("replayLinks.remove", { linkId: item.id });
                    setVersion((v) => v + 1);
                  }, "Session link removed.")
                }
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      {canWrite && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget,
              fields = new FormData(form);
            action.run(async () => {
              await api("replayLinks.add", {
                threadId: thread.id,
                revision: thread.revision,
                provider: String(fields.get("provider")) as "fullstory" | "logrocket",
                sessionUrl: String(fields.get("sessionUrl")),
                pageUrl: String(fields.get("pageUrl")),
                capturedAt: new Date(String(fields.get("capturedAt"))).toISOString(),
                idempotencyKey: crypto.randomUUID(),
              });
              form.reset();
              setVersion((v) => v + 1);
            }, "Reviewed session link added.");
          }}
        >
          <Field label="Provider">
            <select name="provider">
              <option value="fullstory">Fullstory</option>
              <option value="logrocket">LogRocket</option>
            </select>
          </Field>
          <Field label="Provider session URL">
            <input name="sessionUrl" type="url" required maxLength={4000} />
          </Field>
          <Field label="Exact page URL reviewed in that session">
            <input
              name="pageUrl"
              type="url"
              required
              maxLength={4096}
              defaultValue={thread.context.url}
            />
          </Field>
          <Field label="Capture time">
            <input name="capturedAt" type="datetime-local" required />
          </Field>
          <p>
            Check that this is the right person's session and page before sharing. No
            cookies, page contents or replay recordings are imported.
          </p>
          <button type="submit" disabled={action.busy}>
            Add reviewed session link
          </button>
        </form>
      )}
    </details>
  );
}
