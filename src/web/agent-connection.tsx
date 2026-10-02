import React, { useState } from "react";
import { agentConnection, type Project } from "./api.js";
import { ActionState, ErrorNotice, Loading, useAction, useLoad } from "./ui.js";
import "./agent-connection.css";

type RequestDetails = {
  clientName: string;
  redirectUri: string;
  resource: string;
  requestedScopes: string[];
};
export function AgentConnection({
  requestId,
  projects,
  name,
}: {
  requestId: string;
  projects: Project[];
  name: string;
}) {
  const details = useLoad(() => agentConnection<RequestDetails>(requestId), [requestId]),
    action = useAction();
  const [chosen, setChosen] = useState<string[]>([]),
    [reply, setReply] = useState(false),
    [answered, setAnswered] = useState<{ redirect: string; approved: boolean }>();
  const decide = (approve: boolean) =>
    action.run(async () => {
      const result = await agentConnection<{ redirect: string }>(requestId, {
        approve,
        projectIds: chosen,
        reply,
      });
      setAnswered({ redirect: result.redirect, approved: approve });
      location.assign(result.redirect);
    });
  return (
    <main className="auth agent-connection">
      <a className="brand" href="/">
        Feedbacks
        <span className="brand-dot" />
      </a>
      <h1>Connect your agent</h1>
      <p className="muted">Signed in as {name}</p>
      <ErrorNotice error={details.error} />
      {answered && (
        <section>
          <p>{answered.approved ? "Connection approved." : "Connection declined."}</p>
          <a className="button primary" href={answered.redirect}>
            Return to agent
          </a>
          <p className="muted">
            If your client asks for a callback URL, copy this link address into its
            prompt.
          </p>
        </section>
      )}
      {!answered && !details.data && !details.error && <Loading />}
      {!answered && details.data && (
        <>
          <div className="connection-destination">
            <strong>{details.data.clientName}</strong>
            <p>Client-provided name · callback</p>
            <code>{details.data.redirectUri}</code>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void decide(true);
            }}
          >
            <fieldset>
              <legend>Choose projects</legend>
              {projects.map((project) => (
                <label className="connection-choice" key={project.id}>
                  <input
                    type="checkbox"
                    checked={chosen.includes(project.id)}
                    onChange={(e) =>
                      setChosen(
                        e.target.checked
                          ? [...chosen, project.id]
                          : chosen.filter((id) => id !== project.id),
                      )
                    }
                  />
                  <span>{project.name}</span>
                </label>
              ))}
              {!projects.length && (
                <p>You need project access before connecting. Ask your team owner.</p>
              )}
            </fieldset>
            <fieldset>
              <legend>Access</legend>
              <p>Read feedback, marked screenshots, recordings and project context.</p>
              {details.data.requestedScopes.includes("feedbacks:reply") && (
                <label className="connection-choice">
                  <input
                    type="checkbox"
                    checked={reply}
                    onChange={(e) => setReply(e.target.checked)}
                  />
                  <span>Allow replies to feedback</span>
                </label>
              )}
              {details.data.requestedScopes.includes("offline_access") && (
                <p className="muted">
                  Stay connected for up to 90 days. Revoke access in Account.
                </p>
              )}
            </fieldset>
            <ActionState action={action} />
            <div className="connection-actions">
              <button className="primary" disabled={action.busy || !chosen.length}>
                {action.busy ? "Connecting…" : "Connect"}
              </button>
              <button
                type="button"
                disabled={action.busy}
                onClick={() => void decide(false)}
              >
                Decline
              </button>
            </div>
          </form>
        </>
      )}
      <footer>
        <a href="/account">Account</a>
        <a href="/privacy">Privacy</a>
      </footer>
    </main>
  );
}
