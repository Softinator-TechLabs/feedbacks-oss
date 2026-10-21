import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectSettings } from "../src/web/projects/index.js";
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

function renderSettings(hash: string, currentProject = project) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { hash } },
  });
  try {
    return renderToStaticMarkup(
      React.createElement(ProjectSettings, {
        project: currentProject,
        actor,
        onSaved: () => {},
      }),
    );
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
}

test("default project settings preserve project controls without mounting providers", () => {
  const html = renderSettings("");
  assert.match(html, /Document review/);
  assert.match(html, /Surveys and polls/);
  assert.match(html, /Project details/);
  assert.doesNotMatch(
    html,
    /Destination URL|Save webhook|Delivery history|GitHub Issues/,
  );
  assert.doesNotMatch(html, /Project integration providers/);
});

test("project maintainer opens its lazy webhook surface through the provider deep link", () => {
  const html = renderSettings("#integrations-webhooks");
  assert.match(html, /aria-label="Project integration providers"/);
  assert.match(html, /id="project-integration-tab-webhooks"[^>]*aria-selected="true"/);
  assert.match(html, /<h2 id="webhook-heading">Webhooks<\/h2>/);
  assert.doesNotMatch(html, /Destination URL|Save webhook/);
  assert.match(html, /Delivery history/);
  assert.doesNotMatch(
    html,
    /GitHub Issues|Harvest and Time Doctor|Slack and Teams notifications/,
  );
});

test("connected GitHub is summarized in its provider without prompting setup", () => {
  const html = renderSettings("#integrations-github", {
    ...project,
    githubConnected: true,
    documentsEnabled: true,
  });
  assert.match(html, /<p class="muted">Connected<\/p>/);
  assert.match(html, /Manage connection/);
  assert.doesNotMatch(html, /Set up GitHub|Destination URL|Save webhook/);
  // Project editor settings remain independent of the integration provider.
  assert.match(
    renderSettings("", { ...project, documentsEnabled: true }),
    /name="documentsEnabled"[^>]*checked/,
  );
});

test("project reviewer cannot activate webhook management through a deep link", () => {
  const html = renderSettings("#integrations-webhooks", {
    ...project,
    permissions: { ...project.permissions, role: "reviewer", canMaintain: false },
  });
  assert.doesNotMatch(
    html,
    /Save webhook|Delivery history|Rotate secret|Destination URL/,
  );
  assert.match(html, /GitHub Issues/);
  assert.match(html, /<p class="muted">Off<\/p>/);
});
