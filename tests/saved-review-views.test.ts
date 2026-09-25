import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

test("saved-view controls open from one named icon disclosure", async () => {
  Object.assign(globalThis, {
    location: { pathname: "/projects/example", search: "" },
    history: { state: {}, replaceState() {} },
    document: { addEventListener() {} },
    window: { addEventListener() {} },
    BroadcastChannel: undefined,
  });
  const { SavedReviewViews } = await import("../src/web/review-tools.js");
  const markup = renderToStaticMarkup(
    React.createElement(SavedReviewViews, {
      projectId: "example",
      filters: {},
      onApply() {},
    }),
  );

  assert.match(markup, /<summary[^>]*aria-label="Saved views"[^>]*>/);
  assert.match(markup, /<summary[^>]*>[\s\S]*?<svg[\s\S]*?<\/svg>[\s\S]*?<\/summary>/);
  assert.match(markup, /<details[\s\S]*<form[\s\S]*Name for current filters/);
  assert.doesNotMatch(markup, /class="saved-views-label"/);
});
