import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error Native extension JavaScript.
import {
  createServerSetup,
  probeFeedbacksServer,
} from "../extension/connection/server-discovery.js";
import "../extension/utils.js";

function fixture(initial = {}, detected = "https://feedback.example.test") {
  let state: any = initial;
  const setup = createServerSetup({
    get: async () => state,
    set: async (value: any) => {
      state = { ...state, ...value };
    },
    probe: async () => detected,
    normalize: (value: string, local: boolean) =>
      (globalThis as any).FeedbacksUtil.server(value, local),
  });
  return { setup, state: () => state };
}
test("active Feedbacks server is saved only into an empty configuration", async () => {
  const f = fixture();
  assert.equal((await f.setup.detect(1)).status, "set");
  assert.equal(f.state().server, "https://feedback.example.test");
  assert.equal(f.state().serverDraft, f.state().server);
  assert.equal(f.state().accounts, undefined);
  for (const initial of [
    { server: "https://other.test" },
    { serverDraft: "typing" },
    { pair: {} },
    { pairIntent: {} },
  ]) {
    const saved = fixture(initial);
    assert.equal((await saved.setup.detect(1)).status, "unchanged");
    assert.deepEqual(saved.state(), initial);
  }
});
test("ordinary sites, errors and insecure servers are not saved", async () => {
  for (const origin of [
    "",
    "http://public.example.test",
    "http://localhost:3000",
    "https://user:pass@host.test",
    "https://host.test/path",
  ]) {
    const f = fixture({}, origin);
    assert.equal((await f.setup.detect(1)).status, "unavailable");
    assert.deepEqual(f.state(), {});
  }
});
test("manual input arriving during detection wins", async () => {
  let resolve: (value: string) => void = () => {};
  let state: any = {};
  const setup = createServerSetup({
    get: async () => state,
    set: async (v: any) => {
      state = { ...state, ...v };
    },
    normalize: (v: string) => v,
    probe: () =>
      new Promise<string>((r) => {
        resolve = r;
      }),
  });
  const detection = setup.detect(1);
  await setup.run(async () => {
    state.serverDraft = "https://chosen.test";
  });
  resolve("https://detected.test");
  assert.equal((await detection).status, "unchanged");
  assert.equal(state.server, undefined);
});
test("discovery checks the active document origin again after injection", async () => {
  let url = "https://feedback.example.test/help";
  const chrome = {
    tabs: { get: async () => ({ url }) },
    scripting: {
      executeScript: async () => {
        url = "https://different.test/";
        return [{ frameId: 0, result: "https://feedback.example.test" }];
      },
    },
  };
  assert.equal(await probeFeedbacksServer(chrome, 1), "");
});

test("in-page discovery accepts only the product marker and installs one status-only bridge", async () => {
  const vm = await import("node:vm");
  // @ts-expect-error Native extension JavaScript.
  const { inspectFeedbacksPage } = await import(
    "../extension/connection/server-discovery.js"
  );
  for (const identity of [
    { product: "feedbacks", setupVersion: 1 },
    { product: "other", setupVersion: 1 },
    { product: "feedbacks", setupVersion: 2 },
  ]) {
    const requests: any[] = [];
    const listeners: any[] = [];
    const context = vm.createContext({
      location: { origin: "https://feedback.example.test" },
      AbortSignal,
      fetch: async (url: string, options: any) => {
        requests.push({ url, options });
        return {
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => identity,
        };
      },
      window: { addEventListener: (...args: any[]) => listeners.push(args) },
    });
    const run = () => vm.runInContext(`(${inspectFeedbacksPage.toString()})()`, context);
    const result = await run();
    const valid = identity.product === "feedbacks" && identity.setupVersion === 1;
    assert.equal(result, valid ? "https://feedback.example.test" : "");
    await run();
    assert.equal(listeners.length, valid ? 1 : 0);
    assert.equal(requests[0].options.credentials, "omit");
    assert.equal(requests[0].options.redirect, "error");
  }
});
