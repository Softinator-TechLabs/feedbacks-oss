import test from "node:test";
import assert from "node:assert/strict";
import {
  videoTarget,
  videoCreateInput,
  replayableVideoCreate,
} from "../extension/video-target.js";

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

test("a validated create replays unchanged after lost acknowledgement and tab closure", async () => {
  const saved = new Map<string, any>();
  const storage = {
    get: async (key: string) => ({ [key]: saved.get(key) }),
    set: async (items: Record<string, any>) => {
      for (const [key, value] of Object.entries(items)) saved.set(key, value);
    },
    remove: async (key: string) => {
      saved.delete(key);
    },
  };
  const message = {
    sourceTabId: tab.id,
    server: session.server,
    target: await videoTarget(tab, session, safeUrl),
    body: "Original comment",
    idempotencyKey: "12345678-1234-4234-8234-123456789abc",
  };
  let currentTab: typeof tab | null = tab;
  let validations = 0;
  const validate = async () => {
    validations++;
    if (!currentTab) throw Error("Tab closed");
    return videoCreateInput(
      message.target,
      currentTab,
      session,
      safeUrl,
      message.body,
      message.idempotencyKey,
    );
  };
  const calls: any[] = [];
  const expirations: string[] = [];
  const create = async (input: any) => {
    calls.push(structuredClone(input));
    if (calls.length === 1) throw Error("Response lost after commit");
    return { id: "thread-1" };
  };
  await assert.rejects(
    replayableVideoCreate(
      message,
      storage,
      "account-a",
      validate,
      create,
      async (key: string) => {
        expirations.push(key);
      },
    ),
    /Response lost/,
  );
  currentTab = { ...tab, url: "https://site.example.test/another-page", width: 960 };
  assert.deepEqual(
    await replayableVideoCreate(message, storage, "account-a", validate, create),
    { id: "thread-1" },
  );
  currentTab = null;
  assert.deepEqual(
    await replayableVideoCreate(message, storage, "account-a", validate, create),
    { id: "thread-1" },
  );
  assert.equal(validations, 1);
  assert.deepEqual(expirations, [`videoCreate:${message.idempotencyKey}`]);
  assert.deepEqual(calls[1], calls[0]);
  assert.deepEqual(calls[2], calls[0]);
  await assert.rejects(
    replayableVideoCreate(
      { ...message, body: "Changed" },
      storage,
      "account-a",
      validate,
      create,
    ),
    /original request/i,
  );
  await assert.rejects(
    replayableVideoCreate(message, storage, "account-b", validate, create),
    /account changed/i,
  );
  saved.clear();
  await assert.rejects(
    replayableVideoCreate(message, storage, "account-a", validate, create),
    /Tab closed/,
  );
  assert.equal(calls.length, 3);
});
