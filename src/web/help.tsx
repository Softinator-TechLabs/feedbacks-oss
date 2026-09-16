import React, { useEffect, useState } from "react";
import { ownerTokenScopes } from "../shared/contracts.js";
import { agentSetupPrompt, type AgentIssuance } from "./agent-setup.js";
import { api, type Actor, type Project } from "./api.js";
import { ActionState, useAction, useLoad, Loading, ErrorNotice } from "./ui.js";

type HelpContent = {
  downloadHtml: string;
  moreHtml: string;
  instructions: string;
};

function HelpAgentSetup({
  actor,
  projects,
  instructions,
}: {
  actor?: Actor;
  projects: Project[];
  instructions: string;
}) {
  const action = useAction();
  const [issued, setIssued] = useState<AgentIssuance>();
  const [prompt, setPrompt] = useState("");
  const [showPrompt, setShowPrompt] = useState(false);

  if (!actor?.owner)
    return (
      <li>
        <h2>Copy agent setup</h2>
        <p>Ask an owner to create the private agent setup prompt for you.</p>
      </li>
    );

  async function copyAgentSetup() {
    let nextPrompt = prompt;
    if (!issued) {
      const result = await api<{
        id: string;
        token: string;
        name: string;
        expiresAt: string;
      }>("tokens.create", {
        name: "Internal agents",
        projectIds: projects.map((project) => project.id),
        scopes: [...ownerTokenScopes],
        ownerAdmin: true,
        expiresInDays: 90,
        canResolve: true,
      });
      const nextIssued: AgentIssuance = {
        ...result,
        origin: location.origin,
        projects: projects.map(({ id, name }) => ({ id, name })),
        scopes: [...ownerTokenScopes],
        ownerAdmin: true,
        canResolve: true,
      };
      nextPrompt = agentSetupPrompt(nextIssued, instructions);
      setIssued(nextIssued);
      setPrompt(nextPrompt);
    }
    try {
      await navigator.clipboard.writeText(nextPrompt);
      setShowPrompt(false);
    } catch {
      setShowPrompt(true);
      throw new Error(
        "The agent key was created, but clipboard access was denied. Select and copy the private prompt below, or retry without creating another key.",
      );
    }
  }

  return (
    <li>
      <h2>Copy agent setup</h2>
      <p>Paste the copied prompt into Codex, Claude or your agent.</p>
      <p>
        Full owner administration · all current and future projects · 90 days.
        {actor.primaryOwner
          ? " Includes your private member notes."
          : " Primary-owner private notes stay restricted."}{" "}
        Share this private key only with your trusted agent.
      </p>
      <button
        className="primary"
        disabled={action.busy || !instructions}
        onClick={() =>
          void action.run(
            copyAgentSetup,
            issued
              ? "Agent setup prompt copied again."
              : "Agent setup prompt created and copied.",
          )
        }
      >
        {action.busy ? (issued ? "Copying…" : "Creating & copying…") : "Copy agent setup"}
      </button>
      <ActionState action={action} />
      {!instructions && (
        <p className="error" role="alert">
          Agent setup instructions are unavailable. Ask the owner to update this server
          before creating a key.
        </p>
      )}
      {prompt && (
        <details
          open={showPrompt}
          onToggle={(event) => setShowPrompt(event.currentTarget.open)}
        >
          <summary>Preview or manually copy the private setup prompt</summary>
          <textarea
            aria-label="Private agent setup prompt"
            value={prompt}
            readOnly
            rows={12}
          />
        </details>
      )}
    </li>
  );
}

