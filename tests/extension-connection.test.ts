import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

test("popup pairs only with the entered server and keeps broad website permission explicit", async () => {
  const html = await readFile(
    new URL("../extension/popup.html", import.meta.url),
    "utf8",
  );
  const nodes: Record<string, any> = Object.fromEntries(
    [...html.matchAll(/id="([^"]+)"/g)].map((match) => [
      match[1],
      {
        value: "",
        textContent: "",
        hidden: false,
        disabled: false,
        removeAttribute() {},
        replaceChildren() {},
      },
    ]),
  );
  const requested: any[] = [],
    sent: any[] = [];
  let allowed = true;
  const state = {
    server: "https://saved.example.test",
    connected: false,
    pending: false,
    instantReview: false,
  };
  const context = vm.createContext({
    URL,
    console,
    document: { getElementById: (id: string) => nodes[id] },
    setInterval() {},
    window: { close() {} },
    createReleaseSelectionGate: () => ({ select: () => 1, isCurrent: () => true }),
    checkForUpdates: async () => ({ status: "not-permitted", newer: false }),
    releaseLinks: () => ({}),
    chrome: {
      permissions: {
        contains: async () => false,
        request: async (input: any) => {
          requested.push(JSON.parse(JSON.stringify(input)));
          return allowed;
        },
      },
      tabs: { query: async () => [{ id: 1, url: "https://review.example.test" }] },
      runtime: {
        getManifest: () => ({ version: "0.1.7" }),
        sendMessage: async (message: any) => {
          sent.push(JSON.parse(JSON.stringify(message)));
          if (message.type === "pair") {
            state.server = message.server;
            state.pending = true;
          }
          return { ok: true, data: message.type === "settings" ? state : {} };
        },
      },
    },
  });
  vm.runInContext(
    await readFile(new URL("../extension/utils.js", import.meta.url), "utf8"),
    context,
  );
  // Only replace module wiring; the real popup handlers and shared URL validator run.
  const source = (
    await readFile(new URL("../extension/popup.js", import.meta.url), "utf8")
  ).replace(/^import[\s\S]*?from "\.\/updates\.js";\s*/, "");
  vm.runInContext(source, context);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    nodes.server.value,
    "https://saved.example.test",
    "saved server is preserved",
  );
  nodes.server.value = "https://chosen.example.test/";
  await nodes.pair.onclick();
  assert.deepEqual(requested, [{ origins: ["https://chosen.example.test/*"] }]);
  assert.ok(
    sent.some(
      (message) =>
        message.type === "pair" && message.server === "https://chosen.example.test",
    ),
  );
  assert.equal(
    nodes.pair.disabled,
    true,
    "pending pairing cannot be repeated by a second click",
  );
  await nodes.instant.onclick();
  assert.deepEqual(requested.at(-1), { origins: ["<all_urls>"] });

  state.pending = false;
  allowed = false;
  const pairedBefore = sent.filter((message) => message.type === "pair").length;
  nodes.server.value = "https://denied.example.test";
  await nodes["pair-custom"].onclick();
  assert.equal(sent.filter((message) => message.type === "pair").length, pairedBefore);
  assert.match(nodes.message.textContent, /Allow access/);
  allowed = true;
  nodes.server.value = "http://public.example.test";
  const permissionsBefore = requested.length;
  await nodes["pair-custom"].onclick();
  assert.equal(
    requested.length,
    permissionsBefore,
    "invalid origins fail before permission or network actions",
  );
});
