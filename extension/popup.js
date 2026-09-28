import { checkForUpdates, createReleaseSelectionGate, releaseLinks } from "./updates.js";

const $ = (id) => document.getElementById(id);
const send = async (message) => {
  const r = await chrome.runtime.sendMessage(message);
  if (!r.ok) throw Error(r.error);
  return r.data;
};
const manifest = chrome.runtime.getManifest();
const installedVersion = manifest.version;
const managedUpdates = Boolean(manifest.update_url);
const releaseGate = createReleaseSelectionGate();
let tab,
  refreshing = false,
  loadedConnection,
  noticeServer = "",
  activeServer = "",
  pairingPending = false,
  serverEdited = false;
let overviewTicket = 0;
async function refreshOverview() {
  const ticket = ++overviewTicket;
  $("feedback-counts").textContent = "Loading feedback…";
  $("page-feedback").removeAttribute("href");
  const scope = $("feedback-scope").value || "page";
  try {
    const result = await send({ type: "pageOverview", tabId: tab.id, scope });
    if (ticket !== overviewTicket) return;
    $("page-feedback").href = result.url;
    $("page-feedback").textContent =
      scope === "website"
        ? "View website threads"
        : scope === "view"
          ? "View threads at this size"
          : "View page threads";
    const summary = result.summary;
    $("feedback-counts").textContent = summary
      ? `${summary.points.open} open · ${summary.points.resolved} resolved${summary.points.closed ? ` · ${summary.points.closed} closed` : ""} points · ${summary.threads.total} threads (${summary.threads.closed} closed)${result.drafts ? ` · ${result.drafts} not sent` : ""}`
      : `${result.total ?? 0} threads · Update the server for point counts.`;
  } catch (error) {
    if (ticket === overviewTicket) $("feedback-counts").textContent = error.message;
  }
}
$("feedback-scope").onchange = () => void refreshOverview();
$("installed-version").textContent = `v${installedVersion}`;
$("check-updates").hidden = managedUpdates;
if (managedUpdates)
  $("update-status").textContent = "Chrome manages updates for this installation.";
const connectionKey = (state) =>
  JSON.stringify([state.server, state.connected, state.pending]);
