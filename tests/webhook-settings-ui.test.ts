import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectSettings } from "../src/web/projects.js";
import type { Actor, Project } from "../src/web/api.js";

const project: Project = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Example",
  origins: ["https://example.com"],
  repositoryUrl: null,
  revision: 1,
  permissions: {
    role: "maintainer",
    canWrite: true,
    canMaintain: true,
    canResolve: true,
  },
};
const actor: Actor = {
  id: "22222222-2222-4222-8222-222222222222",
  userId: "22222222-2222-4222-8222-222222222222",
  name: "Maintainer",
  kind: "human",
};

test("project maintainer sees webhook destination and delivery controls in settings", () => {
  const html = renderToStaticMarkup(
    React.createElement(ProjectSettings, { project, actor, onSaved: () => {} }),
  );
  assert.match(html, /Webhooks/);
  assert.match(html, /Destination URL/);
  assert.match(html, /Save webhook/);
  assert.match(html, /Delivery history/);
  assert.match(html, /Document review/);
  assert.match(html, /Surveys and polls/);
  assert.match(html, /GitHub Issues/);
  assert.match(html, /Off for this project/);
});

test("connected GitHub is summarized in settings without prompting setup", () => {
  const html = renderToStaticMarkup(
    React.createElement(ProjectSettings, {
      project: { ...project, githubConnected: true, documentsEnabled: true },
      actor,
      onSaved: () => {},
    }),
  );
  assert.match(html, /Connected to this project/);
  assert.match(html, /Manage GitHub connection/);
  assert.match(html, /name="documentsEnabled"[^>]*checked/);
});

test("project reviewer does not see webhook management", () => {
  const html = renderToStaticMarkup(
    React.createElement(ProjectSettings, {
      project: {
        ...project,
        permissions: { ...project.permissions, role: "reviewer", canMaintain: false },
      },
      actor,
      onSaved: () => {},
    }),
  );
  assert.doesNotMatch(html, /Save webhook|Delivery history|Rotate secret/);
});
