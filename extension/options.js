import { checkForUpdates, releaseLinks } from "./updates.js";
const $ = (id) => document.getElementById(id);
const manifest = chrome.runtime.getManifest();
const send = async (message) => {
  const result = await chrome.runtime.sendMessage(message);
  if (!result.ok) throw Error(result.error);
  return result.data;
};
let state,
  edited = false,
  refreshing = false;
$("version").textContent = `Version ${manifest.version}`;
function action(id, work) {
  $(id).onclick = async () => {
    $(id).disabled = true;
    $("message").textContent = "";
    $("message").dataset.kind = "";
    try {
      await work();
    } catch (error) {
      $("message").textContent = error.message;
      $("message").dataset.kind = "error";
    } finally {
      $(id).disabled = id === "connect" && state?.pending;
    }
  };
}
async function recentServers() {
  const { recentServers = [] } = await chrome.storage.sync.get("recentServers");
  return Array.isArray(recentServers)
    ? recentServers.filter((value) => typeof value === "string").slice(0, 5)
    : [];
}
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    state = await send({ type: "settings" });
    if (!edited) {
      $("server").value = state.serverDraft || state.server || "";
      $("allow-local").checked = state.allowLocal;
    }
    $("review-shortcuts").checked = state.reviewShortcuts;
    for (const input of document.querySelectorAll("[data-review-default]"))
      if (!input.disabled) {
        const value = state.reviewDefaults?.[input.dataset.reviewDefault];
        if (input instanceof HTMLSelectElement) input.value = value;
        else input.checked = value === true;
      }
    $("connection-status").textContent = state.pending
      ? "Approve the connection in Feedbacks."
      : state.connected
        ? `Connected to ${new URL(state.server).host}`
        : "Connect to your team’s Feedbacks server to get started.";
    $("connection-status").dataset.kind = state.connected ? "success" : "";
    $("connect").disabled = state.pending;
    $("disconnect").hidden = !state.connected && !state.pending;
    $("open-server").hidden = !state.server;
    if (state.server) $("open-server").href = state.server;
    const [sites, server] = await Promise.all([
      chrome.permissions.contains({ origins: ["<all_urls>"] }),
      state.server
        ? chrome.permissions.contains({ origins: [state.server + "/*"] })
        : false,
    ]);
    $("server-access").textContent = !state.server
      ? "Not set"
      : server
        ? "Allowed"
        : "Needs access";
    $("server-access").className = server ? "ready" : "";
    $("site-access").textContent = sites ? "Allowed" : "Current tab only";
    $("site-access").className = sites ? "ready" : "";
    $("grant-sites").hidden = sites;
    $("grant-server").hidden = !state.server || server;
    const servers = await recentServers().catch(() => []);
    $("recent-servers").replaceChildren(
      ...servers.map((value) => new Option(value, value)),
    );
    const commands = await chrome.commands.getAll();
    const shortcut = commands.find(
      (command) => command.name === "_execute_action",
    )?.shortcut;
    $("opening-shortcut").textContent = shortcut
      ? `Start / resume review: ${shortcut}`
      : "No shortcut assigned. It may be taken or turned off. Choose one below.";
  } finally {
    refreshing = false;
  }
}
$("server").oninput = () => {
  edited = true;
  void send({ type: "saveServerDraft", value: $("server").value }).catch((error) => {
    $("message").textContent = error.message;
  });
};
$("allow-local").onchange = () => {
  edited = true;
};
action("connect", async () => {
  if (!$("server").value.trim())
    throw Error("Enter your team’s Feedbacks server address.");
  const allowLocal = $("allow-local").checked;
  const server = FeedbacksUtil.server($("server").value.trim(), allowLocal);
  const requestId = crypto.randomUUID();
  const prepared = send({ type: "preparePair", server, allowLocal, requestId });
  prepared.catch(() => {});
  const allowed = await chrome.permissions.request({ origins: [server + "/*"] });
  await prepared;
  if (!allowed) {
    await send({ type: "cancelPair", requestId });
    throw Error("Allow access to your Feedbacks server to connect.");
  }
  await send({ type: "finishPair" });
  try {
    const servers = await recentServers();
    await chrome.storage.sync.set({
      recentServers: [server, ...servers.filter((value) => value !== server)].slice(0, 5),
    });
  } catch {
    /* Connection remains valid when Chrome sync is unavailable. */
  }
  edited = false;
  await refresh();
});
action("disconnect", async () => {
  await send({ type: "disconnect" });
  await refresh();
});
action("grant-sites", async () => {
  if (!(await chrome.permissions.request({ origins: ["<all_urls>"] })))
    throw Error("Access unchanged. You can still open Feedbacks on each website.");
  await refresh();
});
action("grant-server", async () => {
  if (!(await chrome.permissions.request({ origins: [state.server + "/*"] })))
    throw Error("Server access was not granted.");
  await refresh();
});
action("customize-shortcuts", () =>
  chrome.tabs.create({ url: "chrome://extensions/shortcuts" }),
);
action("manage-access", () =>
  chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` }),
);
$("review-shortcuts").onchange = async () => {
  try {
    await send({
      type: "saveReviewPreferences",
      reviewShortcuts: $("review-shortcuts").checked,
    });
    $("message").textContent =
      "Review preference saved. Open reviews update immediately.";
    $("message").dataset.kind = "success";
  } catch (error) {
    $("message").textContent = error.message;
    $("message").dataset.kind = "error";
    await refresh();
  }
};
for (const input of document.querySelectorAll("[data-review-default]")) {
  input.onchange = async () => {
    const keepFocus = document.activeElement === input;
    input.disabled = true;
    try {
      await send({
        type: "saveReviewPreferences",
        reviewDefaults: {
          [input.dataset.reviewDefault]:
            input instanceof HTMLSelectElement ? input.value : input.checked,
        },
      });
      $("message").textContent = "Defaults saved for your next review.";
      $("message").dataset.kind = "success";
    } catch (error) {
      $("message").textContent = error.message;
      $("message").dataset.kind = "error";
    } finally {
      input.disabled = false;
      await refresh();
      if (keepFocus && document.activeElement === document.body) input.focus();
    }
  };
}
$("check-updates").hidden = Boolean(manifest.update_url);
$("update-status").textContent = manifest.update_url
  ? "Chrome manages updates for this installation."
  : "Development build. Reload an unpacked update to keep your existing connection.";
action("check-updates", async () => {
  if (!state?.server)
    throw Error("Connect to your Feedbacks server before checking for updates.");
  $("download-update").hidden = true;
  $("update-status").textContent = "Checking…";
  const result = await checkForUpdates({
    server: state.server,
    installedVersion: manifest.version,
    bypassCache: true,
  });
  $("update-status").textContent = result.newer
    ? `Version ${result.release.version} is available.`
    : ["network", "cached"].includes(result.status)
      ? "This extension is up to date."
      : "Could not check. Review still works; check your server access and connection.";
  if (result.newer) {
    $("download-update").href = releaseLinks(state.server, result.release).download;
    $("download-update").hidden = false;
  }
});
refresh().catch((error) => {
  $("message").textContent = error.message;
});
setInterval(() => {
  if (document.visibilityState === "visible") void refresh().catch(() => {});
}, 3000);
