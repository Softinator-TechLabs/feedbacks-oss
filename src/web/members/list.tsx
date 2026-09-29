import React, { useEffect, useState } from "react";
import { CreateMember } from "../account-admin.js";
import { api, type Actor, type Project } from "../api.js";
import {
  ActionState,
  Empty,
  ErrorNotice,
  Field,
  Loading,
  Secret,
  useAction,
  useLoad,
} from "../ui.js";
import type { Member } from "./types.js";
import { MemberEditor } from "./editor.js";
import { RoleSelect } from "./role-select.js";

import { SectionTabs, type SectionTab } from "../section-tabs.js";

type MemberTab = "people" | "invite" | "create" | "add";
function memberTabFromHash(): MemberTab {
  const hash = typeof window === "undefined" ? "" : window.location.hash.slice(1);
  return hash === "invite" || hash === "create" || hash === "add" ? hash : "people";
}
export function Members({ actor, project }: { actor: Actor; project?: Project }) {
  const hasProjectTabs = !!project && actor.owner;
  const [version, setVersion] = useState(0),
    [selectedId, setSelectedId] = useState<string | null>(null),
    [memberAction, setMemberAction] = useState<"create" | "invite" | "add" | null>(() => {
      const initial = memberTabFromHash();
      return hasProjectTabs && initial !== "people" ? initial : null;
    }),
    [search, setSearch] = useState(""),
    [roleFilter, setRoleFilter] = useState("all"),
    [visibleCount, setVisibleCount] = useState(40),
    [showRemoved, setShowRemoved] = useState(false),
    { data, error } = useLoad(
      () =>
        api<{ items: Member[] }>(
          "members.list",
          project ? { projectId: project.id } : { includeRemoved: showRemoved },
        ),
      [project?.id, version, showRemoved],
    ),
    { data: all } = useLoad(
      () =>
        actor.owner && project
          ? api<{ items: Member[] }>("members.list", {})
          : Promise.resolve({ items: [] }),
      [project?.id, actor.owner, version],
    ),
    a = useAction(),
    [invite, setInvite] = useState("");
  const matchingMembers = (data?.items ?? []).filter((member) => {
    const query = search.trim().toLocaleLowerCase();
    const role = member.primaryOwner
      ? "owner"
      : member.owner
        ? "owner"
        : (member.role ?? "member").toLocaleLowerCase();
    return (
      (roleFilter === "all" || role === roleFilter) &&
      (!query ||
        [member.name, member.email, role, ...(member.expertise ?? [])]
          .filter(Boolean)
          .some((value) => value!.toLocaleLowerCase().includes(query)))
    );
  });
  const refresh = () => setVersion((v) => v + 1);
  const tabs: SectionTab<MemberTab>[] = [
    { id: "people", label: "People", panelId: "members-people" },
    { id: "invite", label: "Invite", panelId: "members-invite" },
    { id: "create", label: "Create user", panelId: "members-create" },
    { id: "add", label: "Add existing", panelId: "members-add" },
  ];
  const selectedTab: MemberTab = memberAction ?? "people";
  const selectTab = (next: MemberTab) => {
    setMemberAction(next === "people" ? null : next);
    history.replaceState(null, "", `#${next}`);
    window.scrollTo(0, 0);
  };
  useEffect(() => {
    if (!hasProjectTabs) return;
    const selectHash = () => {
      const next = memberTabFromHash();
      setMemberAction(next === "people" ? null : next);
    };
    window.addEventListener("hashchange", selectHash);
    return () => window.removeEventListener("hashchange", selectHash);
  }, [hasProjectTabs]);
  useEffect(() => {
    if (selectedId) document.getElementById("person-back")?.focus();
  }, [selectedId]);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{project ? "Project members" : "People"}</h1>
          <p>
            {actor.owner
              ? `${data?.items.length ?? 0} ${(data?.items.length ?? 0) === 1 ? "person" : "people"} with access.`
              : "People who can participate in this project."}
          </p>
        </div>
      </div>
      <ErrorNotice error={error} />
      {hasProjectTabs && (
        <SectionTabs
          label="Project members sections"
          idPrefix="members-tab"
          tabs={tabs}
          selected={selectedTab}
          onSelect={selectTab}
        />
      )}
      {!hasProjectTabs && !selectedId && actor.owner && (
        <div className="member-actions" role="group" aria-label="Manage people">
          {project && (
            <button
              type="button"
              className={memberAction === "invite" ? "primary" : ""}
              aria-pressed={memberAction === "invite"}
              onClick={() => setMemberAction(memberAction === "invite" ? null : "invite")}
            >
              Invite person
            </button>
          )}
          <button
            type="button"
            aria-pressed={memberAction === "create"}
            onClick={() => setMemberAction(memberAction === "create" ? null : "create")}
          >
            Create user
          </button>
          {project && (
            <button
              type="button"
              aria-pressed={memberAction === "add"}
              onClick={() => setMemberAction(memberAction === "add" ? null : "add")}
            >
              Add existing
            </button>
          )}
        </div>
      )}
      {actor.owner && (hasProjectTabs || (!selectedId && memberAction === "create")) && (
        <div
          className={hasProjectTabs ? "section-panel" : undefined}
          id={hasProjectTabs ? "members-create" : undefined}
          role={hasProjectTabs ? "tabpanel" : undefined}
          aria-labelledby={hasProjectTabs ? "members-tab-create" : undefined}
          hidden={hasProjectTabs && selectedTab !== "create"}
        >
          <CreateMember
            project={project}
            onSaved={refresh}
            initiallyOpen
            flat={hasProjectTabs}
          />
        </div>
      )}
      {actor.owner && project && (
        <div
          className="section-panel"
          id="members-invite"
          role="tabpanel"
          aria-labelledby="members-tab-invite"
          hidden={selectedTab !== "invite"}
        >
          <section className="section member-action-panel">
            <h2>Invite a colleague</h2>
            <form
              className="form-grid"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void a.run(async () => {
                  const r = await api("members.invite", {
                    email: String(f.get("email")),
                    role: String(f.get("role")) as "reviewer",
                    projectId: project.id,
                  });
                  setInvite(`${location.origin}${r.invitePath}`);
                });
              }}
            >
              <Field label="Email">
                <input name="email" type="email" required />
              </Field>
              <Field label="Project role">
                <RoleSelect />
              </Field>
              <button className="primary" disabled={a.busy}>
                Create invitation link
              </button>
            </form>
            <p className="muted">
              Send this link privately. No email is sent automatically. It expires in
              seven days.
            </p>
            {invite && (
              <Secret value={invite} label="Invitation link — copy and send privately." />
            )}
            <ActionState action={a} />
          </section>
        </div>
      )}
      {actor.owner && project && (
        <div
          className="section-panel"
          id="members-add"
          role="tabpanel"
          aria-labelledby="members-tab-add"
          hidden={selectedTab !== "add"}
        >
          <section className="section member-action-panel">
            <h2>Add an existing member</h2>
            <form
              className="form-grid"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void a.run(async () => {
                  await api("members.grant", {
                    projectId: project.id,
                    userId: String(f.get("userId")),
                    role: String(f.get("role")) as "reviewer",
                    canResolve: f.has("canResolve"),
                  });
                  refresh();
                }, "Project access saved.");
              }}
            >
              <Field label="Member">
                <select name="userId" required>
                  <option value="">Select a member</option>
                  {all?.items
                    .filter((m) => m.active && !m.owner)
                    .map((m) => (
                      <option value={m.id} key={m.id}>
                        {m.name} — {m.email}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Role">
                <RoleSelect />
              </Field>
              <label className="check">
                <input name="canResolve" type="checkbox" />
                May resolve feedback
              </label>
              <button disabled={a.busy}>Save access</button>
            </form>
            <ActionState action={a} />
          </section>
        </div>
      )}
      <div
        className={hasProjectTabs ? "section-panel" : undefined}
        id={hasProjectTabs ? "members-people" : undefined}
        role={hasProjectTabs ? "tabpanel" : undefined}
        aria-labelledby={hasProjectTabs ? "members-tab-people" : undefined}
        hidden={hasProjectTabs && selectedTab !== "people"}
      >
        {!project && actor.owner && !selectedId && (
          <label className="check">
            <input
              type="checkbox"
              checked={showRemoved}
              onChange={(e) => setShowRemoved(e.target.checked)}
            />
            Show removed accounts
          </label>
        )}
        {!selectedId && data && (
          <div className="member-directory-controls">
            <label>
              <span className="sr-only">Search people</span>
              <input
                type="search"
                value={search}
                placeholder="Search name, email or expertise"
                onChange={(event) => {
                  setSearch(event.target.value);
                  setVisibleCount(40);
                }}
              />
            </label>
            <label>
              <span className="sr-only">Filter by role</span>
              <select
                aria-label="Filter by role"
                value={roleFilter}
                onChange={(event) => {
                  setRoleFilter(event.target.value);
                  setVisibleCount(40);
                }}
              >
                <option value="all">All roles</option>
                <option value="owner">Owners</option>
                <option value="maintainer">Maintainers</option>
                <option value="reviewer">Reviewers</option>
                <option value="viewer">Viewers</option>
              </select>
            </label>
            <span className="muted" role="status">
              Showing {Math.min(visibleCount, matchingMembers.length)} of{" "}
              {matchingMembers.length} matching{" "}
              {matchingMembers.length === 1 ? "person" : "people"}
            </span>
          </div>
        )}
        {!data && !error ? (
          <Loading />
        ) : data?.items.length ? (
          selectedId ? (
            <>
              <button id="person-back" type="button" onClick={() => setSelectedId(null)}>
                ← All people
              </button>
              {data.items
                .filter((m) => m.id === selectedId)
                .map((m) => (
                  <MemberEditor
                    key={m.id}
                    member={m}
                    project={project}
                    owner={!!actor.owner}
                    actor={actor}
                    onSaved={refresh}
                    onArchived={() => {
                      refresh();
                      setSelectedId(null);
                    }}
                  />
                ))}
            </>
          ) : (
            <div className="member-directory">
              {matchingMembers.length ? (
                <div className="member-list" aria-label="People">
                  {matchingMembers.slice(0, visibleCount).map((m) => (
                    <button
                      type="button"
                      className="member-list-item"
                      key={m.id}
                      onClick={() => setSelectedId(m.id)}
                    >
                      <span>
                        <strong>{m.name}</strong>
                        {actor.owner && <small>{m.email}</small>}
                      </span>
                      <span>
                        {m.removedAt
                          ? "Removed"
                          : m.primaryOwner
                            ? "Primary owner"
                            : m.owner
                              ? "Owner"
                              : (m.role ?? "Member")}
                        {!m.active && !m.removedAt ? " · Disabled" : ""}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <Empty title="No matching people">Try another name, email or role.</Empty>
              )}
              {matchingMembers.length > visibleCount && (
                <button
                  type="button"
                  className="member-show-more"
                  onClick={() => setVisibleCount((count) => count + 40)}
                >
                  Show next 40 people
                </button>
              )}
            </div>
          )
        ) : (
          data && (
            <Empty title="No members">Invite a colleague from a project to begin.</Empty>
          )
        )}
      </div>
    </>
  );
}
