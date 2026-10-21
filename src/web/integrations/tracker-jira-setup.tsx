import React, { useEffect, useRef, useState } from "react";
import { api, ApiError, errorText } from "../api.js";
import { ErrorNotice, Field, showToast } from "../ui.js";
import { useUnsavedChanges } from "../navigation.js";
import { useTrackerWrite } from "./retry-key.js";
import type {
  TrackerConfiguration,
  TrackerDiscoveryResult,
  TrackerProvider,
} from "../../shared/contracts/domains/trackers.js";

type Flow = { flowId: string; authorizeUrl: string; expiresAt: string };
type Selection = { targetId?: string; issueTypeId?: string };
type Site = { id: string; name: string; url: string };
type Frame =
  | { kind: "sites"; resources: Site[]; choice: string }
  | {
      kind: "destination";
      cloudId: string;
      siteName: string;
      selection: Selection;
      discovery: TrackerDiscoveryResult;
      choice: string;
    };
type Discovery = {
  status: "pending" | "choose_site" | "choose_destination";
  resources?: Site[];
  discovery?: TrackerDiscoveryResult;
};
const selectionFrom = (value: Selection): Selection => ({
  ...(value.targetId ? { targetId: value.targetId } : {}),
  ...(value.issueTypeId ? { issueTypeId: value.issueTypeId } : {}),
});

