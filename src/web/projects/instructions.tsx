import React, { useState } from "react";
import { api, type Actor, type Project } from "../api.js";
import { HumanTime } from "../human-time.js";
import {
  ActionState,
  Empty,
  ErrorNotice,
  Field,
  Loading,
  useAction,
  useLoad,
} from "../ui.js";

export function Instructions({ project }: { project: Project }) {
  const [refreshVersion, setRefreshVersion] = useState(0),
    { data, setData, error } = useLoad(
      () =>
        api<{
          revision: number;
          items: Array<{
            id: string;
            version: number;
            body: string;
            actor: Actor;
            createdAt: string;
          }>;
        }>("instructions.get", { projectId: project.id }),
      [project.id, refreshVersion],
    ),
    a = useAction(),
    [body, setBody] = useState("");
  return (
    <>
      <div className="page-heading">
        <h1>Context for Coding Agent</h1>
        <button type="button" onClick={() => setRefreshVersion((v) => v + 1)}>
          Refresh
        </button>
      </div>
      <p>
        Describe this project, its codebase and the rules your coding agent should follow.
        A maintainer publishes each version. Feedback comments do not change this context.
      </p>
      <details className="instruction-example compact-details">
        <summary>See an example</summary>
        <p>
          <strong>Example only, not active instructions:</strong> Reproduce layout
          feedback at the recorded screen size. Ask for missing steps before closing a
          report. Link the fix or GitHub issue in the discussion. Do not treat a comment
          as a policy change.
        </p>
      </details>
      <ErrorNotice error={error} />
      {!data && !error ? (
        <Loading />
      ) : (
        <>
          {project.permissions.canMaintain && data && (
            <form
              className="section"
              onSubmit={(e) => {
                e.preventDefault();
                void a.run(async () => {
                  setData(
                    await api("instructions.publish", {
                      projectId: project.id,
                      revision: data.revision,
                      body,
                    }),
                  );
                  setBody((current) => (current === body ? "" : current));
                }, "Instruction version published.");
              }}
            >
              <Field label="Context for Coding Agent">
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  required
                  maxLength={12000}
                  rows={6}
                />
              </Field>
              <button className="primary" disabled={a.busy || !body.trim()}>
                Publish context
              </button>
              <ActionState action={a} />
            </form>
          )}
          {data?.items.length
            ? data.items.map((item, n) => (
                <article className="instruction section" key={item.id}>
                  <div className="meta">
                    <h2>
                      Version {item.version}
                      {n === 0 ? " · Current" : ""}
                    </h2>
                    <span>
                      {item.actor.name} · <HumanTime at={item.createdAt} />
                    </span>
                  </div>
                  <p className="message">{item.body}</p>
                </article>
              ))
            : data && (
                <Empty title="No project context yet">
                  A project maintainer can publish the first version.
                </Empty>
              )}
        </>
      )}
    </>
  );
}
