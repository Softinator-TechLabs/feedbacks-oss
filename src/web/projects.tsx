import React, { useEffect, useRef, useState } from "react";
import { api, date, type Project, type Actor } from "./api.js";
import { GuestProjectLinks } from "./guest-project-review.js";
import {
  ActionState,
  ConfirmButton,
  ErrorNotice,
  Field,
  Empty,
  Secret,
  useAction,
  useLoad,
  ExternalLink,
} from "./ui.js";

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
                <span>{date(item.deliveredAt ?? item.createdAt)}</span>
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
export function ProjectEditor({
  project,
  canSetCaptureMode,
  onSaved,
}: {
  project?: Project;
  canSetCaptureMode: boolean;
  onSaved: (p: Project) => void;
}) {
  const a = useAction();
  const [latest, setLatest] = useState<Project>();
  const [captureMode, setCaptureMode] = useState<"origins" | "any">(
    project?.captureMode ?? "origins",
  );
  return (
    <form
      className="form-grid"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const input = {
          name: String(f.get("name")),
          captureMode,
          origins: String(f.get("origins"))
            .split(/\n/)
            .map((v) => v.trim())
            .filter(Boolean),
          ...(f.get("repositoryUrl")
            ? { repositoryUrl: String(f.get("repositoryUrl")) }
            : {}),
        };
        void a.run(
          async () =>
            onSaved(
              await api<Project>(
                project ? "projects.update" : "projects.create",
                project
                  ? {
                      ...input,
                      projectId: project.id,
                      revision: latest?.revision ?? project.revision,
                    }
                  : input,
              ),
            ),
          "Project saved.",
        );
      }}
    >
      <Field label="Project name">
        <input name="name" defaultValue={project?.name} required maxLength={120} />
      </Field>
      <Field label="Repository URL" hint="Optional">
        <input
          name="repositoryUrl"
          type="url"
          defaultValue={project?.repositoryUrl ?? ""}
        />
      </Field>
      <label className="check wide">
        <input
          name="captureMode"
          type="checkbox"
          value="any"
          checked={captureMode === "any"}
          onChange={(event) => setCaptureMode(event.target.checked ? "any" : "origins")}
          disabled={!canSetCaptureMode}
        />
        Any website
      </label>
      <p className="muted wide">
        Allow feedback from any HTTP(S) website. Only an owner can change this setting.
      </p>
      <Field
        label="Approved origins"
        hint="One origin per line, including https:// or http://. No paths or trailing slashes. Add localhost explicitly."
      >
        <textarea
          name="origins"
          defaultValue={project?.origins.join("\n")}
          placeholder="https://example.org"
          required={captureMode === "origins"}
          rows={3}
        />
      </Field>
      <div className="form-end">
        <ActionState action={a} />
        {project && a.error.includes("CONFLICT") && (
          <button
            type="button"
            onClick={() =>
              a.run(
                async () =>
                  setLatest(
                    await api<Project>("projects.get", {
                      projectId: project.id,
                    }),
                  ),
                "Latest settings loaded below. Compare them with your preserved draft before saving.",
              )
            }
          >
            Load latest settings for review
          </button>
        )}
        {latest && (
          <div className="section">
            <h3>Latest saved settings · revision {latest.revision}</h3>
            <p>{latest.name}</p>
            <p>{latest.captureMode === "any" ? "Any website" : "Approved origins"}</p>
            <p>{latest.origins.join(", ")}</p>
            <p>{latest.repositoryUrl}</p>
          </div>
        )}
        <button className="primary" disabled={a.busy}>
          {a.busy ? "Saving…" : project ? "Save project" : "Create project"}
        </button>
      </div>
    </form>
  );
}
export function Projects({
  projects,
  actor,
  onSaved,
}: {
  projects: Project[];
  actor: Actor;
  onSaved: (p: Project) => void;
}) {
  const [creating, setCreating] = useState(false);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Projects</h1>
          <p>Feedback, context and decisions in one place.</p>
        </div>
        {actor.owner && (
          <button className="primary" onClick={() => setCreating(!creating)}>
            {creating ? "Close form" : "New project"}
          </button>
        )}
      </div>
      {creating && (
        <section className="section">
          <h2>Create project</h2>
          <ProjectEditor
            canSetCaptureMode={actor.owner === true}
            onSaved={(p) => {
              setCreating(false);
              onSaved(p);
            }}
          />
        </section>
      )}
      {projects.length ? (
        <div className="project-list">
          {projects.map((p) => (
            <a className="project-row" key={p.id} href={`/projects/${p.id}`}>
              <div>
                <h2>{p.name}</h2>
                <p>{p.origins.join(" · ")}</p>
                {p.captureMode === "any" && <p>Any website</p>}
              </div>
              <span>{p.permissions.role}</span>
              <span aria-hidden="true">→</span>
            </a>
          ))}
        </div>
      ) : (
        <Empty title="No projects yet">
          {actor.owner
            ? "Create a project and add the origins your team will review."
            : "Your owner can give you access to a project. Refresh after access is granted."}
        </Empty>
      )}
    </>
  );
}
export function ProjectSettings({
  project,
  actor,
  onSaved,
}: {
  project: Project;
  actor: Actor;
  onSaved: (p: Project) => void;
}) {
  return (
    <>
      <h1>Project settings</h1>
      {project.permissions.canMaintain ? (
        <ProjectEditor
          key={project.revision}
          project={project}
          canSetCaptureMode={actor.owner === true}
          onSaved={onSaved}
        />
      ) : (
        <p>You can review this project’s origins. A maintainer can update them.</p>
      )}
      <section className="section">
        <h2>{project.captureMode === "any" ? "Website access" : "Approved origins"}</h2>
        {project.captureMode === "any" ? (
          <p>Feedback can be captured from any HTTP(S) website.</p>
        ) : (
          <ul>
            {project.origins.map((o) => (
              <li key={o}>
                <ExternalLink href={o}>{o}</ExternalLink>
              </li>
            ))}
          </ul>
        )}
      </section>
      {project.permissions.canMaintain && <WebhookSettings projectId={project.id} />}
      {project.permissions.canMaintain && <GuestProjectLinks projectId={project.id} />}
    </>
  );
}