/** Consent and credentials stay with the broker; the browser chooses only named destinations. */
export function JiraTrackerConnection({
  projectId,
  embedded = false,
  names,
  onProviderChange,
  onManual,
  onSaved,
  onCancel,
}: {
  projectId: string;
  embedded?: boolean;
  names: Record<TrackerProvider, string>;
  onProviderChange: (provider: TrackerProvider) => void;
  onManual: () => void;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const Heading = embedded ? "h3" : "h2";
  const write = useTrackerWrite();
  const [flow, setFlow] = useState<Flow>(),
    [frame, setFrame] = useState<Frame>(),
    [history, setHistory] = useState<Frame[]>([]),
    [label, setLabel] = useState(""),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [expired, setExpired] = useState(false);
  const alive = useRef(true),
    request = useRef(0),
    providerControl = useRef<HTMLSelectElement>(null),
    destination = useRef<HTMLSelectElement>(null),
    ready = useRef<HTMLParagraphElement>(null),
    labels = useRef(new Map<string, string>());
  const isReady = frame?.kind === "destination" && !!frame.discovery.configuration;
  useUnsavedChanges(dirty || busy);
  useEffect(() => {
    alive.current = true;
    const control = providerControl.current;
    if (control?.getClientRects().length) control.focus();
    return () => {
      alive.current = false;
      request.current++;
    };
  }, []);
  useEffect(() => {
    const control = isReady ? ready.current : destination.current;
    if (control?.getClientRects().length) control.focus();
  }, [frame, isReady]);
  const mayReplace = () =>
    !dirty ||
    window.confirm(
      "Discard this tracker connection draft? Your unsaved changes will be lost.",
    );
  const draftKey = (configuration: TrackerConfiguration) =>
    JSON.stringify({ ...configuration, states: [], poll: false });

  async function run(work: () => Promise<void>) {
    const current = ++request.current;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (reason) {
      if (!alive.current || request.current !== current) return;
      setError(errorText(reason));
      if (reason instanceof ApiError && reason.code === "TRACKER_OAUTH_EXPIRED")
        setExpired(true);
    } finally {
      if (alive.current && request.current === current) setBusy(false);
    }
  }
  async function start() {
    setDirty(false);
    setFlow(undefined);
    setFrame(undefined);
    setHistory([]);
    setLabel("");
    setExpired(false);
    labels.current.clear();
    await run(async () => {
      const current = request.current;
      const result = await api<Flow>("trackers.oauthStart", {
        projectId,
        provider: "jira",
        guided: true,
      });
      if (alive.current && request.current === current) {
        setFlow(result);
        setDirty(true);
      }
    });
  }
  async function discover(cloudId?: string, selection: Selection = {}, append = false) {
    if (!flow) return;
    await run(async () => {
      const current = request.current;
      const result = await api<Discovery>("trackers.oauthDiscover", {
        flowId: flow.flowId,
        ...(cloudId ? { cloudId } : {}),
        selection: selectionFrom(selection),
        ...(append && frame?.kind === "destination" && frame.discovery.nextCursor
          ? { cursor: frame.discovery.nextCursor }
          : {}),
      });
      if (!alive.current || request.current !== current) return;
      if (result.status === "pending") {
        setNotice("Finish authorization, then check again.");
        return;
      }
      if (result.status === "choose_site") {
        setFrame({ kind: "sites", resources: result.resources ?? [], choice: "" });
        return;
      }
      if (!cloudId || !result.discovery)
        throw new Error("Jira did not return a destination. Check the connection again.");
      const siteName =
        frame?.kind === "sites"
          ? (frame.resources.find((site) => site.id === cloudId)?.name ?? "Jira Cloud")
          : (frame?.siteName ?? "Jira Cloud");
      if (append && frame?.kind === "destination") {
        const seen = new Set(frame.discovery.choices.map((choice) => choice.id));
        setFrame({
          ...frame,
          discovery: {
            ...result.discovery,
            choices: [
              ...frame.discovery.choices,
              ...result.discovery.choices.filter((choice) => !seen.has(choice.id)),
            ],
          },
        });
      } else {
        if (frame) setHistory((previous) => [...previous, frame]);
        setFrame({
          kind: "destination",
          cloudId,
          siteName,
          selection: selectionFrom(selection),
          discovery: result.discovery,
          choice: "",
        });
      }
      if (result.discovery.configuration)
        setLabel(labels.current.get(draftKey(result.discovery.configuration)) ?? "");
    });
  }
  async function complete() {
    if (!flow || frame?.kind !== "destination" || !frame.discovery.configuration) return;
    await run(async () => {
      const current = request.current;
      const result = await write("trackers.oauthComplete", {
        flowId: flow.flowId,
        cloudId: frame.cloudId,
        configuration: frame.discovery.configuration,
        ...(label.trim() ? { label: label.trim() } : {}),
      });
      if (!alive.current || request.current !== current) return;
      if (result.status !== "connected")
        throw new Error("Authorization is not ready. Check the connection status again.");
      setDirty(false);
      setFlow(undefined);
      showToast("Jira Cloud connected.");
      onSaved();
    });
  }
  function back() {
    request.current++;
    if (frame?.kind === "destination" && frame.discovery.configuration)
      labels.current.set(draftKey(frame.discovery.configuration), label);
    setError("");
    setNotice("");
    setFrame(history.at(-1));
    setHistory((previous) => previous.slice(0, -1));
  }
  function next() {
    if (busy || expired) return;
    if (!flow) void start();
    else if (!frame) void discover();
    else if (isReady) void complete();
    else if (frame.kind === "sites" && frame.choice) void discover(frame.choice);
    else if (frame.kind === "destination") {
      const selected = frame.discovery.choices.find(
        (choice) => choice.id === frame.choice,
      );
      if (selected)
        void discover(frame.cloudId, {
          ...frame.selection,
          ...selectionFrom(selected.selection),
        });
    }
  }
  return (
    <form
      className="tracker-form tracker-setup tracker-jira-setup"
      data-unsaved={dirty || busy ? "true" : undefined}
      aria-busy={busy}
      onChange={() => setDirty(true)}
      onSubmit={(event) => {
        event.preventDefault();
        next();
      }}
    >
      <Heading>Connect Jira Cloud</Heading>
      <ol className="tracker-setup-steps" aria-label="Connection setup">
        <li aria-current={!frame ? "step" : undefined}>Account</li>
        <li aria-current={frame && !isReady ? "step" : undefined}>Destination</li>
        <li aria-current={isReady ? "step" : undefined}>Connect</li>
      </ol>
      <Field label="Provider">
        <select
          ref={providerControl}
          value="jira"
          disabled={busy}
          onChange={(event) =>
            mayReplace() && onProviderChange(event.target.value as TrackerProvider)
          }
        >
          {Object.entries(names).map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </Field>
      {flow && !frame && !expired && (
        <p>
          <a
            className="button primary"
            href={flow.authorizeUrl}
            target="_blank"
            rel="noreferrer"
            aria-disabled={busy}
            tabIndex={busy ? -1 : undefined}
            onClick={(event) => {
              if (busy) event.preventDefault();
            }}
          >
            Authorize Jira Cloud
          </a>
        </p>
      )}
      {frame?.kind === "sites" && (
        <Field label="Jira site">
          <select
            ref={destination}
            value={frame.choice}
            required
            disabled={busy || expired}
            onChange={(event) => setFrame({ ...frame, choice: event.target.value })}
          >
            <option value="">Choose a site</option>
            {frame.resources.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name} · {new URL(site.url).hostname}
              </option>
            ))}
          </select>
          {!frame.resources.length && (
            <small>No Jira sites were authorized. Start again and choose a site.</small>
          )}
        </Field>
      )}
      {frame?.kind === "destination" &&
        (isReady ? (
          <>
            <p className="tracker-setup-ready" ref={ready} tabIndex={-1}>
              <span>
                {[
                  frame.siteName,
                  ...history.flatMap((item) =>
                    item.kind === "destination"
                      ? [
                          item.discovery.choices.find(
                            (choice) => choice.id === item.choice,
                          )?.name,
                        ]
                      : [],
                  ),
                ]
                  .filter((name) => name && name !== frame.discovery.targetName)
                  .join(" / ")}
              </span>
              <strong>{frame.discovery.targetName}</strong>
            </p>
            <details className="tracker-setup-advanced">
              <summary>Advanced options</summary>
              <Field label="Connection name (optional)">
                <input
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  placeholder={`Jira Cloud · ${frame.discovery.targetName ?? "Tasks"}`}
                  maxLength={100}
                  disabled={busy || expired}
                />
              </Field>
            </details>
          </>
        ) : (
          <>
            <Field label={frame.discovery.title}>
              <select
                ref={destination}
                value={frame.choice}
                required
                disabled={busy || expired || !frame.discovery.choices.length}
                onChange={(event) => setFrame({ ...frame, choice: event.target.value })}
              >
                <option value="">Choose {frame.discovery.title.toLowerCase()}</option>
                {frame.discovery.choices.map((choice) => (
                  <option key={choice.id} value={choice.id}>
                    {choice.name}
                  </option>
                ))}
              </select>
              {!frame.discovery.choices.length && (
                <small>
                  No destinations found. Check this account's access or go back.
                </small>
              )}
            </Field>
            {frame.discovery.hasMore && frame.discovery.nextCursor && (
              <button
                type="button"
                disabled={busy || expired}
                onClick={() => void discover(frame.cloudId, frame.selection, true)}
              >
                Load more
              </button>
            )}
          </>
        ))}
      <ErrorNotice error={error} />
      {notice && <p role="status">{notice}</p>}
      <div className="tracker-actions">
        {expired || (frame?.kind === "sites" && !frame.resources.length) ? (
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => void start()}
          >
            Start again
          </button>
        ) : (
          <button
            type="submit"
            className={flow && !frame ? undefined : "primary"}
            disabled={busy || (!!frame && !isReady && !frame.choice)}
          >
            {busy
              ? "Please wait…"
              : !flow
                ? "Connect with Jira Cloud"
                : !frame
                  ? "Check connection status"
                  : isReady
                    ? "Connect"
                    : "Continue"}
          </button>
        )}
        {frame && !expired && (
          <button type="button" disabled={busy} onClick={back}>
            Back
          </button>
        )}
        <button type="button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
      <button
        type="button"
        className="tracker-advanced-switch"
        disabled={busy}
        onClick={() => mayReplace() && onManual()}
      >
        Advanced setup
      </button>
    </form>
  );
}
