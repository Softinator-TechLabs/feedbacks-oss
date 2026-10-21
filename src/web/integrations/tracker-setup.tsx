import React, { useEffect, useRef, useState } from "react";
import { api, errorText } from "../api.js";
import { ErrorNotice, Field, Loading, showToast } from "../ui.js";
import { useUnsavedChanges } from "../navigation.js";
import { useTrackerWrite } from "./retry-key.js";
import {
  trackerStates,
  type TrackerConfiguration,
  type TrackerCredential,
  type TrackerDiscoveryResult,
  type TrackerDiscoverySelection,
  type TrackerProvider,
} from "../../shared/contracts/domains/trackers.js";

type Account = {
  connectionId: string;
  revision: number;
  label: string;
  projectName: string;
  selection?: TrackerDiscoverySelection;
};
type Frame = {
  selection: TrackerDiscoverySelection;
  result: TrackerDiscoveryResult;
  choice: string;
};
const help: Partial<Record<TrackerProvider, { url: string; text: string }>> = {
  clickup: {
    url: "https://developer.clickup.com/docs/authentication",
    text: "Settings → ClickUp API → API tokens → Create token.",
  },
  monday: {
    url: "https://support.monday.com/hc/en-us/articles/360005144659-Does-monday-com-have-an-API",
    text: "Profile → Developers → My access tokens.",
  },
  asana: {
    url: "https://app.asana.com/0/my-apps",
    text: "Create a personal access token in your Asana developer console.",
  },
  linear: {
    url: "https://linear.app/developers/graphql",
    text: "Create a personal API key in Security & access settings.",
  },
  trello: {
    url: "https://developer.atlassian.com/cloud/trello/guides/rest-api/api-introduction/",
    text: "Use your Trello API key and its delegated token.",
  },
  openproject: {
    url: "https://www.openproject.org/docs/user-guide/account-settings/access-tokens/",
    text: "My account → Access tokens → API.",
  },
  productive: {
    url: "https://developer.productive.io/reference",
    text: "Settings → API integrations. Copy the token and organization ID.",
  },
  teamwork: {
    url: "https://support.teamwork.com/projects/your-profile/locating-your-api-key",
    text: "Edit my details → API & Mobile → Show your token.",
  },
  firmao: {
    url: "https://github.com/FirmaoCRM/API",
    text: "Company → Settings → API. Use the generated API login and password.",
  },
};
const localName = (state: string) => {
  const text = state.replaceAll("_", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
};

export function GuidedTrackerConnection({
  projectId,
  provider,
  names,
  embedded = false,
  onProviderChange,
  onManual,
  onSaved,
  onCancel,
}: {
  projectId: string;
  provider: TrackerProvider;
  names: Record<TrackerProvider, string>;
  embedded?: boolean;
  onProviderChange: (provider: TrackerProvider) => void;
  onManual: () => void;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const Heading = embedded ? "h3" : "h2";
  const write = useTrackerWrite();
  const [accounts, setAccounts] = useState<Account[]>(),
    [accountsAttempt, setAccountsAttempt] = useState(0),
    [accountsError, setAccountsError] = useState(""),
    [accountId, setAccountId] = useState(""),
    [token, setToken] = useState(""),
    [apiKey, setApiKey] = useState(""),
    [username, setUsername] = useState(""),
    [base, setBase] = useState<TrackerDiscoverySelection>({}),
    [frame, setFrame] = useState<Frame>(),
    [history, setHistory] = useState<Frame[]>([]),
    [configuration, setConfiguration] = useState<TrackerConfiguration>(),
    [label, setLabel] = useState(""),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const active = useRef(true),
    request = useRef(0),
    readyDrafts = useRef(
      new Map<string, { configuration: TrackerConfiguration; label: string }>(),
    ),
    providerControl = useRef<HTMLSelectElement>(null),
    destination = useRef<HTMLSelectElement>(null),
    ready = useRef<HTMLParagraphElement>(null);
  useUnsavedChanges(dirty || busy);
  useEffect(() => {
    const control = providerControl.current;
    if (control?.getClientRects().length) control.focus();
  }, []);
  useEffect(() => {
    active.current = true;
    let alive = true;
    api<{ accounts: Account[] }>("trackers.accounts", { projectId, provider }).then(
      ({ accounts: options }) => {
        if (!alive) return;
        setAccounts(options);
        setAccountId(accountsAttempt ? "" : (options[0]?.connectionId ?? ""));
        setAccountsError("");
      },
      (reason) => {
        if (!alive) return;
        setAccounts([]);
        setAccountsError(errorText(reason));
      },
    );
    return () => {
      alive = false;
      active.current = false;
      request.current++;
    };
  }, [projectId, provider, accountsAttempt]);
  useEffect(() => {
    const control = frame?.result.configuration ? ready.current : destination.current;
    if (control?.getClientRects().length) control.focus();
  }, [frame?.result]);

  const account = accounts?.find((item) => item.connectionId === accountId);
  const credential = (): TrackerCredential => ({
    token: token.trim(),
    auth: provider === "firmao" ? "basic" : "token",
    ...(apiKey.trim() ? { key: apiKey.trim() } : {}),
    ...(username.trim() ? { username: username.trim() } : {}),
  });
  const mayReplace = () =>
    !dirty ||
    window.confirm(
      "Discard this tracker connection draft? Your unsaved changes will be lost.",
    );
  const setBaseValue = (key: keyof TrackerDiscoverySelection, value: string) =>
    setBase((previous) => ({ ...previous, [key]: value }));
  const destinationKey = (value: TrackerConfiguration) =>
    JSON.stringify({ ...value, states: [], poll: false });

  async function discover(selection: TrackerDiscoverySelection, append = false) {
    const currentRequest = ++request.current;
    setBusy(true);
    setError("");
    try {
      const result = await api<TrackerDiscoveryResult>("trackers.discover", {
        projectId,
        provider,
        ...(account
          ? { sourceConnectionId: account.connectionId, sourceRevision: account.revision }
          : { credential: credential() }),
        selection,
        ...(append && frame?.result.nextCursor
          ? { cursor: frame.result.nextCursor }
          : {}),
      });
      if (!active.current || currentRequest !== request.current) return;
      if (append && frame) {
        const seen = new Set(frame.result.choices.map((choice) => choice.id));
        setFrame({
          ...frame,
          result: {
            ...result,
            choices: [
              ...frame.result.choices,
              ...result.choices.filter((choice) => !seen.has(choice.id)),
            ],
          },
        });
      } else {
        if (frame) setHistory((previous) => [...previous, frame]);
        setFrame({ selection, result, choice: "" });
      }
      if (result.configuration) {
        const draft = readyDrafts.current.get(destinationKey(result.configuration));
        setConfiguration(draft?.configuration ?? result.configuration);
        setLabel(
          draft?.label ??
            `${names[provider]} · ${result.targetName ?? "Tasks"}`.slice(0, 100),
        );
      }
    } catch (reason) {
      if (active.current && currentRequest === request.current)
        setError(errorText(reason));
    } finally {
      if (active.current && currentRequest === request.current) setBusy(false);
    }
  }

  async function save() {
    if (!configuration) return;
    const currentRequest = ++request.current;
    setBusy(true);
    setError("");
    try {
      await write("trackers.save", {
        projectId,
        provider,
        label:
          label.trim() ||
          `${names[provider]} · ${frame?.result.targetName ?? "Tasks"}`.slice(0, 100),
        configuration,
        verifyDestination: true,
        ...(account
          ? { reuseConnectionId: account.connectionId, reuseRevision: account.revision }
          : { credential: credential() }),
      });
      if (!active.current || currentRequest !== request.current) return;
      setToken("");
      setApiKey("");
      setUsername("");
      setDirty(false);
      showToast("Connection saved.");
      onSaved();
    } catch (reason) {
      if (active.current && currentRequest === request.current)
        setError(errorText(reason));
    } finally {
      if (active.current && currentRequest === request.current) setBusy(false);
    }
  }

  function back() {
    request.current++;
    if (configuration)
      readyDrafts.current.set(destinationKey(configuration), { configuration, label });
    setError("");
    setConfiguration(undefined);
    setFrame(history.at(-1));
    setHistory((previous) => previous.slice(0, -1));
  }
  const selected = frame?.result.choices.find((choice) => choice.id === frame.choice);
  const isReady = !!frame?.result.configuration;
  return (
    <form
      className="tracker-form tracker-setup"
      data-unsaved={dirty || busy ? "true" : undefined}
      aria-busy={busy}
      onChange={() => setDirty(true)}
      onSubmit={(event) => {
        event.preventDefault();
        if (busy || !accounts) return;
        if (isReady) void save();
        else if (!frame) void discover({ ...account?.selection, ...base });
        else if (selected) void discover({ ...frame.selection, ...selected.selection });
      }}
    >
      <Heading>Connect {names[provider]}</Heading>
      <ol className="tracker-setup-steps" aria-label="Connection setup">
        <li aria-current={!frame ? "step" : undefined}>Account</li>
        <li aria-current={frame && !isReady ? "step" : undefined}>Destination</li>
        <li aria-current={isReady ? "step" : undefined}>Connect</li>
      </ol>
      <Field label="Provider">
        <select
          ref={providerControl}
          value={provider}
          disabled={busy}
          onChange={(event) => {
            if (mayReplace()) onProviderChange(event.target.value as TrackerProvider);
          }}
        >
          {Object.entries(names).map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </Field>
      {!accounts ? (
        <Loading />
      ) : !frame ? (
        <>
          <ErrorNotice error={accountsError} />
          {accountsError && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setAccounts(undefined);
                setAccountsAttempt((attempt) => attempt + 1);
              }}
            >
              Retry saved accounts
            </button>
          )}
          {!!accounts.length && (
            <Field label="Account">
              <select
                value={accountId}
                disabled={busy}
                onChange={(event) => {
                  setAccountId(event.target.value);
                  setToken("");
                  setApiKey("");
                  setUsername("");
                  setBase({});
                  setFrame(undefined);
                  setHistory([]);
                  setConfiguration(undefined);
                  setLabel("");
                  setError("");
                  readyDrafts.current.clear();
                }}
              >
                {accounts.map((item) => (
                  <option key={item.connectionId} value={item.connectionId}>
                    {item.label} · {item.projectName}
                  </option>
                ))}
                <option value="">Connect another account</option>
              </select>
            </Field>
          )}
          {!account && provider === "jira" ? (
            <p>Jira Cloud uses your server's OAuth setup.</p>
          ) : (
            !account && (
              <>
                {provider === "firmao" && (
                  <Field label="Firmao API login">
                    <input
                      name="username"
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      required
                      disabled={busy}
                      maxLength={254}
                      autoComplete="off"
                    />
                  </Field>
                )}
                <Field
                  label={provider === "firmao" ? "Firmao API password" : "API token"}
                >
                  <input
                    name="token"
                    type="password"
                    autoComplete="new-password"
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                    disabled={busy}
                    required
                    minLength={5}
                    maxLength={16000}
                  />
                </Field>
                {provider === "trello" && (
                  <Field label="Trello API key">
                    <input
                      name="key"
                      type="password"
                      autoComplete="new-password"
                      value={apiKey}
                      onChange={(event) => setApiKey(event.target.value)}
                      required
                      disabled={busy}
                      maxLength={1000}
                    />
                  </Field>
                )}
                <details className="tracker-token-help">
                  <summary>Where do I find my token?</summary>
                  {help[provider] ? (
                    <p>
                      {help[provider].text}{" "}
                      <a href={help[provider].url} target="_blank" rel="noreferrer">
                        Open {names[provider]} token help
                      </a>
                    </p>
                  ) : (
                    <p>
                      Use the API credentials from your {names[provider]} account
                      settings.
                    </p>
                  )}
                  <p>Connect once, then reuse this account for your other projects.</p>
                </details>
              </>
            )
          )}
          {provider === "openproject" && !account?.selection?.instanceOrigin && (
            <Field label="OpenProject instance URL">
              <input
                name="instanceOrigin"
                type="url"
                placeholder="https://projects.example.com"
                value={base.instanceOrigin ?? ""}
                onChange={(event) => setBaseValue("instanceOrigin", event.target.value)}
                required
                disabled={busy}
                maxLength={500}
                autoComplete="off"
              />
            </Field>
          )}
          {provider === "teamwork" && !account?.selection?.site && (
            <Field label="Teamwork site name" hint="The part before .teamwork.com">
              <input
                name="site"
                value={base.site ?? ""}
                onChange={(event) => setBaseValue("site", event.target.value)}
                required
                disabled={busy}
                maxLength={63}
                autoComplete="off"
              />
            </Field>
          )}
          {["firmao", "productive"].includes(provider) &&
            !account?.selection?.workspaceId && (
              <Field
                label={
                  provider === "firmao"
                    ? "Firmao organization identifier"
                    : "Productive organization ID"
                }
              >
                <input
                  name="workspaceId"
                  value={base.workspaceId ?? ""}
                  onChange={(event) => setBaseValue("workspaceId", event.target.value)}
                  required
                  disabled={busy}
                  maxLength={100}
                  autoComplete="off"
                />
              </Field>
            )}
        </>
      ) : isReady ? (
        <>
          <p className="tracker-setup-ready" ref={ready} tabIndex={-1}>
            <span>
              {history
                .map(
                  (item) =>
                    item.result.choices.find((choice) => choice.id === item.choice)?.name,
                )
                .filter((name) => name && name !== frame.result.targetName)
                .join(" / ") || "Destination"}
            </span>
            <strong>{frame.result.targetName}</strong>
          </p>
          <details className="tracker-setup-advanced">
            <summary>Advanced options</summary>
            <Field label="Connection name">
              <input
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                maxLength={100}
                disabled={busy}
              />
            </Field>
            {!!configuration && !!frame.result.states.length && (
              <>
                <p className="muted">Optional status sync</p>
                <div className="tracker-mappings">
                  {trackerStates.map((local) => (
                    <Field key={local} label={localName(local)}>
                      <select
                        value={
                          configuration.states.find((item) => item.local === local)
                            ?.remote ?? ""
                        }
                        disabled={busy}
                        onChange={(event) => {
                          const states = configuration.states.filter(
                            (item) => item.local !== local,
                          );
                          if (event.target.value)
                            states.push({ local, remote: event.target.value });
                          setConfiguration({
                            ...configuration,
                            states,
                            poll: states.length ? configuration.poll : false,
                          });
                        }}
                      >
                        <option value="">Do not sync</option>
                        {frame.result.states.map((state) => (
                          <option
                            key={state.id}
                            value={state.id}
                            disabled={configuration.states.some(
                              (item) => item.local !== local && item.remote === state.id,
                            )}
                          >
                            {state.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                  ))}
                </div>
                <label>
                  <input
                    type="checkbox"
                    checked={configuration.poll}
                    onChange={(event) =>
                      setConfiguration({ ...configuration, poll: event.target.checked })
                    }
                    disabled={busy || !configuration.states.length}
                  />{" "}
                  Import remote status changes automatically
                </label>
              </>
            )}
          </details>
        </>
      ) : (
        <>
          <Field label={frame.result.title}>
            <select
              ref={destination}
              value={frame.choice}
              onChange={(event) => setFrame({ ...frame, choice: event.target.value })}
              required
              disabled={busy || !frame.result.choices.length}
            >
              <option value="">Choose {frame.result.title.toLowerCase()}</option>
              {frame.result.choices.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.name}
                </option>
              ))}
            </select>
          </Field>
          {!frame.result.choices.length && (
            <p className="muted">
              No destinations found. Check this account's access or go back.
            </p>
          )}
          {frame.result.hasMore &&
            (frame.result.nextCursor ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void discover(frame.selection, true)}
              >
                Load more
              </button>
            ) : (
              <p className="muted">
                Showing the first available destinations. Use advanced setup for another
                destination.
              </p>
            ))}
        </>
      )}
      <ErrorNotice error={error} />
      <div className="tracker-actions">
        {!frame && provider === "jira" && !account ? (
          <button
            type="button"
            className="primary"
            disabled={busy || !accounts}
            onClick={() => mayReplace() && onManual()}
          >
            Connect with Jira Cloud
          </button>
        ) : (
          <button
            type="submit"
            className="primary"
            disabled={busy || !accounts || (!!frame && !isReady && !selected)}
          >
            {busy ? "Please wait…" : isReady ? "Connect" : "Continue"}
          </button>
        )}
        {!!frame && (
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
