import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { matrixRows } from "../site/comparison-matrix.mjs";

const compareDirectory = resolve(import.meta.dirname, "../site/compare");

test("comparison pages open every external link in a new tab with nofollow", async () => {
  const pages = (await readdir(compareDirectory)).filter((name) =>
    name.endsWith(".html"),
  );
  assert.ok(pages.includes("index.html"));
  assert.ok(pages.length > 1);

  for (const page of pages) {
    const html = await readFile(resolve(compareDirectory, page), "utf8");
    const anchors = html.match(/<a\b[^>]*>/g) ?? [];
    const external = anchors.filter((anchor) => /\bhref="https?:\/\//.test(anchor));
    assert.ok(external.length > 0, `${page}: no external links found`);

    for (const anchor of external) {
      assert.match(anchor, /\btarget="_blank"/, `${page}: ${anchor}`);
      const rel = anchor.match(/\brel="([^"]+)"/)?.[1].split(/\s+/) ?? [];
      for (const value of ["nofollow", "noopener", "noreferrer"]) {
        assert.ok(rel.includes(value), `${page}: missing ${value} in ${anchor}`);
      }
    }

    for (const anchor of anchors.filter(
      (anchor) => !/\bhref="https?:\/\//.test(anchor),
    )) {
      assert.doesNotMatch(anchor, /\btarget="_blank"/, `${page}: ${anchor}`);
    }
  }
});

test("Feedbacks comparison describes current optional video and GitHub workflows", async () => {
  assert.equal(matrixRows.feedbacks.video.status, "yes");
  assert.match(matrixRows.feedbacks.video.url, /docs\/extension\.md$/);
  assert.equal(matrixRows.feedbacks.github.status, "yes");
  assert.match(matrixRows.feedbacks.github.url, /docs\/api\.md$/);
  const page = await readFile(resolve(compareDirectory, "bugpin.html"), "utf8");
  assert.doesNotMatch(page, /does not automatically create or synchronize Issues/);
  assert.match(page, /Optional GitHub App/i);
  assert.equal(matrixRows.feedbacks.sessionOnly.status, "yes");
  assert.doesNotMatch(page, /Recording is not session replay/);
});

test("every comparison verdict has dated, qualified evidence", async () => {
  const { matrixFeatures, matrixGroups, vendorAudits } = await import(
    "../site/comparison-matrix.mjs"
  );
  assert.equal(matrixFeatures.length, 49);
  assert.equal(new Set(matrixFeatures.map(([key]) => key)).size, 49);
  assert.equal(matrixGroups[0].id, "highlights");
  assert.equal(Object.keys(vendorAudits).length, 15);
  for (const [slug, row] of Object.entries(matrixRows)) {
    assert.equal(Object.keys(row).length, 49, slug);
    for (const [key] of matrixFeatures) {
      const evidence = row[key];
      assert.ok(evidence, `${slug}.${key}`);
      assert.match(evidence.url, /^https:\/\//, `${slug}.${key}`);
      assert.equal(evidence.reviewed, "30 September 2026", `${slug}.${key}`);
      assert.ok(evidence.detail.length > 15, `${slug}.${key}: qualification`);
      assert.ok(
        ["source", "documentation", "explicit", "scope"].includes(evidence.basis),
        `${slug}.${key}: basis`,
      );
    }
  }
  assert.equal(matrixRows["marker-io"].video.status, "no");
  assert.equal(matrixRows["marker-io"].replay.status, "paid");
  assert.equal(matrixRows.superflow.mcp.status, "yes");
  assert.equal(matrixRows.feedbacks.nativeClients.status, "yes");
  assert.equal(matrixRows.feedbacks.threadBundle.status, "yes");
});

test("categories include every tool without a nested table scroll region", async () => {
  const { matrixGroups, vendorAudits } = await import("../site/comparison-matrix.mjs");
  for (const name of ["index.html", "bugherd.html"]) {
    const page = await readFile(resolve(compareDirectory, name), "utf8");
    assert.equal((page.match(/<table\b/g) ?? []).length, matrixGroups.length);
    assert.equal((page.match(/class="matrix-evidence"/g) ?? []).length, 49 * 16);
    assert.doesNotMatch(page, /matrix-scroll|matrix-controls|matrix-next/);
    for (const group of matrixGroups) {
      assert.ok(page.includes(`id="matrix-${group.id}"`));
      assert.ok(page.includes(`href="#matrix-${group.id}"`));
    }
    for (const slug of ["feedbacks", ...Object.keys(vendorAudits)])
      assert.equal(
        (page.match(new RegExp(`data-tool="${slug}"`, "g")) ?? []).length,
        matrixGroups.length,
      );
    assert.ok(page.includes("❌"));
    assert.ok(page.includes("popover"));
    assert.ok(page.includes("2026-09-30"));
  }
});

test("category tables fit the page and preserve selected comparison context", async () => {
  const css = await readFile(resolve(compareDirectory, "../comparison.css"), "utf8");
  const page = await readFile(resolve(compareDirectory, "bugherd.html"), "utf8");
  assert.doesNotMatch(page, /style="/);
  assert.equal((page.match(/class="matrix-active"/g) ?? []).length, 6);
  assert.doesNotMatch(css, /matrix-scroll|--feature-width|--matrix-tools/);
  assert.match(css, /\.compare-matrix table\s*\{[^}]*width:\s*100%/);
  assert.ok(page.includes("matrix-product-toggle"));
});
