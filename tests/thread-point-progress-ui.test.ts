import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ThreadListPointProgress } from "../src/web/threads/list-point-progress.js";
import type { Thread } from "../src/web/api.js";

const fixture = {
  context: {
    annotations: Array.from({ length: 5 }, (_, i) => ({
      id: `point-${i + 1}`,
      body: `Point ${i + 1} request`,
      anchor: {},
    })),
  },
  work: { state: "ready_for_review" },
  annotationStates: {
    "point-1": { state: "resolved" },
    "point-2": { state: "removed" },
  },
} as unknown as Thread;
const render = (thread = fixture) =>
  renderToStaticMarkup(
    React.createElement(ThreadListPointProgress, {
      thread,
      href: "/threads/synthetic?workState=ready_for_review&offset=10",
    }),
  );

test("list progress identifies numbered resolved and open points without reading discussion", () => {
  const html = render();
  assert.match(html, /1 of 4 points resolved · 3 open/);
  assert.match(html, /Point 1 request.*badge resolved.*Resolved/);
  assert.match(html, /Point 3 request.*badge open.*Open/);
  assert.doesNotMatch(html, /Point 2 request|#2</);
  assert.match(html, /#3</);
  assert.match(html, /workState=ready_for_review&amp;offset=10#point-point-3/);
  assert.match(html, /<details><summary>Show 1 more point<\/summary>/);
});

test("whole-thread terminal statuses and reopen use the same point states as progress counts", () => {
  const resolved = render({ ...fixture, work: { ...fixture.work, state: "resolved" } });
  assert.match(resolved, /4 of 4 points resolved/);
  assert.doesNotMatch(resolved, /badge open|badge declined|3 open/);
  const declined = render({ ...fixture, work: { ...fixture.work, state: "declined" } });
  assert.match(declined, /0 of 4 points resolved · 4 closed/);
  assert.equal((declined.match(/badge declined/g) ?? []).length, 4);
  assert.match(
    render({ ...fixture, work: { ...fixture.work, state: "open" } }),
    /1 of 4 points resolved · 3 open/,
  );
});

test("empty and removed-only feedback does not invent point progress", () => {
  assert.equal(
    render({ ...fixture, context: { ...fixture.context, annotations: [] } }),
    "",
  );
  assert.equal(
    render({
      ...fixture,
      context: { ...fixture.context, annotations: [fixture.context.annotations![1]] },
    }),
    "",
  );
});

test("point text renders as text and short lists do not need a disclosure", () => {
  const html = render({
    ...fixture,
    context: {
      ...fixture.context,
      annotations: [{ id: "plain", body: "<script>unsafe()</script>", anchor: {} }],
    },
  });
  assert.match(html, /&lt;script&gt;unsafe\(\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>|<details>/);
});
