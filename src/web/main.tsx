import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { api, type Actor, type Project } from "./api.js";
import { AuthScreen, Pairing } from "./auth.js";
import { Projects, ProjectSettings } from "./projects.js";
import { ThreadList, ThreadDetail } from "./threads.js";
import { Members, Instructions, Account } from "./settings.js";
import { Help, Privacy } from "./help.js";
import { PasswordReplacement } from "./account-admin.js";
import { OwnerLinkSignIn } from "./owner-links.js";
import { ActionState, ErrorNotice, Loading, useAction, useLoad } from "./ui.js";
import "./styles.css";
import "./thread-detail.css";
import "./theme.css";
import { ThemeSwitch } from "./theme.js";
import { usePageLocation } from "./navigation.js";
import { officialWebsiteUrl } from "../shared/product-links.js";
import { GuestReview } from "./guest-review.js";
import { GuestProjectReview } from "./guest-project-review.js";
function App() {
  const pageLocation = usePageLocation();
  const path = pageLocation.split("?")[0];
  const [resetToken] = useState(() => {
    if (location.pathname !== "/reset") return "";
    const token = new URLSearchParams(location.hash.slice(1)).get("token") ?? "";
    history.replaceState(null, "", "/reset");
    return token;
  });
  const [inviteToken] = useState(() => {
    if (location.pathname !== "/invite") return "";
    const token =
      new URLSearchParams(location.hash.slice(1)).get("token") ??
      new URLSearchParams(location.search).get("token") ??
      "";
    history.replaceState(null, "", "/invite");
    return token;
  });
  const [ownerLinkToken] = useState(() => {
    if (location.pathname !== "/owner-login") return "";
    const token = new URLSearchParams(location.hash.slice(1)).get("token") ?? "";
    history.replaceState(null, "", "/owner-login");
    return token;
  });
  const [guestToken] = useState(() => {
    if (location.pathname !== "/guest") return "";
    const token = new URLSearchParams(location.hash.slice(1)).get("token") ?? "";
    history.replaceState(null, "", "/guest");
    return token;
  });
  const [guestProjectToken] = useState(() => {
    if (location.pathname !== "/guest-project") return "";
    const token = new URLSearchParams(location.hash.slice(1)).get("token") ?? "";
    history.replaceState(null, "", "/guest-project");
    return token;
  });
  const [version, setVersion] = useState(0),
    [threadProject, setThreadProject] = useState<{
      threadId: string;
      project: Project;
    }>(),
    session = useLoad(
      () =>
        path === "/guest" || path === "/guest-project"
          ? Promise.resolve(undefined)
          : api<{ actor: Actor; projects: Project[] }>("auth.me", {}),
      [version, path],
    ),
    a = useAction();
  const params = new URLSearchParams(location.search),
    projectMatch = path.match(/^\/projects\/([^/]+)(?:\/(.*))?$/),
    threadMatch = path.match(/^\/threads\/([^/]+)$/),
    projectId = projectMatch?.[1];
  const publicPage = path === "/privacy";
  const signOut = () => {
    session.setData(undefined);
    setVersion((v) => v + 1);
  };
  const currentUser = useRef(session.data?.actor.userId);
  currentUser.current = session.data?.actor.userId;
  useEffect(() => {
    const changed = (event: Event) => {
      const userId = (event as CustomEvent<{ userId?: string | null }>).detail?.userId;
      // Same-account reauthentication refreshes permissions without unmounting
      // editors. Explicit logout and actual identity changes discard old data.
      if (
        userId === null ||
        (typeof userId === "string" && userId !== currentUser.current)
      ) {
        session.setData(undefined);
        setThreadProject(undefined);
      }
      setVersion((v) => v + 1);
    };
    window.addEventListener("feedbacks:account-change", changed);
    return () => window.removeEventListener("feedbacks:account-change", changed);
  }, []);
  useEffect(() => {
    if (session.error.includes("UNAUTHENTICATED")) {
      session.setData(undefined);
      setThreadProject(undefined);
    }
  }, [session.error]);
  if (path === "/reset" && resetToken)
    return (
      <PasswordReplacement
        resetToken={resetToken}
        onChanged={() => {
          location.href = "/";
        }}
      />
    );
  if (path === "/owner-login")
    return (
      <OwnerLinkSignIn
        token={ownerLinkToken}
        onAuthenticated={() => setVersion((v) => v + 1)}
      />
    );
  if (path === "/guest") return <GuestReview token={guestToken} />;
  if (path === "/guest-project") return <GuestProjectReview token={guestProjectToken} />;
  if (session.data?.actor.mustChangePassword && !publicPage)
    return <PasswordReplacement onChanged={signOut} />;
  if (path === "/invite")
    return (
      <AuthScreen
        inviteToken={inviteToken}
        onAuthenticated={() => setVersion((v) => v + 1)}
      />
    );
  if (!session.data && !publicPage) {
    if (!session.error)
      return (
        <main className="auth">
          <a className="brand" href="/">
            Feedbacks
          </a>
          <Loading />
        </main>
      );
    return (
      <AuthScreen
        initialError={session.error.includes("UNAUTHENTICATED") ? "" : session.error}
        onAuthenticated={() => {
          if (path === "/sign-in" && params.get("returnTo") === "/help")
            location.href = "/help";
          else setVersion((v) => v + 1);
        }}
      />
    );
  }
  const actor = session.data?.actor,
    projects = session.data?.projects ?? [],
    project = projectId
      ? projects.find((item) => item.id === projectId)
      : threadMatch && threadProject?.threadId === threadMatch[1]
        ? threadProject.project
        : undefined,
    section = projectMatch?.[2] ?? "";
  return (
    <>
      <a className="skip-link" href="#content">
        Skip to content
      </a>
      <header className="topbar">
        <a className="brand" href="/">
          Feedbacks
          <span className="brand-dot" />
        </a>
        <nav aria-label="Main navigation">
          <a href="/" aria-current={path === "/" ? "page" : undefined}>
            Projects
          </a>
          {actor?.owner && (
            <a href="/people" aria-current={path === "/people" ? "page" : undefined}>
              People
            </a>
          )}
          <a href="/help" aria-current={path === "/help" ? "page" : undefined}>
            Help
          </a>
          <a className="official-site-link" href={officialWebsiteUrl}>
            Website <span aria-hidden="true">↗</span>
          </a>
        </nav>
        <div className="account-nav">
          <ThemeSwitch />
          {actor ? (
            <>
              <a href="/account">{actor.name}</a>
              <button
                disabled={a.busy}
                onClick={() =>
                  a.run(async () => {
                    await api("auth.logout", {});
                    signOut();
                  })
                }
              >
                Sign out
              </button>
            </>
          ) : (
            <a href="/">Sign in</a>
          )}
        </div>
      </header>
      <div className="shell" key={actor?.id ?? "public"}>
        {project && (
          <div className="project-nav">
            <a href="/">Projects</a>
            <span aria-hidden="true">/</span>
            <strong>{project.name}</strong>
            <nav aria-label="Project navigation">
              {[
                ["", "Feedback"],
                ["members", "Members"],
                ["instructions", "Instructions"],
                ["settings", "Settings"],
              ].map(([route, label]) => (
                <a
                  key={route}
                  href={`/projects/${project.id}${route ? `/${route}` : ""}`}
                  aria-current={section === route && !threadMatch ? "page" : undefined}
                >
                  {label}
                </a>
              ))}
            </nav>
          </div>
        )}
        <main id="content" tabIndex={-1} key={pageLocation}>
          <ActionState action={a} />
          {publicPage || path.replace(/\/$/, "") === "/help" ? (
            path.replace(/\/$/, "") === "/help" ? (
              <Help actor={actor} projects={projects} />
            ) : (
              <Privacy />
            )
          ) : !actor ? (
            <Loading />
          ) : path === "/pair" ? (
            <Pairing pairingId={params.get("pairingId") ?? ""} />
          ) : path === "/account" ? (
            <Account actor={actor} projects={projects} onSignOut={signOut} />
          ) : path === "/people" ? (
            actor.owner ? (
              <Members actor={actor} />
            ) : (
              <p role="alert">
                Owner access is required for the global people directory.
              </p>
            )
          ) : threadMatch ? (
            <ThreadDetail
              key={threadMatch[1]}
              threadId={threadMatch[1]}
              onProject={(project) =>
                setThreadProject({ threadId: threadMatch[1], project })
              }
            />
          ) : projectId ? (
            !project ? (
              <p role="alert">
                This project is unavailable. <a href="/">Open projects</a>
              </p>
            ) : section === "members" ? (
              <Members actor={actor} project={project} />
            ) : section === "instructions" ? (
              <Instructions project={project} />
            ) : section === "settings" ? (
              <ProjectSettings
                project={project}
                actor={actor}
                onSaved={() => setVersion((v) => v + 1)}
              />
            ) : section === "" ? (
              <ThreadList project={project} />
            ) : (
              <p>
                Page not found. <a href="/">Open projects</a>
              </p>
            )
          ) : path === "/" ? (
            <Projects
              projects={projects}
              actor={actor}
              onSaved={(p) => {
                location.href = `/projects/${p.id}`;
              }}
            />
          ) : (
            <p>
              Page not found. <a href="/">Open projects</a>
            </p>
          )}
        </main>
        <footer className="site-footer">
          <span>Feedbacks</span>
          <a href={officialWebsiteUrl}>Official website</a>
          <a href="/privacy">Privacy</a>
          <a href="/help">Help</a>
        </footer>
      </div>
    </>
  );
}
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main className="auth">
        <h1>This page could not load</h1>
        <p>
          Reload the page to try again. Unsubmitted drafts in this page may be lost on
          reload.
        </p>
        <button onClick={() => location.reload()}>Reload page</button>
      </main>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
