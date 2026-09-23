import test from "node:test";
import assert from "node:assert/strict";
import { helpHtml } from "../src/server/help.js";
import { chromeWebStoreUrl, officialWebsiteUrl } from "../src/shared/product-links.js";

test("help offers the Store installation and the current server without a ZIP release", () => {
  const html = helpHtml("https://feedbacks.example.com", null);
  assert.ok(html.includes(`href="${chromeWebStoreUrl}"`));
  assert.ok(html.includes("https://feedbacks.example.com"));
  assert.ok(html.includes(`href="${officialWebsiteUrl}"`));
  assert.ok(html.includes("Add to Chrome"));
  assert.ok(!html.includes("Download and extract the ZIP"));
  assert.ok(!html.includes("/downloads/feedbacks-extension.zip"));
});

test("a separately packaged ZIP is identified as an unpacked build", () => {
  const html = helpHtml("https://feedbacks.example.com", {
    version: "0.1.10",
    downloadPath: "/downloads/feedbacks-extension.zip",
    sha256: "a".repeat(64),
    bytes: 1,
  });
  assert.ok(html.includes("Self-managed unpacked build only"));
  assert.ok(html.includes("This archive is not the Chrome Web Store release."));
  assert.ok(html.includes("/downloads/feedbacks-extension.zip?v=0.1.10"));
});
