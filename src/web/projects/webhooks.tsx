import React, { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { HumanTime } from "../human-time.js";
import {
  ActionState,
  ConfirmButton,
  ErrorNotice,
  Field,
  Secret,
  useAction,
  useLoad,
} from "../ui.js";

type WebhookConfig = {
  configured: boolean;
  url: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};
type WebhookDelivery = {
  id: string;
  status: "pending" | "delivered" | "failed";
  attempts: number;
  lastStatus: number | null;
  createdAt: string;
  deliveredAt: string | null;
};

export function WebhookSettings({ projectId }: { projectId: string }) {
  const a = useAction();
  const [version, setVersion] = useState(0);
  const [draftUrl, setDraftUrl] = useState("");
  const draftRef = useRef("");
  const [edited, setEdited] = useState(false);
  const [secret, setSecret] = useState<string>();
  const config = useLoad<WebhookConfig>(
    () => api("webhooks.get", { projectId }),
    [projectId, version],
  );
  const deliveries = useLoad<{ items: WebhookDelivery[] }>(
    () => api("webhooks.deliveries", { projectId }),
    [projectId, version],
    true,
  );
  const failedCount =
    deliveries.data?.items.filter((item) => item.status === "failed").length ?? 0;
  useEffect(() => {
    if (!edited && config.data) {
      const url = config.data.url ?? "";
      setDraftUrl(url);
      draftRef.current = url;
    }
  }, [config.data, edited]);
  return (
    <section className="section" aria-labelledby="webhook-heading">
      <h2 id="webhook-heading">Webhooks</h2>
      <p className="muted">
        Send signed thread activity to one HTTPS destination. Events contain IDs, type,
        revision and time, without discussion text or private notes.
      </p>
      <form
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          const url = draftUrl.trim();
          void a.run(
            async () => {
              const result = await api<{ url: string; secret?: string }>(
                "webhooks.save",
                {
                  projectId,
                  url,
                },
              );
              if (result.secret) setSecret(result.secret);
              config.setData((current) => ({
                configured: true,
                url: result.url,
                createdAt: current?.createdAt ?? new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              }));
              if (draftRef.current.trim() === url) {
                setDraftUrl(result.url);
                draftRef.current = result.url;
                setEdited(false);
              }
              setVersion((current) => current + 1);
            },
            config.data?.configured
              ? "Destination saved. The signing secret is unchanged."
              : "Webhook saved.",
          );
        }}
      >
        <Field
          label="Destination URL"
          hint="Public HTTPS on port 443. Do not put a token in the URL."
        >
          <input
            name="webhookUrl"
            type="url"
            inputMode="url"
            value={draftUrl}
            placeholder="https://hooks.example.com/feedback"
            required
            maxLength={2048}
            onChange={(event) => {
              setDraftUrl(event.target.value);
              draftRef.current = event.target.value;
              setEdited(true);
            }}
          />
        </Field>
        <div className="form-end">
          <ActionState action={a} />
          <button className="primary" disabled={!config.data || a.busy}>
            {a.busy ? "Saving…" : "Save webhook"}
          </button>
        </div>
      </form>
      <ErrorNotice error={config.error} />
      {secret && (
        <div>
          <Secret
            value={secret}
            label="Copy this signing secret now. It is only shown once."
          />
          <button type="button" onClick={() => setSecret(undefined)}>
            Hide secret
          </button>
        </div>
      )}
      {config.data?.configured && (
        <div>
          <p className="muted">
            Rotation takes effect immediately. Copy the new secret and update your
            receiver.
          </p>
          <div className="actions">
            <ConfirmButton
              disabled={a.busy}
              onConfirm={() =>
                void a.run(async () => {
                  const result = await api<{ secret: string }>("webhooks.rotate", {
                    projectId,
                  });
                  setSecret(result.secret);
                  setVersion((current) => current + 1);
                }, "Signing secret rotated.")
              }
            >
              Rotate secret
            </ConfirmButton>
            <ConfirmButton
              disabled={a.busy}
              onConfirm={() =>
                void a.run(async () => {
                  await api("webhooks.disable", { projectId });
                  config.setData({
                    configured: false,
                    url: null,
                    createdAt: null,
                    updatedAt: null,
                  });
                  setSecret(undefined);
                  setDraftUrl("");
                  draftRef.current = "";
                  setEdited(false);
                  setVersion((current) => current + 1);
                }, "Webhook disabled. Queued deliveries were removed.")
              }
            >
              Disable webhook
            </ConfirmButton>
          </div>
        </div>
      )}
      {failedCount > 0 && (
        <p className="error" role="status">
          {failedCount} recent {failedCount === 1 ? "delivery has" : "deliveries have"}{" "}
          failed. Open delivery history to see attempts and HTTP status.
        </p>
      )}
      <details className="section">
        <summary>Delivery history{failedCount ? ` · ${failedCount} failed` : ""}</summary>
        <p className="muted">Recent attempts update while this page is open.</p>
        <ErrorNotice error={deliveries.error} />
        {deliveries.data?.items.length ? (
          <ul className="webhook-deliveries">
            {deliveries.data.items.map((item) => (
              <li key={item.id}>
                <strong>
                  {item.status === "pending"
                    ? "Pending"
                    : item.status === "delivered"
                      ? "Delivered"
                      : "Failed"}
                </strong>
                <span>
                  <HumanTime at={item.deliveredAt ?? item.createdAt} />
                </span>
                <small>
                  {item.attempts} {item.attempts === 1 ? "attempt" : "attempts"}
                  {item.lastStatus ? ` · HTTP ${item.lastStatus}` : ""}
                </small>
                <code>{item.id}</code>
              </li>
            ))}
          </ul>
        ) : (
          deliveries.data && (
            <p>No deliveries yet. New thread activity will appear here.</p>
          )
        )}
      </details>
    </section>
  );
}
