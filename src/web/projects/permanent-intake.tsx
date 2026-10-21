import React, { useState } from "react";
import { api, type Project } from "../api.js";
import {
  ActionState,
  ErrorNotice,
  Field,
  Loading,
  Secret,
  useAction,
  useLoad,
} from "../ui.js";
import { useUnsavedChanges } from "../navigation.js";
import type { IntakeConfig } from "../../shared/contracts/domains/intake.js";
type Settings = {
  configured: boolean;
  id: string | null;
  revision: number;
  enabled: boolean;
  config: IntakeConfig | null;
  snippet: string | null;
};
export function PermanentIntake({ project }: { project: Project }) {
  const [version, setVersion] = useState(0),
    [draft, setDraft] = useState<Settings>();
  const { data, error } = useLoad(
    () => api<Settings>("intake.settings", { projectId: project.id }),
    [project.id, version],
  );
  const action = useAction();
  const [originsText, setOriginsText] = useState<string>();
  const current = draft ?? data;
  const config =
    current?.config ??
    ({
      origins: project.origins.slice(0, 20),
      label: "Send feedback",
      position: "right",
      color: "oxford",
      privacyText:
        "Your feedback and page address go to this website's team. Do not include passwords or other sensitive information.",
      privacyUrl: null,
      collectContact: false,
      dailyLimit: 100,
    } satisfies IntakeConfig);
  useUnsavedChanges(!!draft || action.busy);
  const patch = (change: Partial<IntakeConfig>) =>
    current && setDraft({ ...current, config: { ...config, ...change } });
  if (!current)
    return (
      <>
        <ErrorNotice error={error} />
        {!error && <Loading />}
      </>
    );
  return (
    <section className="section" aria-labelledby="permanent-intake-heading">
      <h2 id="permanent-intake-heading">Always-on website feedback</h2>
      <p className="muted">
        Keep a feedback button on approved websites until you disable it. Visitors can
        report a page or select an element; they cannot read your project. No screenshots,
        page text or form values are captured.
      </p>
      <ErrorNotice error={error} />
      <form
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          void action.run(async () => {
            const saved = await api<Settings>("intake.save", {
              projectId: project.id,
              revision: current.revision,
              enabled: current.enabled,
              config,
            });
            setDraft((latest) => (latest === current ? undefined : latest));
            setVersion((value) => value + 1);
            void saved;
          }, "Website feedback settings saved.");
        }}
      >
        <label className="checkbox">
          <input
            type="checkbox"
            checked={current.enabled}
            onChange={(event) =>
              setDraft({ ...current, config, enabled: event.target.checked })
            }
          />
          Enable permanent public intake
        </label>
        <Field
          label="Approved origins"
          hint="One exact origin per line. First approve these origins in Project settings; no wildcards."
        >
          <textarea
            rows={3}
            value={originsText ?? config.origins.join("\n")}
            onChange={(event) => {
              setOriginsText(event.target.value);
              patch({
                origins: event.target.value
                  .split("\n")
                  .map((value) => value.trim())
                  .filter(Boolean),
              });
            }}
          />
        </Field>
        <Field label="Button label">
          <input
            required
            maxLength={60}
            value={config.label}
            onChange={(event) => patch({ label: event.target.value })}
          />
        </Field>
        <Field label="Button position">
          <select
            value={config.position}
            onChange={(event) =>
              patch({ position: event.target.value as IntakeConfig["position"] })
            }
          >
            <option value="right">Bottom right</option>
            <option value="left">Bottom left</option>
          </select>
        </Field>
        <Field label="Button color">
          <select
            value={config.color}
            onChange={(event) =>
              patch({ color: event.target.value as IntakeConfig["color"] })
            }
          >
            <option value="oxford">Oxford blue</option>
            <option value="forest">Forest green</option>
            <option value="slate">Slate</option>
          </select>
        </Field>
        <Field label="Privacy notice">
          <textarea
            required
            rows={3}
            maxLength={500}
            value={config.privacyText}
            onChange={(event) => patch({ privacyText: event.target.value })}
          />
        </Field>
        <Field label="Privacy policy URL (optional)">
          <input
            type="url"
            maxLength={1000}
            placeholder="https://example.com/privacy"
            value={config.privacyUrl ?? ""}
            onChange={(event) => patch({ privacyUrl: event.target.value || null })}
          />
        </Field>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={config.collectContact}
            onChange={(event) => patch({ collectContact: event.target.checked })}
          />
          Offer optional email sharing, with the visitor's explicit consent
        </label>
        <Field
          label="Submission attempts per UTC day"
          hint="1–1,000. Failed verification and retries count. Also limited to 5 attempts per IP per 10 minutes and 20 per installation per minute."
        >
          <input
            type="number"
            min={1}
            max={1000}
            required
            value={config.dailyLimit}
            onChange={(event) => patch({ dailyLimit: Number(event.target.value) })}
          />
        </Field>
        <div className="form-end">
          <ActionState action={action} />
          <button className="primary" disabled={action.busy}>
            {action.busy ? "Saving…" : "Save website feedback"}
          </button>
        </div>
      </form>
      {data?.snippet && (
        <details className="section" open={data.enabled}>
          <summary>Installation snippet{!data.enabled && " · disabled"}</summary>
          <p>
            Install once in the website's shared HTML layout. This installation stays
            valid until disabled; its ID is public. Turnstile, exact-origin checks and
            durable rate limits protect submissions.
          </p>
          <Secret value={data.snippet} label="Copy website installation snippet" />
          <p className="muted">
            Removing the script hides the button. Disabling intake stops submissions on
            the server and preserves received feedback.
          </p>
        </details>
      )}
    </section>
  );
}
