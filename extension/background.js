import "./utils.js";
import { createReviewController } from "./review-session.js";
const U = globalThis.FeedbacksUtil;
const DEFAULT = "http://localhost:3000";
const ready = chrome.storage.local.setAccessLevel({
  accessLevel: "TRUSTED_CONTEXTS",
});
const get = async () => {
  await ready;
  return chrome.storage.local.get(null);
};
const set = async (value) => {
  await ready;
  await chrome.storage.local.set(value);
};
let polling = false,
  capturing = false,
  sending = false;
let draftWrites = Promise.resolve();
function writeDraft(work) {
  const result = draftWrites.then(work);
  draftWrites = result.catch(() => {});
  return result;
}
function requireImageRevision(draft, revision) {
  if ((draft.imageRevision || 0) !== (revision || 0))
    throw Error(
      "Redactions changed in another editor. Reload this draft before editing or sending.",
    );
}
async function api(server, operation, input, token) {
  const r = await fetch(`${server}/api/${operation}`, {
    method: "POST",
    credentials: "omit",
    redirect: "error",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(30000),
  });
  let result;
  try {
    result = await r.json();
  } catch {
    throw Object.assign(
      Error(
        `Feedbacks server returned HTTP ${r.status} without a valid API response. Check the server address and availability, then retry.`,
      ),
      { retryAfter: Number(r.headers.get("Retry-After")) || 3 },
    );
  }
  if (!r.ok || !result.ok)
    throw Object.assign(Error(result.error?.message || `Server returned ${r.status}`), {
      code: result.error?.code,
      status: r.status,
      retryAfter: Number(r.headers.get("Retry-After")) || 3,
    });
  return result.data;
}
async function authenticated(operation, input = {}, serverOverride) {
  const state = await get(),
    server = serverOverride || state.server || DEFAULT,
    account = state.accounts?.[server];
  if (!account?.token) throw Error("Connect your Feedbacks account first.");
  if (!(await chrome.permissions.contains({ origins: [server + "/*"] })))
    throw Error("Allow access to your Feedbacks server again.");
  return api(server, operation, input, account.token);
}
const review = createReviewController({
  get,
  set,
  authenticated,
  defaultServer: DEFAULT,
});
chrome.runtime.onStartup.addListener(() => review.syncInstant().catch(() => {}));
chrome.permissions.onRemoved.addListener(() => review.syncInstant().catch(() => {}));
chrome.runtime.onInstalled.addListener(async () => {
  await ready;
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: "review",
    title: "Add feedback on this page",
    contexts: ["page", "selection", "link", "image", "editable"],
  });
  await review.syncInstant();
});
async function pollPair() {
  if (polling) return;
  polling = true;
  let approved = false;
  try {
    const state = await get(),
      pair = state.pair;
    if (!pair) return;
    if (Date.parse(pair.expiresAt) <= Date.now()) {
      await chrome.storage.local.remove("pair");
      return;
    }
    if (pair.nextAt > Date.now()) return;
    try {
      const data = await api(pair.server, "pairing.poll", {
        pairingId: pair.pairingId,
        deviceSecret: pair.deviceSecret,
      });
      if (data.status === "approved" && data.token) {
        const latest = await get();
        if (latest.pair?.pairingId !== pair.pairingId) return;
        await set({
          accounts: {
            ...latest.accounts,
            [pair.server]: {
              token: data.token,
              id: data.id,
              expiresAt: data.expiresAt,
            },
          },
        });
        await chrome.storage.local.remove("pair");
        await chrome.alarms.clear("pair");
        approved = true;
      } else await set({ pair: { ...pair, nextAt: Date.now() + 3000 } });
    } catch (e) {
      await set({
        pair: {
          ...pair,
          nextAt: Date.now() + Math.max(3, e.retryAfter || 3) * 1000,
        },
      });
    }
    if (approved) await review.syncInstant();
  } finally {
    polling = false;
  }
}
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "pair") pollPair();
});
setInterval(pollPair, 3000);
async function sessionFor(sender) {
  if (!sender.tab || sender.frameId !== 0)
    throw Error("This action requires the selected review page.");
  const { sessions = {}, server = DEFAULT, accounts = {} } = await get(),
    session = sessions[sender.tab.id];
  if (
    !session ||
    new URL(sender.url).origin !== session.origin ||
    session.server !== server ||
    !accounts[server]?.token
  )
    throw Error("Open Feedbacks to reconnect this page.");
  return session;
}
async function openDraft() {
  const url = chrome.runtime.getURL("editor.html");
  const tabs = await chrome.tabs.query({ url });
  if (tabs.length) {
    await chrome.windows.update(tabs[0].windowId, { focused: true });
    await chrome.tabs.update(tabs[0].id, { active: true });
  } else await chrome.tabs.create({ url });
  return { resumed: true };
}
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    if ((await get()).draft) {
      await openDraft();
      return;
    }
    await review.activate(tab.id);
    // Native menu remains a working full-page capture fallback in inaccessible frames.
    const current = await chrome.tabs.get(tab.id);
    await writeDraft(() => capture({ tab: current, frameId: 0, url: current.url }));
  } catch {
    await chrome.action.openPopup().catch(() => {});
  }
});
async function resize(sender, mode, narrow = false) {
  await sessionFor(sender);
  if (!["mobile", "tablet", "desktop", "wide"].includes(mode))
    throw Error("Unknown size.");
  const state = await get(),
    tab = await chrome.tabs.get(sender.tab.id),
    win = await chrome.windows.get(tab.windowId);
  const bounds = state.bounds || {},
    saved = bounds[tab.id];
  if (mode === "wide") {
    if (saved) {
      await restoreWindow(tab, saved);
      delete bounds[tab.id];
      await set({ bounds });
    }
  } else {
    const metrics = await chrome.tabs.sendMessage(tab.id, { type: "metrics" });
    if (!saved) {
      bounds[tab.id] = {
        originalWindowId: tab.windowId,
        bounds: {
          left: win.left,
          top: win.top,
          width: win.width,
          height: win.height,
          state: win.state,
        },
      };
      await set({ bounds });
    }
    const width = U.widths[mode];
    if (narrow)
      await chrome.windows.create({
        tabId: tab.id,
        type: "popup",
        width,
        height: win.height,
        focused: true,
      });
    else
      await chrome.windows.update(tab.windowId, {
        state: "normal",
        width: width + Math.max(0, metrics.outerWidth - metrics.width),
      });
  }
  return { requested: U.widths[mode] || null };
}
async function restoreWindow(tab, saved) {
  let original = await chrome.windows.get(saved.originalWindowId).catch(() => null);
  if (original && original.id !== tab.windowId) {
    try {
      await chrome.tabs.move(tab.id, { windowId: original.id, index: -1 });
    } catch (error) {
      original = await chrome.windows.get(original.id).catch(() => null);
      if (original) throw error;
    }
  }
  if (!original) {
    const { left, top, width, height } = saved.bounds;
    original = await chrome.windows.create({
      tabId: tab.id,
      type: "normal",
      focused: true,
      left,
      top,
      width,
      height,
    });
  }
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(original.id, {
    ...saved.bounds,
    state: "normal",
  });
  if (saved.bounds.state && saved.bounds.state !== "normal")
    await chrome.windows.update(original.id, { state: saved.bounds.state });
}
function watchCapture(tabId, windowId) {
  let changed = false;
  const invalidate = () => {
    changed = true;
  };
  const activated = (info) => {
    if (info.windowId === windowId && info.tabId !== tabId) invalidate();
  };
  const updated = (id, change) => {
    if (id === tabId && (change.status === "loading" || "url" in change)) invalidate();
  };
  const removed = (id) => {
    if (id === tabId) invalidate();
  };
  const replaced = (_added, removedId) => removed(removedId);
  const boundsChanged = (window) => {
    if (window.id === windowId) invalidate();
  };
  const subscriptions = [
    [chrome.tabs.onActivated, activated],
    [chrome.tabs.onUpdated, updated],
    [chrome.tabs.onRemoved, removed],
    [chrome.tabs.onReplaced, replaced],
    [chrome.tabs.onDetached, removed],
    [chrome.windows.onBoundsChanged, boundsChanged],
  ];
  for (const [event, handler] of subscriptions) event.addListener(handler);
  return {
    assert() {
      if (changed)
        throw Error(
          "The review tab changed or was left during capture. Keep it active and try again.",
        );
    },
    dispose() {
      for (const [event, handler] of subscriptions) event.removeListener(handler);
    },
  };
}
async function capture(sender, retryId, pointToken = null) {
  if (capturing) throw Error("A capture is already in progress.");
  capturing = true;
  const guard = watchCapture(sender.tab.id, sender.tab.windowId);
  let pending,
    captured = false;
  try {
    const session = await sessionFor(sender),
      state = await get();
    if (retryId) pointToken = state.draft?.pointToken || null;
    if (
      state.draft &&
      (state.draft.id !== retryId || state.draft.frozen || state.draft.image)
    )
      return await openDraft();
    const tab = await chrome.tabs.get(sender.tab.id);
    guard.assert();
    if (!tab.active) throw Error("Keep the review tab active while capturing.");
    const context = await chrome.tabs.sendMessage(tab.id, {
      type: "captureContext",
      pointToken,
    });
    if (context.error) throw Error(context.error);
    if (
      retryId &&
      (!state.draft ||
        state.draft.sourceTabId !== tab.id ||
        state.draft.context.url !== context.url ||
        state.draft.server !== session.server)
    )
      throw Error(
        "The original review page changed. Send this draft without an image, or discard it and capture the new page.",
      );
    pending = {
      ...(retryId ? state.draft : {}),
      id: retryId || crypto.randomUUID(),
      server: session.server,
      projectId: state.draft?.projectId || session.projectId,
      sourceTabId: tab.id,
      context,
      image: null,
      approvedImage: null,
      body: state.draft?.body || "",
      toolState: [],
      imageRevision: (state.draft?.imageRevision || 0) + 1,
      noImage: true,
      createdAt: state.draft?.createdAt || Date.now(),
      captureError:
        "Capture did not complete. Retry capture or continue without an image.",
      pointCapture: Boolean(pointToken),
      pointToken,
    };
    // Save context before invoking native capture; rejected pixels never enter storage.
    await set({ draft: pending });
    const before = await chrome.tabs.sendMessage(tab.id, {
      type: "prepareCapture",
      pointToken,
    });
    if (before.error) throw Error(before.error);
    if (before.captureEpoch !== 0)
      throw Error("The page moved while preparing capture. Try again once it is still.");
    guard.assert();
    const pixels = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: "png",
    });
    guard.assert();
    const after = await chrome.tabs.sendMessage(tab.id, {
      type: "captureCheck",
      pointToken,
    });
    const current = await chrome.tabs.get(tab.id);
    if (
      !current.active ||
      current.windowId !== tab.windowId ||
      tab.url !== current.url ||
      before.signature !== after.signature ||
      after.captureEpoch !== 0
    )
      throw Error("The page changed during capture. Try again once it is still.");
    guard.assert();
    const bitmap = await createImageBitmap(await (await fetch(pixels)).blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height),
      ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0);
    const sx = bitmap.width / before.context.viewport.width,
      sy = bitmap.height / before.context.viewport.height;
    // Preserve visible page pixels, including forms and embedded previews.
    // Capture remains local until the reviewer explicitly sends the draft.
    before.context.captureDimensions = {
      width: bitmap.width,
      height: bitmap.height,
    };
    bitmap.close();
    const bytes = new Uint8Array(
      await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer(),
    );
    if (bytes.length > 5 * 1024 * 1024)
      throw Error(
        "This capture is too large for a safe local draft. Reduce the browser window size and capture again.",
      );
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192)
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    const draft = {
      ...pending,
      server: session.server,
      projectId: pending.projectId,
      context: before.context,
      image: "data:image/png;base64," + btoa(binary),
      body: pending.body,
      toolState:
        pending.pointCapture && before.context.anchor?.screenshotPoint
          ? [
              {
                tool: "point",
                points: [
                  {
                    x: before.context.anchor.screenshotPoint.x * sx,
                    y: before.context.anchor.screenshotPoint.y * sy,
                  },
                ],
              },
            ]
          : [],
      imageRevision: pending.imageRevision + 1,
      noImage: false,
      captureError: null,
    };
    const still = await chrome.tabs.sendMessage(tab.id, {
      type: "captureCheck",
      pointToken,
    });
    if (still.signature !== before.signature || still.captureEpoch !== 0)
      throw Error("The page moved during capture. Try again once it is still.");
    guard.assert();
    await set({ draft });
    const persisted = await chrome.tabs.sendMessage(tab.id, {
      type: "captureCheck",
      pointToken,
    });
    if (persisted.signature !== before.signature || persisted.captureEpoch !== 0)
      throw Error("The page moved during capture. Try again once it is still.");
    guard.assert();
    guard.dispose();
    if (!retryId) await chrome.tabs.create({ url: chrome.runtime.getURL("editor.html") });
    captured = true;
    return { captured: true };
  } catch (error) {
    if (pending) {
      const { draft } = await get();
      if (draft?.id === pending.id) {
        await set({
          draft: {
            ...pending,
            captureError: error.message,
            imageRevision: Math.max(pending.imageRevision, draft.imageRevision || 0) + 1,
          },
        });
        if (!retryId)
          await chrome.tabs.create({
            url: chrome.runtime.getURL("editor.html"),
          });
        return { captured: false, contextSaved: true, error: error.message };
      }
    }
    throw error;
  } finally {
    guard.dispose();
    capturing = false;
    await chrome.tabs
      .sendMessage(sender.tab.id, { type: "restore", captured, pointToken })
      .catch(() => {});
  }
}
async function saveDraft(message) {
  const { draft } = await get();
  if (!draft || draft.id !== message.id)
    throw Error("This draft has already been sent or discarded.");
  if (draft.frozen) throw Error("Submission is pending. Retry the exact approved draft.");
  requireImageRevision(draft, message.imageRevision);
  if (
    !Array.isArray(message.toolState) ||
    message.toolState.some((shape) => shape.tool === "redact")
  )
    throw Error("Redactions must be permanently saved before continuing.");
  const allowed = {
    body: String(message.body || "").slice(0, 12000),
    noImage: !draft.image || !!message.noImage,
    toolState: message.toolState,
    projectId: message.projectId,
  };
  await set({ draft: { ...draft, ...allowed } });
  return { saved: true };
}
async function redactDraft(message) {
  const { draft } = await get();
  if (!draft || draft.id !== message.id || draft.frozen || !draft.image)
    throw Error("This draft cannot be redacted. Reload it before continuing.");
  const rectangles = message.rectangles;
  if (!Array.isArray(rectangles) || !rectangles.length || rectangles.length > 1000)
    throw Error("Choose a valid redaction area.");
  const bitmap = await createImageBitmap(await (await fetch(draft.image)).blob());
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height),
    ctx = canvas.getContext("2d");
  let applied = false;
  try {
    ctx.drawImage(bitmap, 0, 0);
    ctx.fillStyle = "#202c37";
    for (const rectangle of rectangles) {
      const { x, y, width, height } = rectangle;
      if (![x, y, width, height].every(Number.isFinite) || width < 0 || height < 0)
        throw Error("Choose a valid redaction area.");
      ctx.fillRect(
        Math.floor(x),
        Math.floor(y),
        Math.ceil(width) + 1,
        Math.ceil(height) + 1,
      );
      applied = true;
    }
    const bytes = new Uint8Array(
      await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer(),
    );
    if (bytes.length > 5 * 1024 * 1024)
      throw Error("The redacted draft exceeds local storage limits.");
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192)
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    const updated = {
      ...draft,
      image: "data:image/png;base64," + btoa(binary),
      imageRevision: (draft.imageRevision || 0) + 1,
      toolState: (draft.toolState || []).filter((shape) => shape.tool !== "redact"),
    };
    await set({ draft: updated });
    return updated;
  } catch (error) {
    if (!applied) throw error;
    try {
      await chrome.storage.local.remove("draft");
    } catch {
      throw Error(
        "Redaction could not be saved or discarded. Original pixels may remain in the local draft; remove the draft before continuing.",
      );
    }
    throw Error(
      "Redaction could not be saved. The local draft was discarded to remove its original pixels.",
    );
  } finally {
    bitmap.close();
    canvas.width = canvas.height = 0;
  }
}
async function submit(message) {
  if (sending) throw Error("Submission is already in progress.");
  sending = true;
  try {
    let { draft } = await get();
    if (!draft || draft.id !== message.id) throw Error("No pending draft.");
    if (!draft.frozen) {
      requireImageRevision(draft, message.imageRevision);
      if (!draft.body.trim()) throw Error("Write a comment before sending.");
      if (!draft.noImage && !message.image?.startsWith("data:image/png;base64,"))
        throw Error("Approve the annotated screenshot first.");
      if (!draft.noImage && message.image.length > 7 * 1024 * 1024)
        throw Error(
          "The annotated image is too large. Use Send without screenshot, or discard and capture a smaller window.",
        );
      draft = {
        ...draft,
        frozen: true,
        approvedImage: draft.noImage ? null : message.image,
        image: null,
        toolState: [],
      };
      await set({ draft });
    }
    if (!draft.thread) {
      draft.thread = await authenticated(
        "threads.create",
        {
          projectId: draft.projectId,
          body: draft.body,
          context: draft.context,
          idempotencyKey: draft.id,
        },
        draft.server,
      );
      await set({ draft });
    }
    if (draft.approvedImage) {
      if (!draft.uploadAttempt) {
        draft.uploadAttempt = {
          threadId: draft.thread.id,
          revision: draft.thread.revision,
          rendition: "annotated",
          idempotencyKey: draft.id + "-image",
        };
        await set({ draft });
      }
      let result;
      try {
        result = await authenticated(
          "assets.upload",
          { ...draft.uploadAttempt, imageBase64: draft.approvedImage },
          draft.server,
        );
      } catch (error) {
        if (error.code === "CONFLICT") {
          // A confirmed revision rejection occurred before upload. Unknown
          // network outcomes retain the exact prior payload and key instead.
          draft.thread = await authenticated(
            "threads.get",
            { threadId: draft.thread.id },
            draft.server,
          );
          draft.uploadAttempt = {
            ...draft.uploadAttempt,
            revision: draft.thread.revision,
            idempotencyKey: crypto.randomUUID(),
          };
          await set({ draft });
          throw Object.assign(
            Error(
              "The thread changed. Its current revision is loaded; Retry Send will attach the same approved image.",
            ),
            { code: "CONFLICT" },
          );
        }
        throw error;
      }
      draft.thread = result.thread;
    }
    const url = `${draft.server}/threads/${draft.thread.id}`;
    await chrome.storage.local.remove("draft");
    chrome.tabs
      .sendMessage(draft.sourceTabId, {
        type: "feedbackSaved",
        fingerprint: draft.context.anchor?.fingerprint,
      })
      .catch(() => {});
    return { url, threadId: draft.thread.id };
  } finally {
    sending = false;
  }
}
async function route(message, sender) {
  const trusted =
    (!sender.tab && sender.url?.startsWith(chrome.runtime.getURL(""))) ||
    sender.url?.startsWith(chrome.runtime.getURL("editor.html")) ||
    sender.url?.startsWith(chrome.runtime.getURL("popup.html"));
  if (!trusted) {
    if (sender.tab && sender.frameId === 0 && message.type === "instantStatus") {
      const state = await get(),
        server = state.server || DEFAULT;
      return {
        enabled:
          !!state.instantReview &&
          !!state.accounts?.[server]?.token &&
          (await chrome.permissions.contains({ origins: ["<all_urls>"] })),
      };
    }
    if (sender.tab && sender.frameId === 0 && message.type === "instantStart") {
      const state = await get();
      if (
        !state.instantReview ||
        !(await chrome.permissions.contains({ origins: ["<all_urls>"] }))
      )
        throw Error("Enable instant right-click in Feedbacks first.");
      if (state.draft) return openDraft();
      await review.activate(sender.tab.id, undefined, true);
      const selected = await chrome.tabs.sendMessage(sender.tab.id, {
        type: "instantCapturePoint",
      });
      if (selected?.error || !selected?.pointToken)
        throw Error(selected?.error || "Right-click the point again.");
      return writeDraft(() => capture(sender, undefined, selected.pointToken));
    }
    const session = await sessionFor(sender);
    if (message.type === "stopReview") return review.stop(sender.tab.id);
    if (message.type === "capture")
      return writeDraft(() =>
        capture(
          sender,
          undefined,
          typeof message.pointToken === "string" ? message.pointToken : null,
        ),
      );
    if (message.type === "resize")
      return resize(sender, message.mode, message.narrow === true);
    if (message.type === "threads") {
      if (
        !message.reviewId ||
        message.reviewId !== session.reviewId ||
        message.projectId !== session.projectId
      )
        throw Error(
          "The review project changed. Refresh comments in the current review.",
        );
      const current = await chrome.tabs.get(sender.tab.id),
        url = U.safeUrl(current.url);
      const result = await authenticated(
        "threads.list",
        {
          projectId: session.projectId,
          url,
          showResolved: message.showResolved === true,
          limit: 100,
          offset: Number(message.offset) || 0,
        },
        session.server,
      );
      const latest = await sessionFor(sender);
      if (
        latest.reviewId !== session.reviewId ||
        latest.projectId !== session.projectId ||
        latest.server !== session.server
      )
        throw Error(
          "The review project changed. Refresh comments in the current review.",
        );
      return result;
    }
    if (message.type === "openThread" && /^[0-9a-f-]{36}$/.test(message.id)) {
      const thread = await authenticated(
        "threads.get",
        { threadId: message.id },
        session.server,
      );
      if (thread.projectId !== session.projectId)
        throw Error("Thread is outside this review project.");
      await chrome.tabs.create({
        url: `${session.server}/threads/${thread.id}${message.preview ? "#recorded-context" : ""}`,
      });
      return {};
    }
    throw Error("Unknown page action.");
  }
  const state = await get(),
    server = state.server || DEFAULT;
  switch (message.type) {
    case "settings":
      await pollPair();
      return {
        server,
        allowLocal: !!state.allowLocal,
        connected: !!state.accounts?.[server]?.token,
        pending: !!state.pair,
        projectId: state.projectId,
        instantReview: !!state.instantReview,
        hasDraft: !!state.draft,
        captureError: state.captureError || "",
      };
    case "projects":
      return authenticated("projects.list");
    case "draftProjects":
      if (!state.draft) throw Error("No draft.");
      return authenticated("projects.list", {}, state.draft.server);
    case "pair": {
      const origin = U.server(message.server || DEFAULT, true);
      if (!(await chrome.permissions.contains({ origins: [origin + "/*"] })))
        throw Error("Grant server permission first.");
      const pair = await api(origin, "pairing.request", {
        name: "Feedbacks Chrome extension",
      });
      const approval = new URL(pair.approvalPath, origin);
      if (approval.origin !== origin || approval.pathname !== "/pair")
        throw Error("The server returned an invalid approval address.");
      await set({
        server: origin,
        instantReview: true,
        allowLocal: true,
        pair: { ...pair, server: origin, nextAt: Date.now() + 3000 },
      });
      await chrome.alarms.create("pair", { periodInMinutes: 0.5 });
      await chrome.tabs.create({ url: approval.href });
      return {};
    }
    case "disconnect": {
      const accounts = { ...state.accounts };
      delete accounts[server];
      await set({ accounts });
      await chrome.storage.local.remove("pair");
      await review.syncInstant();
      for (const tabId of Object.keys(state.sessions || {})) {
        await chrome.tabs
          .sendMessage(Number(tabId), { type: "deactivate" })
          .catch(() => {});
        await review.stop(Number(tabId));
      }
      return {};
    }
    case "activate":
      return review.activate(message.tabId, message.projectId);
    case "enableInstant":
      return review.enableInstant(message.tabId);
    case "disableInstant":
      await set({ instantReview: false });
      await review.syncInstant();
      return {};
    case "resume":
      if (!state.draft) throw Error("There is no pending draft.");
      return openDraft();
    case "popupAction": {
      const tab = await chrome.tabs.get(message.tabId);
      if (!tab.active) throw Error("Select the website tab first.");
      const sender = { tab, frameId: 0, url: tab.url };
      if (message.action === "capture") {
        if (state.draft) return openDraft();
        await set({ captureError: "" });
        try {
          await review.activate(tab.id);
          return await writeDraft(() => capture(sender));
        } catch (error) {
          await set({ captureError: error.message });
          await chrome.action.openPopup().catch(() => {});
          throw error;
        }
      }
      await sessionFor(sender);
      if (message.action === "stop") {
        await chrome.tabs.sendMessage(tab.id, { type: "deactivate" });
        return review.stop(tab.id);
      }
      if (message.action === "narrow") return resize(sender, "mobile", true);
      if (["mobile", "tablet", "desktop", "wide"].includes(message.action))
        return resize(sender, message.action);
      if (message.action === "choose")
        return chrome.tabs.sendMessage(tab.id, { type: "choosePoint" });
      if (["pins", "resolved", "state"].includes(message.action))
        return chrome.tabs.sendMessage(tab.id, {
          type: "popupControls",
          action: message.action,
        });
      throw Error("Unknown review action.");
    }
    case "draft":
      return writeDraft(async () => (await get()).draft || null);
    case "saveDraft":
      return writeDraft(() => saveDraft(message));
    case "retryCapture":
      return writeDraft(async () => {
        const { draft } = await get();
        if (!draft || draft.id !== message.id || draft.frozen || draft.image)
          throw Error("Only a context-only draft can retry capture.");
        const tab = await chrome.tabs.get(draft.sourceTabId);
        if (U.safeUrl(tab.url) !== draft.context.url)
          throw Error(
            "The original review page changed. Continue without an image or discard this draft.",
          );
        await chrome.windows.update(tab.windowId, { focused: true });
        await chrome.tabs.update(tab.id, { active: true });
        const result = await capture(
          { tab: { ...tab, active: true }, frameId: 0, url: tab.url },
          draft.id,
        );
        if (sender.tab?.id) await chrome.tabs.update(sender.tab.id, { active: true });
        return result;
      });
    case "redactDraft":
      return writeDraft(() => redactDraft(message));
    case "discard":
      if (sending) throw Error("Wait for submission to finish.");
      return writeDraft(async () => {
        const { draft } = await get();
        await chrome.storage.local.remove("draft");
        if (draft?.pointToken)
          await chrome.tabs
            .sendMessage(draft.sourceTabId, {
              type: "discardPoint",
              pointToken: draft.pointToken,
            })
            .catch(() => {});
        return {};
      });
    case "submit":
      return writeDraft(() => submit(message));
    default:
      throw Error("Unknown extension action.");
  }
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  route(message, sender)
    .then((data) => reply({ ok: true, data }))
    .catch((e) => reply({ ok: false, error: e.message, code: e.code }));
  return true;
});
chrome.tabs.onRemoved.addListener(async (id) => {
  const state = await get();
  const sessions = { ...state.sessions };
  delete sessions[id];
  await set({ sessions });
});
