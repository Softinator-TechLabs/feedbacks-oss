import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { contextSchema } from "../src/shared/contracts/common.js";
import { reproductionSnapshot } from "../src/shared/reproduction-context.js";

test("explicit stable targets survive parsing, secrets/URLs and unknown fields do not", () => {
  const context = {
    url: "https://example.test/editor?token=hidden",
    viewport: { width: 800, height: 600 },
    reproduction: {
      source: "app",
      objectId: "demo-42",
      file: "chapters/demo.tex",
      version: "v2",
    },
  };
  assert.deepEqual(
    reproductionSnapshot(contextSchema.parse(context)),
    context.reproduction,
  );
  assert.equal(reproductionSnapshot({ url: context.url }), undefined);
  for (const reproduction of [
    { ...context.reproduction, token: "hidden" },
    { ...context.reproduction, objectId: "https://example.test/?access=secret" },
    { ...context.reproduction, file: "token=secret" },
  ]) {
    assert.equal(contextSchema.safeParse({ ...context, reproduction }).success, false);
    assert.equal(reproductionSnapshot({ reproduction }), undefined);
  }
  assert.deepEqual(reproductionSnapshot({ document: { id: "doc", page: 3 } }), {
    document: { documentId: "doc", page: 3 },
  });
});
test("capture reads only explicit app identity meta tags and omits absent or credential values", () => {
  const tags: Record<string, string> = {
    "object-id": "demo-42",
    file: "chapters/demo.tex",
    version: "v2",
    "workspace-id": "https://example.test/?token=hidden",
  };
  const sandbox: any = {
    FeedbacksUtil: { safeUrl: () => "https://example.test/editor" },
    FeedbacksFrames: {},
    location: { href: "https://example.test/editor?token=hidden" },
    innerWidth: 800,
    innerHeight: 600,
    devicePixelRatio: 1,
    scrollX: 0,
    scrollY: 0,
    document: {
      querySelector: (selector: string) => {
        const key = /feedbacks:([a-z-]+)/.exec(selector)?.[1];
        return key && tags[key] ? { content: tags[key] } : null;
      },
    },
  };
  vm.runInNewContext(
    readFileSync(
      new URL("../extension/review/anchor-evidence.js", import.meta.url),
      "utf8",
    ),
    sandbox,
  );
  const result = sandbox.FeedbacksReviewAnchors.context({ annotations: [] });
  assert.deepEqual(JSON.parse(JSON.stringify(result.reproduction)), {
    source: "app",
    objectId: "demo-42",
    file: "chapters/demo.tex",
    version: "v2",
  });
  for (const key of Object.keys(tags)) delete tags[key];
  assert.equal(
    sandbox.FeedbacksReviewAnchors.context({ annotations: [] }).reproduction,
    undefined,
  );
});
