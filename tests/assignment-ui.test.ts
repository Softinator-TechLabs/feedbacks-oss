import test from "node:test";
import assert from "node:assert/strict";
import {
  assignmentPoints,
  assignmentScope,
  writableAssignees,
  assignmentActor,
  assignmentRetry,
} from "../src/web/assignments/model.js";

const thread = {
  archived: false,
  work: { state: "open" },
  context: {
    annotations: [
      { id: "a", body: "First" },
      { id: "b", body: "Second" },
      { id: "c", body: "Third" },
    ],
  },
  annotationStates: { a: { state: "resolved" }, c: { state: "removed" } },
} as any;

test("assignment point numbers preserve screenshot positions and exclude closed work", () => {
  assert.deepEqual(assignmentPoints(thread), [{ id: "b", body: "Second", number: 2 }]);
  assert.deepEqual(assignmentPoints({ ...thread, archived: true }), []);
  assert.deepEqual(assignmentPoints({ ...thread, work: { state: "resolved" } }), []);
  assert.equal(assignmentScope(["b"], thread), "Point 2");
  assert.equal(assignmentScope(["a", "c"], thread), "Points 1, 3");
  assert.equal(assignmentScope([], thread), "Whole thread");
  assert.equal(assignmentScope(["unknown"], thread), "Unavailable point");
});

test("assignee choices include active owners and project writers only", () => {
  const people = [
    { id: "owner", name: "Owner", active: true, owner: true, role: null },
    { id: "reviewer", name: "Reviewer", active: true, owner: false, role: "reviewer" },
    {
      id: "maintainer",
      name: "Maintainer",
      active: true,
      owner: false,
      role: "maintainer",
    },
    { id: "viewer", name: "Viewer", active: true, owner: false, role: "viewer" },
    { id: "other", name: "Other", active: true, owner: false, role: null },
    { id: "archived", name: "Archived", active: false, owner: true, role: "maintainer" },
    {
      id: "removed",
      name: "Removed",
      active: true,
      owner: false,
      role: "reviewer",
      removedAt: "today",
    },
  ];
  assert.deepEqual(
    writableAssignees(people).map((person) => person.id),
    ["owner", "reviewer", "maintainer"],
  );
});

test("assignment attribution names authenticated user and optional agent independently", () => {
  assert.equal(
    assignmentActor({ memberName: "Asha", agentName: "Build helper" }),
    "Asha via Build helper",
  );
  assert.equal(assignmentActor({ memberName: "Asha", agentName: null }), "Asha");
});

test("identical retries reuse payload and key while edits obtain a new key", () => {
  const first = assignmentRetry(
    undefined,
    { summary: "Fix spacing", threadRevision: 3 },
    () => "one",
  );
  const retry = assignmentRetry(
    first,
    { summary: "Fix spacing", threadRevision: 3 },
    () => "two",
  );
  assert.equal(retry, first);
  assert.equal(retry.input.idempotencyKey, "one");
  const edited = assignmentRetry(
    first,
    { summary: "Fix contrast", threadRevision: 3 },
    () => "three",
  );
  assert.equal(edited.input.idempotencyKey, "three");
});