export function Help({ actor, projects }: { actor?: Actor; projects: Project[] }) {
  const { data, error } = useLoad(async () => {
    const r = await fetch("/api/help", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!r.ok) throw new Error("Sign in to read help.");
    const document = new DOMParser().parseFromString(await r.text(), "text/html");
    const template = document.querySelector<HTMLTemplateElement>(
      "template#agent-setup-instructions",
    );
    const instructions = template?.content.textContent?.trim() ?? "";
    template?.remove();
    const install = document.querySelector("section");
    const installHelp = install?.cloneNode(true) as HTMLElement | undefined;
    const download = install?.querySelector("a.button") ?? install?.querySelector("p");
    const downloadHtml = download?.outerHTML ?? "";
    const repeatedDownload =
      installHelp?.querySelector("a.button") ?? installHelp?.querySelector("p");
    repeatedDownload?.remove();
    if (installHelp && install)
      document.body.insertBefore(installHelp, install.nextSibling);
    document.querySelector("h1")?.remove();
    document.body.querySelector(":scope > p")?.remove();
    install?.remove();
    document.querySelector("#agent-setup-slot")?.remove();
    for (const disclosure of document.body.querySelectorAll(":scope > details")) {
      const section = document.createElement("section");
      const summary = disclosure.querySelector(":scope > summary");
      const heading = document.createElement("h2");
      heading.textContent = summary?.textContent ?? "More information";
      if (summary?.id) heading.id = summary.id;
      summary?.remove();
      section.append(heading, ...Array.from(disclosure.childNodes));
      disclosure.replaceWith(section);
    }
    return {
      downloadHtml,
      moreHtml: document.body.innerHTML,
      instructions,
    } satisfies HelpContent;
  }, []);
  useEffect(() => {
    const revealUpdate = () => {
      if (location.hash !== "#update-extension") return;
      const more = document.getElementById("more-help");
      if (more instanceof HTMLDetailsElement) more.open = true;
      document.getElementById("update-extension")?.scrollIntoView();
    };
    revealUpdate();
    window.addEventListener("hashchange", revealUpdate);
    return () => window.removeEventListener("hashchange", revealUpdate);
  }, [data]);
  return (
    <>
      <ErrorNotice error={error} />
      {data ? (
        <article className="reading">
          <h1>Help &amp; Chrome extension</h1>
          <ol>
            <li>
              <h2>Download extension</h2>
              <div dangerouslySetInnerHTML={{ __html: data.downloadHtml }} />
            </li>
            <li>
              <h2>Install in Chrome</h2>
              <p>
                Unzip → open <code>chrome://extensions</code> → turn on Developer mode →
                choose Load unpacked.
              </p>
            </li>
            <HelpAgentSetup
              actor={actor}
              projects={projects}
              instructions={data.instructions}
            />
          </ol>
          <details id="more-help">
            <summary>More help</summary>
            <div dangerouslySetInnerHTML={{ __html: data.moreHtml }} />
          </details>
        </article>
      ) : (
        !error && <Loading />
      )}
    </>
  );
}
export function Privacy() {
  return (
    <article className="reading">
      <h1>Privacy & data use</h1>
      <p>
        Feedbacks is a private team review service. Access to projects, discussion and
        screenshots is restricted to authorized members and scoped tokens.
      </p>
      <section>
        <h2>Information stored</h2>
        <p>
          The service stores account identity, project memberships, comments and replies,
          reviewer policy, timestamps, target URLs, viewport and element context, and
          screenshots that users explicitly approve for upload. Sensitive query keys and
          URL fragments are removed server-side. Avoid confidential data in comments, URL
          paths and element identifiers.
        </p>
        <p>
          Passwords are hashed. Web sessions use HttpOnly cookies. The extension stores
          its paired device credential in trusted extension storage and sends it only to
          the selected Feedbacks service.
        </p>
      </section>
      <section>
        <h2>Capture is explicit</h2>
        <p>
          The extension captures only when you initiate review. It does not continuously
          record your screen. Screenshots include the visible page, including forms and
          embedded frames, without automatic masking. Nothing is uploaded until you send
          it.
        </p>
        <p>
          Optional instant right-click installs a local listener on HTTP(S) websites after
          you approve Chrome’s all-website permission. It does not upload browsing history
          or capture pages in the background. General projects accept any website;
          ordinary projects keep their approved origins and all projects still require
          membership.
        </p>
        <p>
          Approved images are validated, stripped of image metadata and stored privately.
          Project authorization is checked when an image is read. No public bucket links
          are provided.
        </p>
      </section>
      <section>
        <h2>Optional diagnostics</h2>
        <p>
          Console and resource timing collection starts only when you choose it in the
          extension. It ends on capture, navigation, stop or after five minutes, with at
          most 25 console and 50 resource entries. Review the entries and explicitly
          enable sharing in the editor before sending them with a thread.
        </p>
        <p>
          URL credentials, queries and fragments are stripped. Headers, request bodies,
          cookies and storage values are not collected. Redaction is best effort; review
          messages and URL paths for private information. Shared entries follow the same
          project access and retention rules as discussion. Page-generated diagnostics are
          untrusted and may be incomplete.
        </p>
      </section>
      <section>
        <h2>Access, retention and removal</h2>
        <p>
          Owners manage access. You can revoke agent tokens and paired extensions in
          Account. Archiving keeps discussion and evidence; it is not erasure. Contact
          your deployment owner for exact retention, backup handling, account requests and
          operator-managed deletion.
        </p>
        <p>
          This application does not sell feedback, include advertising trackers, or send
          it to a model provider automatically. An authorized developer may share project
          context with a separately configured agent; that client’s own privacy settings
          also apply.
        </p>
      </section>
      <a href="/help">Back to help</a>
    </article>
  );
}
