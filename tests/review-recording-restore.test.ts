import test from "node:test";
import assert from "node:assert/strict";
import "../extension/utils.js";
import { createReviewController } from "../extension/review/review-session.js";

function fixture(t: test.TestContext) {
  const server = "https://feedback.test";
  const originalOrigin = "https://source.test";
  const redirectOrigin = "https://redirect.test";
  const session = {
    server,
    origin: originalOrigin,
    projectId: "original",
    reviewId: "review",
  };
  const target = {
    sourceTabId: 7,
    ...session,
    allowedOrigins: [originalOrigin, redirectOrigin],
  };
  const state: any = {
    server,
    accounts: { [server]: { token: "original-account-token" } },
    sessions: { 7: { ...session } },
    projectId: "preferred-project",
    siteProjects: { [`${server}|${redirectOrigin}`]: "destination" },
    reviewShortcuts: false,
    reviewDefaults: { highlightEnabled: false },
  };
  const tab = { id: 7, url: `${redirectOrigin}/next` };
  const projects: any[] = [
    {
      id: "destination",
      name: "Destination project",
      origins: [redirectOrigin],
      permissions: { canWrite: true },
    },
    {
      id: "original",
      name: "Original project",
      origins: [originalOrigin],
      permissions: { canWrite: true, canResolve: true },
    },
  ];
  const messages: any[] = [],
    injections: any[] = [],
    writes: any[] = [],
    requests: any[] = [];
  let afterProjects = () => {},
    afterInjection = () => {},
    afterCss = () => {};
  const previousChrome = (globalThis as any).chrome;
  const previousFetch = globalThis.fetch;
  (globalThis as any).chrome = {
    tabs: {
      get: async () => ({ ...tab }),
      sendMessage: async (tabId: number, message: any) => {
        messages.push({ tabId, ...message });
        return {};
      },
    },
    scripting: {
      executeScript: async (request: any) => {
        injections.push(request);
        afterInjection();
        return [];
      },
    },
    runtime: { getURL: (path: string) => `chrome-extension://fixture/${path}` },
  };
  globalThis.fetch = (async () => {
    afterCss();
    return { text: async () => "fixture-css" };
  }) as typeof fetch;
  t.after(() => {
    (globalThis as any).chrome = previousChrome;
    globalThis.fetch = previousFetch;
  });
  const controller = createReviewController({
    get: async () => structuredClone(state),
    set: async (value: any) => {
      writes.push(value);
      Object.assign(state, value);
    },
    authenticated: async (...args: any[]) => {
      requests.push(args);
      afterProjects();
      return { items: structuredClone(projects) };
    },
    defaultServer: server,
  });
  return {
    controller,
    target,
    state,
    tab,
    projects,
    messages,
    injections,
    writes,
    requests,
    server,
    originalOrigin,
    redirectOrigin,
    afterProjects: (fn: () => void) => {
      afterProjects = fn;
    },
    afterInjection: (fn: () => void) => {
      afterInjection = fn;
    },
    afterCss: (fn: () => void) => {
      afterCss = fn;
    },
  };
}

test("recording navigation restores its original project on an explicitly approved redirect without changing preferences", async (t) => {
  const f = fixture(t);
  const before = structuredClone(f.state);
  await f.controller.restoreRecording(7, f.target);
  assert.deepEqual(f.requests, [["projects.list", {}, f.server]]);
  assert.deepEqual(f.injections, [
    { target: { tabId: 7 }, files: ["utils.js", "frame-dom.js", "content.js"] },
  ]);
  assert.equal(f.messages.length, 1);
  assert.deepEqual(f.messages[0].project, {
    id: "original",
    name: "Original project",
    canResolve: true,
  });
  assert.equal(f.messages[0].reviewId, "review");
  assert.equal(f.messages[0].recordingOnly, true);
  assert.equal(f.messages[0].reviewShortcuts, false);
  assert.equal(f.messages[0].reviewDefaults.highlightEnabled, false);
  assert.equal(f.messages[0].css, "fixture-css");
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.state, before);
});

test("same-origin navigation restores ordinary review using the original-origin fallback", async (t) => {
  const f = fixture(t);
  f.tab.url = `${f.originalOrigin}/another-page`;
  const { allowedOrigins, ...target } = f.target;
  await f.controller.restoreRecording(7, target);
  assert.equal(f.messages[0].recordingOnly, false);
  assert.equal(f.messages[0].reviewId, "review");
  assert.equal(f.messages[0].project.id, "original");
  assert.deepEqual(f.writes, []);
});

for (const [label, mutate] of [
  [
    "unapproved origin",
    (f: ReturnType<typeof fixture>) => {
      f.tab.url = "https://outside.test/";
    },
  ],
  [
    "non-HTTP page",
    (f: ReturnType<typeof fixture>) => {
      f.tab.url = "file:///tmp/example";
    },
  ],
  [
    "wrong tab",
    (f: ReturnType<typeof fixture>) => {
      f.target.sourceTabId = 8;
    },
  ],
  [
    "changed server",
    (f: ReturnType<typeof fixture>) => {
      f.state.server = "https://other.test";
    },
  ],
  [
    "missing account",
    (f: ReturnType<typeof fixture>) => {
      delete f.state.accounts[f.server];
    },
  ],
  [
    "changed review",
    (f: ReturnType<typeof fixture>) => {
      f.state.sessions[7].reviewId = "replacement";
    },
  ],
  [
    "changed project",
    (f: ReturnType<typeof fixture>) => {
      f.state.sessions[7].projectId = "destination";
    },
  ],
  [
    "ended review",
    (f: ReturnType<typeof fixture>) => {
      delete f.state.sessions[7];
    },
  ],
  [
    "lost project access",
    (f: ReturnType<typeof fixture>) => {
      f.projects[1].permissions.canWrite = false;
    },
  ],
  [
    "missing original project",
    (f: ReturnType<typeof fixture>) => {
      f.projects.splice(1, 1);
    },
  ],
] as const) {
  test(`recording restoration refuses ${label}`, async (t) => {
    const f = fixture(t);
    mutate(f);
    await assert.rejects(f.controller.restoreRecording(7, f.target));
    assert.deepEqual(f.messages, []);
    assert.deepEqual(f.injections, []);
    assert.deepEqual(f.writes, []);
  });
}

for (const [label, install] of [
  [
    "URL changed during project lookup",
    (f: ReturnType<typeof fixture>) =>
      f.afterProjects(() => {
        f.tab.url = `${f.redirectOrigin}/different`;
      }),
  ],
  [
    "account changed during injection",
    (f: ReturnType<typeof fixture>) =>
      f.afterInjection(() => {
        f.state.accounts[f.server].token = "replacement-account";
      }),
  ],
  [
    "review changed during injection",
    (f: ReturnType<typeof fixture>) =>
      f.afterInjection(() => {
        f.state.sessions[7].reviewId = "replacement";
      }),
  ],
  [
    "project changed during stylesheet loading",
    (f: ReturnType<typeof fixture>) =>
      f.afterCss(() => {
        f.state.sessions[7].projectId = "destination";
      }),
  ],
] as const) {
  test(`recording restoration rechecks ${label}`, async (t) => {
    const f = fixture(t);
    install(f);
    await assert.rejects(f.controller.restoreRecording(7, f.target));
    assert.deepEqual(f.messages, []);
    assert.deepEqual(f.writes, []);
  });
}
