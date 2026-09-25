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
  assert.ok(page.includes("optional GitHub App"));
  assert.ok(page.includes("short tab video"));
});
