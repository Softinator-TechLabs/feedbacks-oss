import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReviewEvidence } from "../src/web/threads/detail/evidence.js";
import type { Thread } from "../src/web/api.js";

function thread(withOverview = true): Thread {
  const point = (id: string, filename: string) => ({
    id: `image-${id}`,
    url: `/api/assets/image-${id}`,
    width: 800,
    height: 600,
    rendition: "original",
    contentType: "image/webp" as const,
    filename,
    markings: [
      {
        tool: "point" as const,
        annotationId: id,
        bounds: { x: 0.1, y: 0.1, width: 0, height: 0 },
        endpoints: [{ x: 0.1, y: 0.1 }],
      },
    ],
  });
  return {
    id: "thread-1",
    revision: 1,
    work: { state: "open" },
    context: {
      viewport: { width: 800, height: 600 },
      annotations: [
        { id: "a", body: "First request", anchor: { selector: "#first" } },
        { id: "b", body: "Second request", anchor: { selector: "#second" } },
        { id: "c", body: "Text-only request", anchor: {} },
      ],
    },
    assets: [
      point("b", "point-001-original.webp"),
      ...(withOverview
        ? [
            {
              id: "overview",
              url: "/api/assets/overview",
              width: 800,
              height: 1200,
              rendition: "combined",
              contentType: "image/webp" as const,
              filename: "full-page-combined.webp",
            },
          ]
        : []),
      point("a", "point-002-original.webp"),
    ],
  } as Thread;
}

test("review shows a main capture first, then each point's linked original inline", () => {
  const html = renderToStaticMarkup(
    React.createElement(ReviewEvidence, { thread: thread() }),
  );
  const overview = html.indexOf('class="review-main-capture"');
  const first = html.indexOf("First request");
  const second = html.indexOf("Second request");
  const firstImage = html.indexOf('id="asset-image-a"');
  const secondImage = html.indexOf('id="asset-image-b"');
  assert.ok(overview >= 0 && overview < first);
  assert.ok(first < firstImage && firstImage < second);
  assert.ok(second < secondImage);
  assert.match(html, /id="asset-overview"/);
  assert.doesNotMatch(
    html,
    /Show original view|Screenshot<\/label>|review-evidence-popover/,
  );
  assert.equal((html.match(/class="review-point-figure"/g) || []).length, 2);
});

test("points remain readable when the main capture or a point original is absent", () => {
  const html = renderToStaticMarkup(
    React.createElement(ReviewEvidence, { thread: thread(false) }),
  );
  assert.doesNotMatch(html, /review-main-capture/);
  assert.match(html, /Text-only request/);
  assert.match(html, /Saved page position/);
  assert.equal((html.match(/class="review-point-figure"/g) || []).length, 2);
});

test("recording frames and the linked video are shown once in the recording player", () => {
  const item = thread(false);
  item.assets = [
    {
      id: "frame",
      url: "/api/assets/frame",
      width: 800,
      height: 600,
      rendition: "annotated",
      contentType: "image/webp",
      recordingFrame: {
        recordingId: "rec",
        atMs: 5000,
        videoTimeMs: 4800,
        annotationId: "a",
      },
      markings: [
        {
          tool: "point",
          annotationId: "a",
          bounds: { x: 0.2, y: 0.2, width: 0, height: 0 },
          endpoints: [{ x: 0.2, y: 0.2 }],
        },
      ],
    },
    {
      id: "video",
      url: "/api/assets/video",
      rendition: "tabVideo",
      contentType: "video/webm",
    },
  ] as Thread["assets"];
  const html = renderToStaticMarkup(
    React.createElement(ReviewEvidence, { thread: item }),
  );
  assert.doesNotMatch(html, /review-main-capture|review-extra-captures|<video/);
  assert.equal((html.match(/src="\/api\/assets\/frame"/g) || []).length, 1);
  assert.match(html, /First request/);
});

test("screenshot review offers a single image review action", () => {
  const html = renderToStaticMarkup(
    React.createElement(ReviewEvidence, { thread: thread() }),
  );
  assert.match(html, /Review image/);
  assert.doesNotMatch(html, /Expand image|Edit annotations/);
  assert.doesNotMatch(html, />Open full image</);
});