function showAccess(id, state, label) {
  $(id).className = `is-${state}`;
  $(id).textContent = label;
}
async function recentServers() {
  const { recentServers = [] } = await chrome.storage.sync.get("recentServers");
  return Array.isArray(recentServers)
    ? recentServers.filter((value) => typeof value === "string").slice(0, 5)
    : [];
}
async function showRecentServers() {
  const servers = await recentServers();
  $("recent-servers").replaceChildren(
    ...servers.map((server) => {
      const option = document.createElement("option");
      option.value = server;
      return option;
    }),
  );
  return servers;
}
async function rememberServer(server) {
  try {
    const servers = await recentServers();
    await chrome.storage.sync.set({
      recentServers: [server, ...servers.filter((value) => value !== server)].slice(0, 5),
    });
    await showRecentServers();
  } catch {
    // Browser sync may be unavailable; a successful connection still stands.
  }
}
function hideUpdateNotice() {
  $("update-notice").hidden = true;
  $("available-version").textContent = "";
  $("download-update").removeAttribute("href");
  $("update-steps").removeAttribute("href");
}
async function refreshRelease(state, bypassCache = false, manual = false) {
  const ticket = releaseGate.select(state.server);
  if (managedUpdates || !state.server) {
    hideUpdateNotice();
    if (!managedUpdates && manual)
      $("update-status").textContent = "Connect to your Feedbacks server first.";
    return;
  }
  if (noticeServer !== state.server) {
    noticeServer = state.server;
    hideUpdateNotice();
    $("update-status").textContent = "";
  }
  const result = await checkForUpdates({
    server: state.server,
    installedVersion,
    bypassCache,
  });
  if (!releaseGate.isCurrent(ticket)) return;
  if (result.newer) {
    const links = releaseLinks(state.server, result.release);
    $("available-version").textContent =
      `Feedbacks ${result.release.version} is available`;
    $("download-update").href = links.download;
    $("update-steps").href = links.help;
    $("update-notice").hidden = false;
  } else if (result.status !== "error") hideUpdateNotice();
  if (manual) {
    $("update-status").textContent =
      result.status === "error"
        ? result.newer
          ? "Offline. Showing the last known update."
          : "Could not check right now. Review still works."
        : result.status === "not-permitted"
          ? "Connect to this server before checking."
          : result.newer
            ? `Version ${result.release.version} is ready to download.`
            : "This installed extension is up to date.";
  }
}
async function start(projectId) {
  $("routing").textContent = "Opening review…";
  $("retry").hidden = true;
  try {
    const result = await send({ type: "activate", tabId: tab.id, projectId });
    $("connection").textContent = "Review is on";
    $("connection").className = "connected";
    showAccess("tab-access", "ready", "Ready");
    $("routing").textContent =
      "Right-click a point on " + new URL(result.origin).hostname + ".";
    $("project-choice").hidden = result.choices.length < 2;
    $("project").replaceChildren(...result.choices.map((p) => new Option(p.name, p.id)));
    $("project").value = result.project.id;
    $("review-controls").hidden = false;
    $("review-title").textContent = result.project.name;
    $("review-title").title = new URL(result.origin).hostname;
    void refreshOverview();
    const controls = await send({ type: "popupAction", tabId: tab.id, action: "state" });
    const diagnostics = await send({
      type: "diagnostics",
      tabId: tab.id,
      action: "status",
    }).catch(() => ({ active: false }));
    showDiagnostics(diagnostics.active);
    $("pins").textContent = controls.showPins ? "Hide pins" : "Show pins";
    $("navigation").textContent = controls.navigationLocked
      ? "Navigation locked"
      : "Navigation allowed";
    $("navigation").setAttribute("aria-pressed", String(controls.navigationLocked));
    $("highlight").textContent = controls.highlightEnabled
      ? "Highlight on"
      : "Highlight off";
    $("highlight").setAttribute("aria-pressed", String(controls.highlightEnabled));
    $("clicks").textContent = controls.clickIndicators
      ? "Click indicators on"
      : "Click indicators off";
    $("clicks").setAttribute("aria-pressed", String(controls.clickIndicators));
    $("resolved").textContent = controls.showResolved ? "Hide resolved" : "Show resolved";
  } catch (e) {
    showAccess("tab-access", "blocked", "Not ready");
    $("routing").textContent = e.message;
    $("review-controls").hidden = true;
    $("retry").hidden = false;
  }
}
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const state = await send({ type: "settings" });
    activeServer = state.server;
    document.body.classList.toggle("is-paired", state.connected);
    loadedConnection = connectionKey(state);
    pairingPending = state.pending;
    if (!serverEdited) {
      const servers = await showRecentServers().catch(() => []);
      $("server").value = state.serverDraft || state.server || servers[0] || "";
    }
    $("server-summary").textContent = state.server
      ? `Server · ${new URL(state.server).host}`
      : "Choose a Feedbacks server";
    if (!state.connected) $("server-settings").open = true;
    $("allow-local").checked = !!state.allowLocal;
    $("app").href = state.server + "/";
    $("app").hidden = !state.server;
    $("server-help").hidden = state.connected;
    $("pair").hidden = state.connected;
    $("pair").disabled = state.pending;
    $("pair-custom").disabled = state.pending;
    $("disconnect").hidden = !state.connected && !state.pending;
    $("draft").hidden = !state.hasDraft;
    $("capture").hidden = state.hasDraft;
    $("capture-full").hidden = state.hasDraft;
    $("qa-scan").hidden = state.hasDraft;
    $("choose").hidden = state.hasDraft;
    if (state.captureError) $("message").textContent = state.captureError;
    $("project-choice").hidden = true;
    $("connection").className = "";
    $("connection").textContent = state.connected
      ? "Connected"
      : state.pending
        ? "Approve the connection in Feedbacks."
        : "Connect once to review your websites.";
    const [allSites, serverAllowed] = await Promise.all([
      chrome.permissions.contains({ origins: ["<all_urls>"] }),
      state.server
        ? chrome.permissions.contains({ origins: [state.server + "/*"] })
        : Promise.resolve(false),
    ]);
    showAccess(
      "server-access",
      !state.server ? "off" : serverAllowed ? "ready" : "blocked",
      !state.server ? "Not set" : serverAllowed ? "Allowed" : "Needs access",
    );
    showAccess(
      "site-access",
      allSites ? "ready" : "off",
      allSites ? "Allowed" : "Optional",
    );
    showAccess("tab-access", "off", "Not started");
    $("access-summary").textContent =
      !state.server || !serverAllowed ? "Needs attention" : "Ready";
    $("access-summary").className =
      !state.server || !serverAllowed ? "needs-attention" : "ready";
    document.body.classList.toggle("access-ready", !!state.server && serverAllowed);
    $("restore-server-access").hidden = !state.connected || serverAllowed;
    $("instant").hidden = !state.connected || allSites;
    $("instant-help").hidden = $("instant").hidden;
    void refreshRelease(state).catch(() => {});
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (state.connected) await start();
    else $("routing").textContent = "";
    if (state.hasDraft)
      $("routing").textContent =
        "You have an unfinished comment. Continue it before a new capture.";
  } finally {
    refreshing = false;
  }
}
function action(id, fn) {
  $(id).onclick = async () => {
    $(id).disabled = true;
    $("message").textContent = "";
    try {
      await fn();
    } catch (e) {
      $("message").textContent = e.message;
    } finally {
      $(id).disabled = ["pair", "pair-custom"].includes(id) && pairingPending;
    }
  };
}
$("server").oninput = () => {
  serverEdited = true;
  $("message").textContent = "";
  void send({ type: "saveServerDraft", value: $("server").value }).catch(() => {});
};
async function connect(server) {
  if (!server.trim()) throw Error("Enter your team's Feedbacks server address.");
  const allowLocal = $("allow-local").checked;
  server = FeedbacksUtil.server(server.trim(), allowLocal);
  const requestId = crypto.randomUUID();
  // Queue the durable background intent without awaiting: the permission request
  // must retain this click gesture, and Chrome may close the popup while granting it.
  const prepared = send({ type: "preparePair", server, allowLocal, requestId });
  prepared.catch(() => {});
  const allowed = await chrome.permissions.request({ origins: [server + "/*"] });
  await prepared;
  if (!allowed) {
    await send({ type: "cancelPair", requestId });
    throw Error("Allow access to your Feedbacks server to connect.");
  }
  await send({ type: "finishPair" });
  await rememberServer(server);
  $("server-settings").open = false;
  await refresh();
}
action("pair", () => connect($("server").value));
action("pair-custom", () => connect($("server").value));
action("restore-server-access", async () => {
  if (!activeServer) throw Error("Connect to your Feedbacks server first.");
  if (!(await chrome.permissions.request({ origins: [activeServer + "/*"] })))
    throw Error("Chrome still needs access to your Feedbacks server.");
  await refresh();
});
action("instant", async () => {
  // Permission request stays within the button gesture, before any other I/O.
  if (!(await chrome.permissions.request({ origins: ["<all_urls>"] })))
    throw Error("Not enabled. You can still click Feedbacks on each website.");
  await refresh();
});
function showDiagnostics(active) {
  $("diagnostics-start").hidden = active;
  $("diagnostics-stop").hidden = !active;
  $("diagnostics-status").textContent = active
    ? "Recording locally. Reproduce the issue, then capture this page within 5 minutes."
    : "Off. No diagnostics are being collected.";
}
for (const name of ["start", "stop"])
  action(`diagnostics-${name}`, async () => {
    const result = await send({ type: "diagnostics", tabId: tab.id, action: name });
    showDiagnostics(result.active);
  });
