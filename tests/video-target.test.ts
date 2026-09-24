import test from "node:test";
import assert from "node:assert/strict";
import { videoTarget, videoCreateInput } from "../extension/video-target.js";

const tab = {
  id: 10,
  url: "https://site.example.test/page#section-a",
  width: 1280,
  height: 800,
};
const session = {
  projectId: "project-a",
  reviewId: "review-a",
  server: "https://feedback.example.test",
};
const safeUrl = (url: string) => {
  const parsed = new URL(url);
  parsed.hash = "";
  return parsed.href;
};

test("video creation remains bound to the setup review and exact route", async () => {
  const target = await videoTarget(tab, session, safeUrl);
  assert.deepEqual(
    await videoCreateInput(target, tab, session, safeUrl, "Original comment", "key-1"),
    {
      projectId: "project-a",
      body: "Original comment",
      context: {
        url: "https://site.example.test/page",
        viewport: { width: 1280, height: 800 },
      },
      idempotencyKey: "key-1",
    },
  );
  await assert.rejects(
    videoCreateInput(
      target,
      { ...tab, url: "https://site.example.test/other" },
      session,
      safeUrl,
      "Original comment",
      "key-1",
    ),
    /review page changed/i,
  );
  await assert.rejects(
    videoCreateInput(
      target,
      { ...tab, url: "https://site.example.test/page#section-b" },
      session,
      safeUrl,
      "Original comment",
      "key-1",
    ),
    /review page changed/i,
  );
  await assert.rejects(
    videoCreateInput(
      target,
      tab,
      { ...session, projectId: "project-b" },
      safeUrl,
      "Original comment",
      "key-1",
    ),
    /review page changed/i,
  );
});
