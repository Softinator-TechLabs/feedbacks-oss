import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

async function popup({
  server = "https://saved.example.test",
  managed = false,
  connected = false,
  serverAllowed = false,
  allSitesAllowed = false,
  instantReview = false,
} = {}) {
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
  let interval: (() => void) | undefined;
  let allowed = true,
    updateChecks = 0;
  const state = {
    server,
    connected,
    pending: false,
    instantReview,
  };
  const context = vm.createContext({
    URL,
    Option: class {
      name: string;
      id: string;
      constructor(name: string, id: string) {
        this.name = name;
        this.id = id;
      }
    },
    crypto,
    console,
    document: { getElementById: (id: string) => nodes[id] },
    setInterval(fn: () => void) {
      interval = fn;
    },
    window: { close() {} },
    createReleaseSelectionGate: () => ({ select: () => 1, isCurrent: () => true }),
    checkForUpdates: async () => {
      updateChecks++;
      return { status: "not-permitted", newer: false };
    },
    releaseLinks: () => ({}),
    chrome: {
      permissions: {
        contains: async (input: any) =>
          input.origins?.[0] === "<all_urls>" ? allSitesAllowed : serverAllowed,
        request: async (input: any) => {
          requested.push(JSON.parse(JSON.stringify(input)));
          return allowed;
        },
      },
      tabs: { query: async () => [{ id: 1, url: "https://review.example.test" }] },
      runtime: {
        getManifest: () => ({
          version: "0.1.9",
          ...(managed
            ? { update_url: "https://clients2.google.com/service/update2/crx" }
            : {}),
        }),
        sendMessage: async (message: any) => {
          sent.push(JSON.parse(JSON.stringify(message)));
          if (message.type === "preparePair" && allowed) {
            state.server = message.server;
            state.pending = true;
          }
          return {
            ok: true,
            data:
              message.type === "settings"
                ? state
                : message.type === "activate"
                  ? {
                      origin: "https://review.example.test",
                      project: { id: "project-1", name: "Review" },
                      choices: [{ id: "project-1", name: "Review" }],
                    }
                  : message.type === "popupAction" && message.action === "qa-scan"
                    ? { noFindings: true, checkedLinks: 4 }
                    : message.type === "popupAction" && message.action === "state"
                      ? { showPins: true, showResolved: false }
                      : {},
          };
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
  return {
    nodes,
    state,
    requested,
    sent,
    setAllowed: (value: boolean) => {
      allowed = value;
    },
    updateChecks: () => updateChecks,
    tick: async () => {
      interval?.();
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

test("popup pairs only with the entered server and keeps broad website permission explicit", async () => {
  const { nodes, state, requested, sent, setAllowed } = await popup();
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
        message.type === "preparePair" &&
        message.server === "https://chosen.example.test",
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
  setAllowed(false);
  const pairedBefore = sent.filter((message) => message.type === "finishPair").length;
  nodes.server.value = "https://denied.example.test";
  await nodes["pair-custom"].onclick();
  assert.equal(
    sent.filter((message) => message.type === "finishPair").length,
    pairedBefore,
  );
  assert.match(nodes.message.textContent, /Allow access/);
  setAllowed(true);
  nodes.server.value = "http://public.example.test";
  const permissionsBefore = requested.length;
  await nodes["pair-custom"].onclick();
  assert.equal(
    requested.length,
    permissionsBefore,
    "invalid origins fail before permission or network actions",
  );
});

test("fresh install makes no release request and requires a server before permissions", async () => {
  const { nodes, requested, sent, updateChecks } = await popup({ server: "" });
  assert.equal(nodes.server.value, "");
  assert.equal(nodes.app.hidden, true);
  assert.equal(updateChecks(), 0);
  await nodes.pair.onclick();
  assert.match(nodes.message.textContent, /Enter your team's/);
  assert.equal(requested.length, 0);
  assert.equal(
    sent.some((message) => message.type === "preparePair"),
    false,
  );
  nodes.server.value = "http://localhost:3000";
  await nodes.pair.onclick();
  assert.equal(requested.length, 0, "HTTP requires an explicit opt-in");
  nodes["allow-local"].checked = true;
  await nodes.pair.onclick();
  assert.deepEqual(requested, [{ origins: ["http://localhost:3000/*"] }]);
  assert.ok(
    sent.some((message) => message.type === "preparePair" && message.allowLocal === true),
  );
});

test("full-page capture remains a separate user action", async () => {
  const { nodes, sent } = await popup();
  await nodes["capture-full"].onclick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(
    sent.some(
      (message) => message.type === "popupAction" && message.action === "capture-full",
    ),
  );
});

test("popup separates current-tab access from optional all-site and server grants", async () => {
  const allowed = await popup({
    connected: true,
    serverAllowed: true,
    allSitesAllowed: true,
    instantReview: true,
  });
  assert.equal(allowed.nodes["server-access"].textContent, "Allowed");
  assert.equal(allowed.nodes["tab-access"].textContent, "Ready");
  assert.equal(allowed.nodes["site-access"].textContent, "On");
  assert.equal(allowed.nodes["server-access"].className, "is-ready");
  assert.equal(allowed.nodes["restore-server-access"].hidden, true);

  const revoked = await popup({ connected: true });
  assert.equal(revoked.nodes["server-access"].textContent, "Needs access");
  assert.equal(revoked.nodes["site-access"].textContent, "Off");
  assert.equal(revoked.nodes["restore-server-access"].hidden, false);
  await revoked.nodes["restore-server-access"].onclick();
  assert.deepEqual(revoked.requested, [{ origins: ["https://saved.example.test/*"] }]);
});

test("QA scan keeps an empty result in the popup without creating feedback", async () => {
  const { nodes, sent } = await popup();
  await nodes["qa-scan"].onclick();
  assert.match(nodes.message.textContent, /No findings/);
  assert.ok(
    sent.some(
      (message) => message.type === "popupAction" && message.action === "qa-scan",
    ),
  );
});

test("Chrome managed installs do not poll the server or offer manual ZIP updates", async () => {
  const { nodes, updateChecks } = await popup({ managed: true });
  assert.equal(nodes["check-updates"].hidden, true);
  assert.equal(nodes["update-notice"].hidden, true);
  assert.match(nodes["update-status"].textContent, /Chrome manages updates/);
  assert.equal(updateChecks(), 0);
});

test("typing a server persists the draft and a background refresh does not overwrite it", async () => {
  const { nodes, state, sent, tick } = await popup({ server: "" });
  nodes.server.value = "https://chosen.example.test";
  nodes.server.oninput();
  assert.ok(
    sent.some((m) => m.type === "saveServerDraft" && m.value === nodes.server.value),
  );
  state.pending = true;
  await tick();
  assert.equal(nodes.server.value, "https://chosen.example.test");
});