action("retry", () => start());
for (const id of [
  "capture",
  "capture-full",
  "qa-scan",
  "choose",
  "pins",
  "show-controls",
  "navigation",
  "highlight",
  "clicks",
  "resolved",
  "mobile",
  "tablet",
  "desktop",
  "wide",
  "narrow",
  "stop",
])
  action(id, async () => {
    if (id === "qa-scan") {
      const result = await send({ type: "popupAction", tabId: tab.id, action: id });
      if (result.noFindings)
        $("message").textContent =
          `No findings in the checked images and ${result.checkedLinks} same-origin links.`;
      else window.close();
      return;
    }
    if (id === "capture" || id === "capture-full") {
      // Close the browser popup before native capture; background work continues.
      void send({ type: "popupAction", tabId: tab.id, action: id }).catch(() => {});
      window.close();
      return;
    }
    const result = await send({ type: "popupAction", tabId: tab.id, action: id });
    if (["choose", "stop", "narrow"].includes(id)) {
      window.close();
      return;
    }
    if (id === "pins") $(id).textContent = result.showPins ? "Hide pins" : "Show pins";
    if (id === "navigation") {
      $(id).textContent = result.navigationLocked
        ? "Navigation locked"
        : "Navigation allowed";
      $(id).setAttribute("aria-pressed", String(result.navigationLocked));
    }
    if (id === "highlight") {
      $(id).textContent = result.highlightEnabled ? "Highlight on" : "Highlight off";
      $(id).setAttribute("aria-pressed", String(result.highlightEnabled));
    }
    if (id === "clicks") {
      $(id).textContent = result.clickIndicators
        ? "Click indicators on"
        : "Click indicators off";
      $(id).setAttribute("aria-pressed", String(result.clickIndicators));
    }
    if (id === "resolved")
      $(id).textContent = result.showResolved ? "Hide resolved" : "Show resolved";
    if (["mobile", "tablet", "desktop", "wide", "resolved"].includes(id))
      void refreshOverview();
  });
