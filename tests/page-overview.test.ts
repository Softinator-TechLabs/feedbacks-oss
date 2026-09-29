import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error Native extension module has no generated declaration.
import { pageOverviewTarget } from "../extension/capture/page-overview.js";
import { readFilters } from "../src/web/review-filters.js";

test("popup scope links preserve the configured server and exact page, website and size filters", () => {
  const server = "https://configured.example.test";
  const raw = "https://review.example.com/journal/?token=private&volume=4#title";
  for (const [scope, expected] of [
    ["page", { url: "https://review.example.com/journal/?volume=4" }],
    ["website", { hostname: "review.example.com" }],
    [
      "view",
      { url: "https://review.example.com/journal/?volume=4", deviceClass: "mobile" },
    ],
  ] as const) {
    const result = pageOverviewTarget(server, "project-id", raw, 390, scope);
    assert.deepEqual(result.filters, expected);
    const url = new URL(result.url);
    assert.equal(url.origin, server);
    assert.equal(url.pathname, "/projects/project-id");
    assert.deepEqual(readFilters(url.search), {
      search: "",
      sort: "activity",
      showResolved: true,
      ...expected,
    });
    assert.doesNotMatch(result.url, /private|token|#title/);
  }
  assert.equal(
    pageOverviewTarget(server, "p", raw, 800, "view").filters.deviceClass,
    "tablet",
  );
  assert.equal(
    pageOverviewTarget(server, "p", raw, 1440, "view").filters.deviceClass,
    "desktop",
  );
});