action("draft", async () => {
  await send({ type: "resume" });
  window.close();
});
action("record-video", async () => {
  if (!tab?.id || !/^https?:/.test(tab.url || ""))
    throw Error("Open a website before recording a tab video.");
  await send({ type: "openRecorder", tabId: tab.id });
  window.close();
});
action("disconnect", async () => {
  await send({ type: "disconnect" });
  await refresh();
});
action("check-updates", async () => {
  const state = await send({ type: "settings" });
  await refreshRelease(state, true, true);
});
$("project").onchange = () => start($("project").value);
refresh().catch((e) => {
  $("message").textContent = e.message;
});
setInterval(
  () =>
    send({ type: "settings" })
      .then((s) => {
        if (!refreshing && loadedConnection !== connectionKey(s))
          refresh().catch((e) => {
            $("message").textContent = e.message;
          });
      })
      .catch(() => {}),
  3000,
);

chrome.commands
  .getAll()
  .then((commands) => {
    const shortcut = commands.find(
      (command) => command.name === "_execute_action",
    )?.shortcut;
    $("popup-shortcut").textContent = shortcut
      ? `Start / resume review: ${shortcut}.`
      : "No review shortcut assigned. Use the pinned icon or change the shortcut.";
  })
  .catch(() => {});

action("customize-shortcuts", () =>
  chrome.tabs.create({ url: "chrome://extensions/shortcuts" }),
);
action("settings", () => chrome.runtime.openOptionsPage());

// This script also runs as a normal tab in development. Only auto-close Chrome's
// actual toolbar popup; keep the full settings and any typed server draft intact.
if (chrome.extension.getViews({ type: "popup" }).includes(window)) {
  let leaveTimer;
  document.documentElement.addEventListener("pointerleave", () => {
    leaveTimer = setTimeout(() => window.close(), 200);
  });
  document.documentElement.addEventListener("pointerenter", () =>
    clearTimeout(leaveTimer),
  );
}
