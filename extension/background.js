import { reviewDefaults, updateReviewDefaults } from "./review/review-preferences.js";
import { createDebuggerLease } from "./diagnostics/debugger-lease.js";
import { retireObsoleteEvidence } from "./diagnostics/cleanup.js";
import {
  cleanupPrivateDiagnosticArchives,
  PRIVATE_ARCHIVE_CLEANUP_ALARM,
} from "./diagnostics/archive.js";
import "./utils.js";
import { createReviewController } from "./review/review-session.js";
import {
  createServerSetup,
  probeFeedbacksServer,
} from "./connection/server-discovery.js";
import { createPairingCoordinator } from "./connection/pairing.js";
import {
  putPage,
  getPage,
  deletePage,
  deleteDraftPages,
  pageDataUrl,
} from "./capture/page-store.js";
import { redactInsertedImages } from "./capture/screenshot-redaction.js";
import { maskDraftDiagnostic } from "./diagnostics/diagnostic-redaction.js";
import { accountFingerprint } from "./diagnostics/identity.js";
import { createWorkerDiagnostics } from "./diagnostics/worker-capture.js";
import { formatPageQa } from "./capture/page-qa.js";
import { pageOverviewTarget } from "./capture/page-overview.js";
import { createCaptureWorkflow } from "./capture/workflow.js";
import { createSubmissionWorkflow } from "./submission/workflow.js";
import {
  summarizeMarkings,
  pagePixelSize,
  continuousDraft,
  combinedMarkings,
  combinedSections,
} from "./capture/markings.js";
import { capturedVideoTarget, captureOrigins } from "./session/session-capture.js";
import { createSessionCoordinator } from "./session/session-coordinator.js";
import { createRecordingAnnotations } from "./recordings/recording-annotations.js";
import { createRecordingControls } from "./recordings/recording-controls.js";
import {
  videoTarget,
  videoFingerprint,
  replayableVideoCreate,
  clearVideoCreateForTab,
} from "./video/video-target.js";
const U = globalThis.FeedbacksUtil;
import { DEFAULT_SERVER as DEFAULT } from "./config.js";
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
const serverSetup = createServerSetup({
  get,
  set,
  defaultServer: DEFAULT,
  normalize: U.server,
  probe: (tabId) => probeFeedbacksServer(chrome, tabId),
});
const debuggerLease = createDebuggerLease(chrome);
const recordings = createRecordingControls({
  chrome,
  sessionFor: recordingSessionFor,
  startCapture: startOffscreenVideo,
});
const sessionCapture = createSessionCoordinator({
  chrome,
  sessionFor,
  authenticated,
  ready,
  annotationImage: getRecordingPointImage,
  debuggerLease,
});
const {
  evidenceStore: diagnosticEvidenceStore,
  retireRawDiagnostics,
  captureScreenshotDiagnostics,
  runDiagnostics,
  retireIfBindingChanged,
} = createWorkerDiagnostics({
  chrome,
  sessionCapture,
  debuggerLease,
  sessionFor,
  accountIdentity: diagnosticAccountIdentity,
});
void cleanupPrivateDiagnosticArchives().catch(() => {});
async function startOffscreenVideo(sender, session) {
  const tab = await chrome.tabs.get(sender.tab.id);
  const target = {
    ...(await videoTarget(tab, session, U.safeUrl)),
    origin: new URL(tab.url).origin,
  };
  const { videoRecordingOptions = {}, recordingRedirectOrigins = {} } = await get();
  target.allowedOrigins = captureOrigins(
    target.origin,
    recordingRedirectOrigins[target.origin] || [],
  );
  const extra = target.allowedOrigins.slice(1).map((origin) => `${origin}/*`);
  if (extra.length && !(await chrome.permissions.contains({ origins: extra })))
    throw Error(
      "Allow the selected redirect sites in recording options before starting.",
    );
  const contexts = chrome.runtime.getContexts
    ? await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] })
    : [];
  if (
    contexts.some((item) =>
      item.documentUrl?.startsWith(chrome.runtime.getURL("offscreen-video.html")),
    )
  )
    await chrome.offscreen.closeDocument();
  await chrome.offscreen.createDocument({
    url: "offscreen-video.html",
    reasons: ["USER_MEDIA"],
    justification: "Record the website tab only after the user starts video feedback.",
  });
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
  const capture = await sessionCapture.start(
    target,
    {
      maskText: !!videoRecordingOptions.maskText,
      maskInputs: !!videoRecordingOptions.maskInputs,
      networkBodies: !!videoRecordingOptions.networkBodies,
    },
    "video",
    tab.id,
  );
  return {
    sourceTabId: tab.id,
    reviewId: session.reviewId,
    streamId,
    debugStarted: capture.started,
    options: {
      tabAudio: !!videoRecordingOptions.tabAudio,
      microphone: !!videoRecordingOptions.microphone,
    },
  };
}
async function getRecordingPointImage(recordingId, annotationId) {
  return pageDataUrl(await getPage(`recording-${recordingId}`, annotationId));
}
const recordingAnnotations = createRecordingAnnotations({
  chrome,
  capture: sessionCapture,
  recordings,
  readImage: getRecordingPointImage,
  async saveImage(recordingId, point, anchor, tabId) {
    if (await getPage(`recording-${recordingId}`, point.annotationId)) return;
    const source = await getPage(`point-${tabId}`, point.key);
    if (!source) throw Error("The screenshot is missing. Capture the point again.");
    if (!anchor?.viewport || !anchor?.rect || !anchor?.point)
      throw Error("The screenshot point is missing.");
    const bitmap = await createImageBitmap(source);
    try {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bitmap, 0, 0);
      const x =
        ((anchor.rect.x + anchor.rect.width * anchor.point.x) * bitmap.width) /
        anchor.viewport.width;
      const y =
        ((anchor.rect.y + anchor.rect.height * anchor.point.y) * bitmap.height) /
        anchor.viewport.height;
      if (
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        x < 0 ||
        y < 0 ||
        x > bitmap.width ||
        y > bitmap.height
      )
        throw Error("The screenshot point is outside the captured view.");
      const radius = (10 * bitmap.width) / anchor.viewport.width;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 6;
      ctx.stroke();
      ctx.strokeStyle = "#d72d49";
      ctx.lineWidth = 3;
      ctx.stroke();
      const image = await canvas.convertToBlob({ type: "image/webp", quality: 0.92 });
      if (image.size > 8 * 1024 * 1024)
        throw Error("This point screenshot is too large.");
      const capture = await sessionCapture.status();
      let totalBytes = image.size;
      for (const item of capture?.annotations || [])
        totalBytes += (await getPage(`recording-${recordingId}`, item.id))?.size || 0;
      if (totalBytes > 24 * 1024 * 1024)
        throw Error(
          "This recording has reached its 24 MiB screenshot limit. Cancel this point and send the recording.",
        );
      await putPage(`recording-${recordingId}`, point.annotationId, "source", image);
    } finally {
      bitmap.close();
    }
  },
});
let polling = false;
function captureUrl(value) {
  const url = new URL(value);
  url.hash = "";
  return url.href;
}
let lastVisibleCaptureAt = 0;
async function captureVisibleTab(windowId, beforeCapture, afterCapture) {
  // Chrome permits two visible-tab captures per second across this extension.
  const wait = 650 - (Date.now() - lastVisibleCaptureAt);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastVisibleCaptureAt = Date.now();
  const take = async () => {
    try {
      await beforeCapture?.();
      return await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
    } finally {
      await afterCapture?.();
    }
  };
  try {
    return await take();
  } catch (error) {
    if (
      !String(error?.message || error).includes(
        "MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND",
      )
    )
      throw error;
    await new Promise((resolve) => setTimeout(resolve, 1100));
    lastVisibleCaptureAt = Date.now();
    return take();
  }
}
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
    signal: AbortSignal.timeout(
      operation === "assets.uploadVideo" || operation.startsWith("diagnostics.")
        ? 180000
        : 30000,
    ),
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
const pairing = createPairingCoordinator({
  get,
  set,
  remove: (key) => chrome.storage.local.remove(key),
  contains: (permissions) => chrome.permissions.contains(permissions),
  start: async ({ server: origin, allowLocal }) => {
    const current = await get();
    if (
      current.pair?.server === origin &&
      Date.parse(current.pair.expiresAt) > Date.now()
    )
      return;
    const pair = await api(origin, "pairing.request", {
      name: "Feedbacks Chrome extension",
    });
    const approval = new URL(pair.approvalPath, origin);
    if (approval.origin !== origin || approval.pathname !== "/pair")
      throw Error("The server returned an invalid approval address.");
    await set({
      server: origin,
      instantReview: false,
      allowLocal,
      pair: { ...pair, server: origin, nextAt: Date.now() + 3000 },
    });
    await chrome.alarms.create("pair", { periodInMinutes: 0.5 });
    await chrome.tabs.create({ url: approval.href });
  },
});
chrome.permissions.onAdded.addListener(() => pairing.finish().catch(() => {}));
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
              userId: data.userId,
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
  if (a.name === PRIVATE_ARCHIVE_CLEANUP_ALARM)
    void cleanupPrivateDiagnosticArchives().catch(() => {});
});
setInterval(pollPair, 3000);
async function sessionFor(sender) {
  if (!sender.tab || sender.frameId !== 0)
    throw Error("This action requires the selected review page.");
  await ready;
  const {
      sessions = {},
      server = DEFAULT,
      accounts = {},
    } = await chrome.storage.local.get(["sessions", "server", "accounts"]),
    session = sessions[sender.tab.id];
  if (
    !session ||
    new URL(sender.url).origin !== session.origin ||
    session.server !== server ||
    (session.accountKey &&
      session.accountKey !==
        (await accountFingerprint(accounts[server], { tokenOnly: true }))) ||
    !accounts[server]?.token
  )
    throw Error("Open Feedbacks to reconnect this page.");
  return session;
}
// Only recorder controls may follow explicitly approved redirect origins. Ordinary
// review actions still use sessionFor and their original per-origin authorization.
async function recordingSessionFor(sender) {
  try {
    return await sessionFor(sender);
  } catch (error) {
    const context = await sessionCapture.contextForControls(sender);
    if (!context) throw error;
    return context.target;
  }
}
async function openDraft() {
  const { draft } = await get();
  const url =
    chrome.runtime.getURL("editor.html") +
    (draft?.captureScope === "points" ? `?draft=${draft.id}` : "");
  // Extension contexts expose our own editor tabs without a broad tabs permission.
  const tabs = chrome.runtime.getContexts
    ? (
        await chrome.runtime.getContexts({
          contextTypes: ["TAB"],
          documentUrls: [url],
        })
      ).map((context) => ({ id: context.tabId, windowId: context.windowId }))
    : await chrome.tabs.query({ url });
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
    await chrome.tabs.sendMessage(tab.id, { type: "choosePoint" });
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
function watchCapture(tabId, windowId, sourceUrl) {
  let changedReason = "";
  const invalidate = (reason) => {
    changedReason ||= reason;
  };
  const activated = (info) => {
    if (info.windowId === windowId && info.tabId !== tabId)
      invalidate("another tab became active");
  };
  const updated = (id, change) => {
    // Chrome reports "loading" when a page fetches more content while scrolling.
    // The capture checks below still reject a changed document or viewport.
    if (id === tabId && change.url && captureUrl(change.url) !== captureUrl(sourceUrl))
      invalidate("the page navigated");
  };
  const removed = (id) => {
    if (id === tabId) invalidate("the source tab closed or moved");
  };
  const replaced = (_added, removedId) => removed(removedId);
  const boundsChanged = (window) => {
    if (window.id === windowId) invalidate("the browser window resized");
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
      if (changedReason)
        throw Error(
          `Capture stopped because ${changedReason}. Return to the original tab and retry.`,
        );
    },
    dispose() {
      for (const [event, handler] of subscriptions) event.removeListener(handler);
    },
  };
}
const capture = createCaptureWorkflow({
  get,
  set,
  captureUrl,
  captureVisibleTab,
  captureProgress: (tabId, stage) =>
    chrome.tabs.sendMessage(tabId, { type: "captureProgress", stage }).catch(() => {}),
  review,
  sessionFor,
  openDraft,
  watchCapture,
  captureDiagnostics: captureScreenshotDiagnostics,
  accountIdentity: diagnosticAccountIdentity,
  deleteDiagnosticEvidence: (evidenceId) =>
    diagnosticEvidenceStore.deleteEvidence(evidenceId),
});
async function diagnosticAccountIdentity(server, expected) {
  const account = (await get()).accounts?.[server];
  if (!account?.token) return null;
  if (expected?.startsWith("token:"))
    return accountFingerprint(account, { tokenOnly: true });
  if (account.userId) return accountFingerprint(account);
  let userId;
  try {
    userId = (await authenticated("auth.me", {}, server)).actor.userId;
  } catch {
    // The same key can finish a local capture after a temporary server outage.
  }
  return accountFingerprint(account, { userId });
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
    category:
      ["general", "visualDesign", "productWorkflow", "usabilityAccessibility"].includes(
        message.category,
      ) ||
      /^custom:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
        message.category,
      )
        ? message.category
        : "general",
    tags: String(message.tags || "")
      .slice(0, 394)
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
    // Select from the saved capture; editor messages cannot replace diagnostic data.
    diagnosticsSelection: {
      console: Array.isArray(message.diagnosticsSelection?.console)
        ? message.diagnosticsSelection.console.filter(
            (n) => Number.isInteger(n) && n >= 0 && n < 25,
          )
        : [],
      network: Array.isArray(message.diagnosticsSelection?.network)
        ? message.diagnosticsSelection.network.filter(
            (n) => Number.isInteger(n) && n >= 0 && n < 50,
          )
        : [],
    },
    includeDiagnostics:
      message.includeDiagnostics === true &&
      !!(draft.diagnosticEvidence || draft.diagnostics),
    noImage: !(draft.image || draft.capturePages?.length) || !!message.noImage,
    includeCombined:
      message.includeCombined === true &&
      (draft.capturePages || []).filter((page) => !page.annotationId).length > 1,
    toolState: message.toolState,
    projectId: message.projectId,
  };
  if (message.annotations !== undefined) {
    const original = draft.context.annotations || [];
    if (
      !Array.isArray(message.annotations) ||
      message.annotations.length !== original.length ||
      message.annotations.some(
        (item, index) =>
          item?.id !== original[index].id ||
          typeof item.body !== "string" ||
          !item.body.trim() ||
          item.body.trim().length > 4000,
      )
    )
      throw Error("Point comments changed unexpectedly. Reopen the saved draft.");
    if (original.length)
      allowed.context = {
        ...draft.context,
        annotations: original.map((item, index) => ({
          ...item,
          body: message.annotations[index].body.trim(),
        })),
      };
  }
  if (draft.capturePages?.length) {
    const pageIndex = message.pageIndex;
    if (
      !Number.isInteger(pageIndex) ||
      pageIndex < 0 ||
      pageIndex >= draft.capturePages.length
    )
      throw Error("Select a valid screenshot page.");
    const pageToolStates = [...(draft.pageToolStates || [])];
    pageToolStates[pageIndex] = message.toolState;
    allowed.pageToolStates = pageToolStates;
    allowed.approvedPageIndices = [];
  }
  await set({ draft: { ...draft, ...allowed } });
  return { saved: true };
}
async function capturePage(message) {
  const { draft } = await get();
  if (!draft || draft.id !== message.id) throw Error("No pending draft.");
  const index = message.index;
  if (!Number.isInteger(index) || index < 0 || index >= (draft.capturePages?.length || 0))
    throw Error("Select a valid screenshot page.");
  const blob = await getPage(
    draft.id,
    index,
    draft.frozen && !draft.noImage ? "approved" : "source",
  );
  return { image: await pageDataUrl(blob), page: draft.capturePages[index] };
}
async function captureThumbnail(message) {
  const { draft } = await get();
  if (!draft || draft.id !== message.id) throw Error("No pending draft.");
  const index = message.index;
  if (!Number.isInteger(index) || index < 0 || index >= (draft.capturePages?.length || 0))
    throw Error("Select a valid screenshot page.");
  const blob = await getPage(
    draft.id,
    index,
    draft.frozen && !draft.noImage ? "approved" : "source",
  );
  if (!blob) throw Error("This screenshot is no longer available in this browser.");
  const bitmap = await createImageBitmap(blob);
  try {
    const width = Math.min(160, bitmap.width);
    const height = Math.max(1, Math.round((bitmap.height / bitmap.width) * width));
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);
    return {
      image: await pageDataUrl(
        await canvas.convertToBlob({ type: "image/webp", quality: 0.66 }),
      ),
    };
  } finally {
    bitmap.close();
  }
}
async function removeCapturePage(message) {
  const { draft } = await get();
  if (!draft || draft.id !== message.id || draft.frozen || !draft.capturePages?.length)
    throw Error("This screenshot cannot be removed.");
  requireImageRevision(draft, message.imageRevision);
  const index = message.index;
  if (!Number.isInteger(index) || index < 0 || index >= draft.capturePages.length)
    throw Error("Select a valid screenshot page.");
  for (let next = index + 1; next < draft.capturePages.length; next++) {
    const source = await getPage(draft.id, next, "source");
    if (!source)
      throw Error("A screenshot is missing. Reload the draft before removing pages.");
    await putPage(draft.id, next - 1, "source", source);
  }
  await deletePage(draft.id, draft.capturePages.length - 1, "source");
  for (let next = 0; next < draft.capturePages.length; next++)
    await deletePage(draft.id, next, "approved");
  const capturePages = draft.capturePages.filter((_, position) => position !== index);
  const pageToolStates = [...(draft.pageToolStates || [])];
  pageToolStates.splice(index, 1);
  const updated = {
    ...draft,
    capturePages,
    pageToolStates,
    approvedPageIndices: [],
    noImage: capturePages.length === 0,
    captureNotice: capturePages.length
      ? `${capturePages.length} selected ${capturePages.length === 1 ? "screenshot" : "screenshots"} in page order. Removed pages will not be sent.`
      : "All screenshots removed. Your page context and comment are still saved.",
    imageRevision: draft.imageRevision + 1,
  };
  await set({ draft: updated });
  return { removed: true, remaining: capturePages.length };
}
async function approveCapturePage(message) {
  const { draft } = await get();
  if (!draft || draft.id !== message.id || draft.frozen)
    throw Error("This draft cannot be approved.");
  requireImageRevision(draft, message.imageRevision);
  const index = message.index;
  if (!Number.isInteger(index) || index < 0 || index >= (draft.capturePages?.length || 0))
    throw Error("Select a valid screenshot page.");
  if (!(await getPage(draft.id, index))) throw Error("The source screenshot is missing.");
  if (!/^data:image\/(?:png|jpeg|webp);base64,/.test(message.image || ""))
    throw Error("Approve an image from the editor first.");
  const blob = await (await fetch(message.image)).blob();
  if (!blob.size || blob.size > 10 * 1024 * 1024)
    throw Error(`Screenshot ${index + 1} exceeds the server's per-image size.`);
  await putPage(draft.id, index, "approved", blob);
  if (message.imageWithoutPins) {
    if (!/^data:image\/(?:png|jpeg|webp);base64,/.test(message.imageWithoutPins))
      throw Error("The pin-free screenshot is invalid.");
    const withoutPins = await (await fetch(message.imageWithoutPins)).blob();
    if (!withoutPins.size || withoutPins.size > 10 * 1024 * 1024)
      throw Error(
        `Pin-free screenshot ${index + 1} exceeds the server's per-image size.`,
      );
    await putPage(draft.id, index, "without-pins", withoutPins);
  } else await deletePage(draft.id, index, "without-pins");
  const approvedPageIndices = [...new Set([...(draft.approvedPageIndices || []), index])];
  await set({ draft: { ...draft, approvedPageIndices } });
  return { approved: true };
}
async function redactDraft(message) {
  const { draft } = await get();
  const series = !!draft?.capturePages?.length;
  if (!draft || draft.id !== message.id || draft.frozen || (!draft.image && !series))
    throw Error("This draft cannot be redacted. Reload it before continuing.");
  const index = message.pageIndex;
  if (
    series &&
    (!Number.isInteger(index) || index < 0 || index >= draft.capturePages.length)
  )
    throw Error("Select a valid screenshot page.");
  const rectangles = message.rectangles;
  if (!Array.isArray(rectangles) || !rectangles.length || rectangles.length > 1000)
    throw Error("Choose a valid redaction area.");
  const source = series
    ? await getPage(draft.id, index)
    : await (await fetch(draft.image)).blob();
  const bitmap = await createImageBitmap(source);
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
    const blob = await canvas.convertToBlob({
      type: series ? "image/webp" : "image/png",
      quality: 0.9,
    });
    if (blob.size > (series ? 10 : 5) * 1024 * 1024)
      throw Error("The redacted screenshot exceeds the per-image size limit.");
    const sanitizedShapes = await redactInsertedImages(
      series ? draft.pageToolStates?.[index] : draft.toolState,
      rectangles,
    );
    if (series) {
      await putPage(draft.id, index, "source", blob);
      await deletePage(draft.id, index, "approved");
      const updated = {
        ...draft,
        imageRevision: (draft.imageRevision || 0) + 1,
        approvedPageIndices: [],
        // saveDraft also keeps a redundant current-page toolState. Clear it so
        // an old embedded image cannot survive there after source sanitization.
        toolState: [],
        pageToolStates: (draft.pageToolStates || []).map((shapes, page) =>
          page === index ? sanitizedShapes : shapes,
        ),
      };
      await set({ draft: updated });
      return updated;
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192)
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    const updated = {
      ...draft,
      image: "data:image/png;base64," + btoa(binary),
      imageRevision: (draft.imageRevision || 0) + 1,
      toolState: sanitizedShapes,
    };
    await set({ draft: updated });
    return updated;
  } catch (error) {
    if (!applied) throw error;
    try {
      await chrome.storage.local.remove("draft");
      if (series) await deleteDraftPages(draft.id);
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
async function redactDiagnostic(message) {
  const { draft } = await get();
  const updated = maskDraftDiagnostic(draft, message);
  await set({ draft: updated });
  return updated;
}
const submission = createSubmissionWorkflow({
  get,
  set,
  requireImageRevision,
  authenticated,
  diagnosticEvidenceStore,
  accountIdentity: diagnosticAccountIdentity,
});
const { submit } = submission;
async function route(message, sender) {
  if (["sessionEvents", "sessionBridgeLimit"].includes(message.type))
    return sessionCapture.events(message, sender);
  const trusted =
    (!sender.tab && sender.url?.startsWith(chrome.runtime.getURL(""))) ||
    sender.url?.startsWith(chrome.runtime.getURL("editor.html")) ||
    sender.url?.startsWith(chrome.runtime.getURL("video.html")) ||
    sender.url?.startsWith(chrome.runtime.getURL("session.html")) ||
    sender.url?.startsWith(chrome.runtime.getURL("popup.html")) ||
    sender.url?.startsWith(chrome.runtime.getURL("options.html"));
  if (!trusted) {
    if (message.type === "useDetectedServer" && sender.tab && sender.frameId === 0) {
      const current = await chrome.tabs.get(sender.tab.id);
      if (!sender.url || new URL(sender.url).origin !== new URL(current.url).origin)
        throw Error("Open Feedbacks on this page again.");
      const result = await serverSetup.detect(sender.tab.id);
      if (result.status === "set" || result.status === "ready")
        await chrome.runtime.openOptionsPage();
      return result;
    }
    if (sender.tab && sender.frameId === 0 && message.type === "instantStatus") {
      return { enabled: false };
    }
    if (sender.tab && sender.frameId === 0 && message.type === "instantStart")
      throw Error("Open Feedbacks to start reviewing this page.");
    if (sender.tab && sender.frameId === 0 && message.type === "freezeInstantView")
      throw Error("Open Feedbacks to start reviewing this page.");
    const session = await ([
      "recordingControl",
      "openRecorder",
      "openSessionReview",
      "recordingAnnotationBegin",
      "recordingAnnotationSave",
      "recordingAnnotationCancel",
      "recordingFreezeView",
    ].includes(message.type)
      ? recordingSessionFor(sender)
      : sessionFor(sender));
    if (message.type === "recordingAnnotationBegin")
      return recordingAnnotations.begin(sender, message);
    if (message.type === "recordingAnnotationSave")
      return recordingAnnotations.save(sender, message);
    if (message.type === "recordingAnnotationCancel")
      return recordingAnnotations.cancel(sender, message);
    if (message.type === "diagnostics") return runDiagnostics(sender, message.action);
    if (message.type === "openPageThreads") {
      const current = await chrome.tabs.get(sender.tab.id);
      const target = pageOverviewTarget(
        session.server,
        session.projectId,
        current.url,
        current.width || 1200,
        "page",
      );
      await chrome.tabs.create({ url: target.url });
      return {};
    }
    if (message.type === "openSessionReview") {
      const capture = await sessionCapture.status();
      if (
        !capture ||
        capture.recording.mode !== "session" ||
        capture.target.sourceTabId !== sender.tab.id ||
        capture.target.reviewId !== session.reviewId
      )
        throw Error("This session recording is no longer available.");
      const owner = Number.isSafeInteger(capture.target.ownerTabId)
        ? await chrome.tabs.get(capture.target.ownerTabId).catch(() => null)
        : null;
      if (owner?.url?.startsWith(chrome.runtime.getURL("session.html")))
        await chrome.tabs.update(owner.id, { active: true });
      else
        await chrome.tabs.create({
          url: chrome.runtime.getURL(`session.html?sourceTabId=${sender.tab.id}`),
        });
      return {};
    }
    if (message.type === "openRecorder") return recordings.open(sender);
    if (message.type === "recordingOptions") {
      const allowed = [
        "mode",
        "tabAudio",
        "microphone",
        "maskInputs",
        "maskText",
        "networkBodies",
      ];
      if (
        !message.options ||
        typeof message.options !== "object" ||
        Object.keys(message.options).some(
          (key) =>
            !allowed.includes(key) ||
            (key === "mode"
              ? !["video", "session"].includes(message.options[key])
              : typeof message.options[key] !== "boolean"),
        )
      )
        throw Error("Invalid recording options.");
      const current = (await get()).videoRecordingOptions || {};
      const options = { ...current, ...message.options };
      await set({ videoRecordingOptions: options });
      return options;
    }
    if (message.type === "recordingRedirects") {
      const origin = new URL(sender.tab.url).origin;
      const origins = captureOrigins(origin, message.origins);
      const extra = origins.slice(1).map((value) => `${value}/*`);
      if (extra.length && !(await chrome.permissions.contains({ origins: extra }))) {
        if (!(await chrome.permissions.request({ origins: extra })))
          throw Error(
            "Redirect sites were not authorized. Remove them or allow access before recording.",
          );
      }
      const saved = (await get()).recordingRedirectOrigins || {};
      await set({ recordingRedirectOrigins: { ...saved, [origin]: origins.slice(1) } });
      return { origins };
    }
    if (message.type === "startRecording") {
      if (message.mode === "video") return recordings.open(sender);
      if (message.mode !== "session") throw Error("Choose a recording mode.");
      const tab = await chrome.tabs.get(sender.tab.id);
      const target = {
        ...(await videoTarget(tab, session, U.safeUrl)),
        origin: new URL(tab.url).origin,
      };
      const { videoRecordingOptions = {}, recordingRedirectOrigins = {} } = await get();
      target.allowedOrigins = captureOrigins(
        target.origin,
        recordingRedirectOrigins[target.origin] || [],
      );
      const extra = target.allowedOrigins.slice(1).map((value) => `${value}/*`);
      if (extra.length && !(await chrome.permissions.contains({ origins: extra })))
        throw Error(
          "Allow the selected redirect sites in recording options before starting.",
        );
      const capture = await sessionCapture.start(
        target,
        {
          maskText: !!videoRecordingOptions.maskText,
          maskInputs: !!videoRecordingOptions.maskInputs,
          networkBodies: !!videoRecordingOptions.networkBodies,
        },
        "session",
      );
      return { state: "recording", recordingId: capture.recording.id };
    }
    if (message.type === "recordingControl") {
      const capture = await sessionCapture.status();
      if (
        capture?.active &&
        capture.target.sourceTabId === sender.tab.id &&
        capture.recording.mode === "session"
      ) {
        if (message.action !== "stop")
          throw Error("Session recording runs continuously. Stop to review.");
        const stopped = await sessionCapture.stop();
        const owner = Number.isSafeInteger(stopped.target.ownerTabId)
          ? await chrome.tabs.get(stopped.target.ownerTabId).catch(() => null)
          : null;
        if (owner?.url?.startsWith(chrome.runtime.getURL("session.html")))
          await chrome.tabs.update(owner.id, { active: true });
        else
          await chrome.tabs.create({
            url: chrome.runtime.getURL(`session.html?sourceTabId=${sender.tab.id}`),
          });
        return {};
      }
      return recordings.control(sender, message.action);
    }
    if (message.type === "freezeView" || message.type === "recordingFreezeView") {
      if (message.type === "recordingFreezeView") {
        const capture = await sessionCapture.status();
        if (
          !capture?.active ||
          capture.target.sourceTabId !== sender.tab.id ||
          capture.annotationPause?.key !== message.key
        )
          throw Error("Pause recording and select a point first.");
      }
      const tab = await chrome.tabs.get(sender.tab.id);
      if (!tab.active || tab.windowId !== sender.tab.windowId)
        throw Error("Keep the review tab active while commenting.");
      if (!/^[0-9a-f-]{36}$/.test(message.key || ""))
        throw Error("Select a point first.");
      const before = await chrome.tabs.sendMessage(tab.id, {
        type: "captureContext",
        pointToken: message.key,
      });
      const started = await chrome.tabs.sendMessage(tab.id, {
        type: "captureCheck",
        pointToken: message.key,
      });
      if (before.error || started.error) throw Error(before.error || started.error);
      const image = await captureVisibleTab(
        tab.windowId,
        async () => {
          const prepared = await chrome.tabs.sendMessage(tab.id, {
            type: "preparePointImage",
            pointToken: message.key,
          });
          if (prepared.error) throw Error(prepared.error);
        },
        () =>
          chrome.tabs
            .sendMessage(tab.id, {
              type: "pointImageCaptured",
              pointToken: message.key,
            })
            .catch(() => {}),
      );
      const after = await chrome.tabs.sendMessage(tab.id, {
        type: "captureCheck",
        pointToken: message.key,
      });
      const current = await chrome.tabs.get(tab.id);
      if (
        !current.active ||
        current.windowId !== tab.windowId ||
        current.url !== tab.url ||
        after.error ||
        started.signature !== after.signature
      )
        throw Error("The page moved before its original view could be saved.");
      await chrome.tabs.sendMessage(tab.id, {
        type: "pointImageCaptured",
        pointToken: message.key,
        image,
      });
      const bitmap = await createImageBitmap(await (await fetch(image)).blob());
      if (
        Math.abs(
          bitmap.width / before.viewport.width - bitmap.height / before.viewport.height,
        ) > 0.03
      ) {
        bitmap.close();
        throw Error(
          "The browser's captured area changed. Keep the page active and select the point again.",
        );
      }
      const snapshot = {
        key: message.key,
        viewport: before.viewport,
        scroll: before.scroll || { x: 0, y: 0 },
        capturedAt: before.capturedAt,
        width: bitmap.width,
        height: bitmap.height,
      };
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      canvas.getContext("2d").drawImage(bitmap, 0, 0);
      bitmap.close();
      await putPage(
        `point-${tab.id}`,
        message.key,
        "source",
        await canvas.convertToBlob({ type: "image/webp", quality: 0.9 }),
      );
      return { image, snapshot };
    }
    if (message.type === "openCapturedReview") {
      const { draft } = await get();
      if (!draft || draft.sourceTabId !== sender.tab.id)
        throw Error("No review is waiting to send.");
      return openDraft();
    }
    if (["pointImage", "releasePointImage"].includes(message.type)) {
      if (!/^[0-9a-f-]{36}$/.test(message.key || "")) throw Error("Invalid point image.");
      if (message.type === "releasePointImage") {
        await deletePage(`point-${sender.tab.id}`, message.key);
        return {};
      }
      const { draft } = await get();
      const index =
        draft?.sourceTabId === sender.tab.id
          ? (draft.capturePages || []).findIndex(
              (page) => page.snapshotKey === message.key,
            )
          : -1;
      return {
        image: await pageDataUrl(
          index >= 0
            ? await getPage(draft.id, index)
            : await getPage(`point-${sender.tab.id}`, message.key),
        ),
      };
    }
    if (message.type === "stopReview") {
      recordings.stop(sender.tab.id);
      await sessionCapture.retire(sender.tab.id);
      await retireRawDiagnostics(sender.tab.id);
      await chrome.tabs.sendMessage(sender.tab.id, { type: "deactivate" });
      return review.stop(sender.tab.id);
    }
    if (message.type === "capture")
      return writeDraft(() =>
        capture(
          sender,
          undefined,
          typeof message.pointToken === "string" ? message.pointToken : null,
          message.scope === "points"
            ? "points"
            : message.scope === "fullPage"
              ? "fullPage"
              : "visible",
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
      return {
        ...result,
        items: result.items.map((thread) => ({
          ...thread,
          threadUrl: `${session.server}/threads/${thread.id}`,
        })),
      };
    }
    if (message.type === "pointStatus" && /^[0-9a-f-]{36}$/.test(message.id)) {
      if (message.reviewId !== session.reviewId)
        throw Error("The review changed. Refresh page comments.");
      const thread = await authenticated(
        "threads.get",
        { threadId: message.id },
        session.server,
      );
      if (
        thread.projectId !== session.projectId ||
        U.safeUrl(thread.context.url) !== U.safeUrl(sender.tab.url)
      )
        throw Error("Point is outside this page review.");
      if (!["open", "resolved"].includes(message.state))
        throw Error("Open the thread to remove a point.");
      return authenticated(
        "threads.annotationStatus",
        {
          threadId: thread.id,
          revision: message.revision,
          annotationId: message.annotationId,
          state: message.state,
        },
        session.server,
      );
    }
    if (message.type === "resolveThread" && /^[0-9a-f-]{36}$/.test(message.id)) {
      if (message.reviewId !== session.reviewId)
        throw Error("The review changed. Refresh the page comments.");
      const thread = await authenticated(
        "threads.get",
        { threadId: message.id },
        session.server,
      );
      if (
        thread.projectId !== session.projectId ||
        U.safeUrl(thread.context.url) !== U.safeUrl(sender.tab.url)
      )
        throw Error("Thread is outside this page review.");
      if (thread.work.state === "resolved") return thread;
      return authenticated(
        "threads.status",
        { threadId: thread.id, revision: thread.revision, state: "resolved" },
        session.server,
      );
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
    case "detectServer":
      return serverSetup.detect(message.tabId);
    case "settings":
      await pollPair();
      return {
        server,
        serverDraft: state.serverDraft,
        allowLocal: !!state.allowLocal,
        reviewShortcuts: state.reviewShortcuts !== false,
        reviewDefaults: reviewDefaults(state.reviewDefaults),
        connected: !!state.accounts?.[server]?.token,
        pending: !!state.pair,
        projectId: state.projectId,
        instantReview: !!state.instantReview,
        hasDraft: !!state.draft,
        captureError: state.captureError || state.pairError || "",
      };
    case "saveReviewPreferences": {
      const work = preferencesWrite
        .catch(() => {})
        .then(async () => {
          const latest = await get();
          const reviewShortcuts =
            typeof message.reviewShortcuts === "boolean"
              ? message.reviewShortcuts
              : latest.reviewShortcuts !== false;
          const defaults =
            message.reviewDefaults === undefined
              ? reviewDefaults(latest.reviewDefaults)
              : updateReviewDefaults(latest.reviewDefaults, message.reviewDefaults);
          await set({ reviewShortcuts, reviewDefaults: defaults });
          await Promise.all(
            Object.keys(latest.sessions || {}).map((tabId) =>
              chrome.tabs
                .sendMessage(Number(tabId), {
                  type: "reviewPreferences",
                  reviewShortcuts,
                })
                .catch(() => {}),
            ),
          );
          return {};
        });
      preferencesWrite = work;
      return work;
    }
    case "projects":
      return authenticated("projects.list");
    case "pageOverview": {
      const tab = await chrome.tabs.get(message.tabId);
      const sender = { tab, frameId: 0, url: tab.url };
      const session = await sessionFor(sender);
      const controls = await chrome.tabs.sendMessage(tab.id, {
        type: "popupControls",
        action: "state",
      });
      const target = pageOverviewTarget(
        session.server,
        session.projectId,
        tab.url,
        controls.viewport?.width || tab.width || 1200,
        message.scope,
      );
      const result = await authenticated(
        "threads.list",
        {
          projectId: session.projectId,
          ...target.filters,
          showResolved: true,
          includeSummary: true,
          limit: 1,
        },
        session.server,
      );
      const latest = await sessionFor(sender);
      const current = await chrome.tabs.get(tab.id);
      if (
        latest.reviewId !== session.reviewId ||
        latest.projectId !== session.projectId ||
        latest.server !== session.server ||
        U.safeUrl(current.url) !== U.safeUrl(tab.url)
      )
        throw Error("The page or project changed. Open Feedbacks again.");
      return {
        ...target,
        summary: result.summary,
        total: result.total,
        drafts: controls.drafts || 0,
      };
    }
    case "openSessionRecorder": {
      const tab = await chrome.tabs.get(message.tabId);
      if (!tab.active) throw Error("Select the review tab first.");
      const session = await sessionFor({ tab, frameId: 0, url: tab.url });
      const target = {
        ...(await videoTarget(tab, session, U.safeUrl)),
        origin: new URL(tab.url).origin,
      };
      const { videoRecordingOptions = {}, recordingRedirectOrigins = {} } =
        await chrome.storage.local.get([
          "videoRecordingOptions",
          "recordingRedirectOrigins",
        ]);
      target.allowedOrigins = captureOrigins(
        target.origin,
        recordingRedirectOrigins[target.origin] || [],
      );
      const capture = await sessionCapture.start(
        target,
        {
          maskText: !!videoRecordingOptions.maskText,
          maskInputs: !!videoRecordingOptions.maskInputs,
          networkBodies: !!videoRecordingOptions.networkBodies,
        },
        "session",
      );
      return { state: "recording", recordingId: capture.recording.id };
    }
    case "sessionContext": {
      const existing = await sessionCapture.status();
      if (existing) return existing;
      const tab = await chrome.tabs.get(message.sourceTabId);
      const session = await sessionFor({ tab, frameId: 0, url: tab.url });
      return {
        target: {
          ...(await videoTarget(tab, session, U.safeUrl)),
          origin: new URL(tab.url).origin,
        },
      };
    }
    case "sessionStart":
      return sessionCapture.start(
        message.target,
        message.privacy,
        message.mode === "video" ? "video" : "session",
        sender.tab?.id,
      );
    case "sessionHealth":
      return sessionCapture.health();
    case "recordingAnnotations":
      return recordingAnnotations.list();
    case "recordingAnnotationsClear":
      if (!/^[0-9a-f-]{36}$/.test(message.recordingId || ""))
        throw Error("Invalid recording.");
      await deleteDraftPages(`recording-${message.recordingId}`);
      return {};
    case "sessionStatus":
      return sessionCapture.status();
    case "sessionStop":
      return sessionCapture.stop();
    case "sessionDiscard": {
      const capture = await sessionCapture.status();
      await sessionCapture.discard();
      if (capture) await deleteDraftPages(`recording-${capture.recording.id}`);
      return {};
    }
    case "sessionSubmit": {
      const capture = await sessionCapture.status();
      const owner =
        capture?.recording.mode === "video" &&
        capture.target.ownerTabId !== sender.tab?.id
          ? recordings.reviewOwner(
              sender.tab?.id,
              capture.target.sourceTabId,
              capture.target.reviewId,
            )
          : sender.tab?.id;
      const result = await sessionCapture.submit(message, owner);
      if (capture?.recording.mode === "session")
        await deleteDraftPages(`recording-${capture.recording.id}`).catch(() => {});
      return result;
    }
    case "sessionCoverage":
      return sessionCapture.annotate(message.channel, message.detail);
    case "videoCaptureHandle": {
      const target = recordings.target(sender.tab?.id, message.target);
      const handle = crypto.randomUUID();
      await chrome.scripting.executeScript({
        target: { tabId: target.sourceTabId },
        world: "MAIN",
        func: (handle, origin) => {
          if (!navigator.mediaDevices?.setCaptureHandleConfig)
            throw Error(
              "This Chrome version cannot verify the selected video tab. Turn off debug context to record video only.",
            );
          navigator.mediaDevices.setCaptureHandleConfig({
            handle,
            exposeOrigin: true,
            permittedOrigins: [origin],
          });
        },
        args: [handle, chrome.runtime.getURL("").replace(/\/$/, "")],
      });
      const tab = await chrome.tabs.get(target.sourceTabId);
      return { handle, origin: new URL(tab.url).origin };
    }
    case "videoStreamId": {
      if (
        !sender.tab?.id ||
        !sender.url?.startsWith(chrome.runtime.getURL("video.html?")) ||
        !Number.isSafeInteger(message.sourceTabId)
      )
        throw Error("Open the recorder from the selected website tab.");
      const recorderUrl = new URL(sender.url);
      if (
        recorderUrl.searchParams.get("autoStart") !== "1" ||
        Number(recorderUrl.searchParams.get("sourceTabId")) !== message.sourceTabId
      )
        throw Error("Recording tab context changed.");
      const tab = await chrome.tabs.get(message.sourceTabId);
      const session = await sessionFor({ tab, frameId: 0, url: tab.url });
      if (session.reviewId !== recorderUrl.searchParams.get("reviewId"))
        throw Error("The page review changed. Start a new recording.");
      return {
        streamId: await chrome.tabCapture.getMediaStreamId({
          targetTabId: tab.id,
          consumerTabId: sender.tab.id,
        }),
      };
    }
    case "openRecorder": {
      const tab = await chrome.tabs.get(message.tabId);
      if (!tab.active) throw Error("Select the review tab first.");
      return recordings.open({ tab, frameId: 0, url: tab.url });
    }
    case "videoContext": {
      const tab = await chrome.tabs.get(message.sourceTabId);
      const session = await recordingSessionFor({ tab, frameId: 0, url: tab.url });
      const projects = await authenticated("projects.list");
      const capture = await sessionCapture.status();
      const original =
        capture?.target.sourceTabId === tab.id &&
        capture.target.reviewId === session.reviewId
          ? capture.target
          : null;
      const startingTarget = original
        ? Object.fromEntries(
            [
              "sourceTabId",
              "projectId",
              "reviewId",
              "server",
              "url",
              "viewport",
              "routeFingerprint",
            ].map((key) => [key, original[key]]),
          )
        : await videoTarget(tab, session, U.safeUrl);
      const target = recordings.bindTarget(sender.tab?.id, startingTarget);
      const { recordingRedirectOrigins = {} } = await chrome.storage.local.get(
        "recordingRedirectOrigins",
      );
      const origin = new URL(tab.url).origin;
      return {
        project: projects.items.find((project) => project.id === session.projectId),
        ...target,
        allowedOrigins:
          original?.allowedOrigins ||
          captureOrigins(origin, recordingRedirectOrigins[origin] || []),
      };
    }
    case "videoCreate": {
      if (
        !sender.tab?.id ||
        !sender.url?.startsWith(chrome.runtime.getURL("video.html?"))
      )
        throw Error("Open this page from the Feedbacks recorder.");
      if (message.server !== server)
        throw Error("The connection changed. Open Feedbacks again.");
      if (typeof message.body !== "string" || !message.body.trim())
        throw Error("Write a comment before sharing the video.");
      const account = state.accounts?.[message.server];
      if (!account?.token) throw Error("Connect your Feedbacks account first.");
      return replayableVideoCreate(
        message,
        chrome.storage.session,
        await videoFingerprint(account.token),
        async () => {
          // A recording spans navigation. Use the worker-owned starting context,
          // bound to this recorder and review; current server grants still apply.
          const bound = recordings.target(sender.tab.id, message.target);
          const target =
            capturedVideoTarget(
              await sessionCapture.status(),
              message.target,
              bound.sourceTabId,
              await videoFingerprint(account.token),
            ) || bound;
          return {
            projectId: target.projectId,
            body: message.body,
            context: { url: target.url, viewport: target.viewport },
            idempotencyKey: message.idempotencyKey,
          };
        },
        (input) => authenticated("threads.create", input, message.server),
        sender.tab.id,
      );
    }
    case "sessionFrameUpload":
      if (message.server !== server)
        throw Error("The connection changed. Open Feedbacks again.");
      if (!sender.url?.startsWith(chrome.runtime.getURL("video.html?")))
        throw Error("Open the video recorder to save frames.");
      return authenticated("assets.upload", message.input, message.server);
    case "videoUpload":
      if (message.server !== server)
        throw Error("The connection changed. Open Feedbacks again.");
      return authenticated("assets.uploadVideo", message.input, message.server);
    case "videoThread":
      if (message.server !== server)
        throw Error("The connection changed. Open Feedbacks again.");
      return authenticated("threads.get", { threadId: message.threadId }, message.server);
    case "draftProjects":
      if (!state.draft) throw Error("No draft.");
      return authenticated("projects.list", {}, state.draft.server);
    case "saveServerDraft": {
      if (typeof message.value !== "string" || message.value.length > 2048)
        throw Error("Server address is too long.");
      await serverSetup.run(() => set({ serverDraft: message.value }));
      return {};
    }
    case "preparePair": {
      const origin = U.server(message.server || DEFAULT, message.allowLocal === true);
      if (
        typeof message.requestId !== "string" ||
        !/^[a-f0-9-]{36}$/.test(message.requestId)
      )
        throw Error("Invalid connection request.");
      return serverSetup.run(() =>
        pairing.prepare({
          server: origin,
          allowLocal: message.allowLocal === true,
          requestId: message.requestId,
        }),
      );
    }
    case "finishPair":
      return pairing.finish();
    case "cancelPair":
      return pairing.cancel(message.requestId);
    case "disconnect": {
      await pairing.cancel(state.pairIntent?.requestId);
      await chrome.storage.local.remove("pairError");
      const accounts = { ...state.accounts };
      delete accounts[server];
      await set({ accounts });
      await chrome.storage.local.remove("pair");
      await review.syncInstant();
      for (const tabId of Object.keys(state.sessions || {})) {
        recordings.stop(Number(tabId));
        await sessionCapture.retire(Number(tabId));
        await retireRawDiagnostics(Number(tabId));
        await chrome.tabs
          .sendMessage(Number(tabId), { type: "deactivate" })
          .catch(() => {});
        await review.stop(Number(tabId));
      }
      return {};
    }
    case "diagnostics": {
      const tab = await chrome.tabs.get(message.tabId);
      return runDiagnostics({ tab, frameId: 0, url: tab.url }, message.action);
    }
    case "activate": {
      const result = await review.activate(message.tabId, message.projectId);
      const { sessions = {} } = await chrome.storage.local.get("sessions");
      const currentSession = sessions[message.tabId];
      const reviewId = currentSession?.reviewId;
      await retireIfBindingChanged(message.tabId, currentSession, reviewId);
      if (!(await sessionCapture.restore(message.tabId, reviewId))) {
        // Validate the bound review before restoring the native recorder clock.
        const state = recordings.state(message.tabId, reviewId);
        if (state === "idle")
          await chrome.tabs
            .sendMessage(message.tabId, {
              type: "recordingState",
              mode: "video",
              state: "idle",
              elapsedMs: 0,
            })
            .catch(() => {});
        else await recordings.restore(message.tabId);
      }
      return result;
    }
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
      if (message.action === "qa-scan") {
        if (state.draft) return openDraft();
        await review.activate(tab.id);
        return writeDraft(async () => {
          const scan = await chrome.tabs.sendMessage(tab.id, { type: "qaScan" });
          if (scan.error) throw Error(scan.error);
          const body = formatPageQa(scan, tab.url);
          if (!body) return { noFindings: true, checkedLinks: scan.checkedLinks };
          return capture(sender, undefined, null, "visible", body);
        });
      }
      if (["capture", "capture-full"].includes(message.action)) {
        if (state.draft) return openDraft();
        await set({ captureError: "" });
        try {
          await review.activate(tab.id);
          return await writeDraft(() =>
            capture(
              sender,
              undefined,
              null,
              message.action === "capture-full" ? "fullPage" : "visible",
            ),
          );
        } catch (error) {
          await set({ captureError: error.message });
          await chrome.action.openPopup().catch(() => {});
          throw error;
        }
      }
      await sessionFor(sender);
      if (message.action === "stop") {
        recordings.stop(tab.id);
        await sessionCapture.retire(tab.id);
        await retireRawDiagnostics(tab.id);
        await chrome.tabs.sendMessage(tab.id, { type: "deactivate" });
        return review.stop(tab.id);
      }
      if (message.action === "narrow") return resize(sender, "mobile", true);
      if (["mobile", "tablet", "desktop", "wide"].includes(message.action))
        return resize(sender, message.action);
      if (message.action === "choose")
        return chrome.tabs.sendMessage(tab.id, { type: "choosePoint" });
      if (
        [
          "pins",
          "resolved",
          "state",
          "show-controls",
          "navigation",
          "highlight",
          "clicks",
        ].includes(message.action)
      )
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
    case "capturePage":
      return capturePage(message);
    case "captureThumbnail":
      return captureThumbnail(message);
    case "removeCapturePage":
      return writeDraft(() => removeCapturePage(message));
    case "approveCapturePage":
      return writeDraft(() => approveCapturePage(message));
    case "retryCapture":
      return writeDraft(async () => {
        const { draft } = await get();
        if (
          !draft ||
          draft.id !== message.id ||
          draft.frozen ||
          draft.image ||
          (draft.capturePages?.length && !draft.captureError)
        )
          throw Error("Only a context-only draft can retry capture.");
        const tab = await chrome.tabs.get(draft.sourceTabId);
        if (U.safeUrl(tab.url) !== draft.context.url)
          throw Error(
            "The original review page changed. Continue without an image or discard this draft.",
          );
        await chrome.windows.update(tab.windowId, { focused: true });
        await chrome.tabs.update(tab.id, { active: true });
        await new Promise((resolve) => setTimeout(resolve, 700));
        const result = await capture(
          { tab: { ...tab, active: true }, frameId: 0, url: tab.url },
          draft.id,
        );
        if (sender.tab?.id) await chrome.tabs.update(sender.tab.id, { active: true });
        return result;
      });
    case "redactDraft":
      return writeDraft(() => redactDraft(message));
    case "redactDiagnostic":
      return writeDraft(() => redactDiagnostic(message));
    case "discard":
      if (submission.isSending()) throw Error("Wait for submission to finish.");
      return writeDraft(async () => {
        const { draft } = await get();
        if (draft?.diagnosticEvidence?.evidenceId)
          await diagnosticEvidenceStore.deleteEvidence(
            draft.diagnosticEvidence.evidenceId,
          );
        if (draft)
          await retireObsoleteEvidence(
            draft,
            (id) => diagnosticEvidenceStore.deleteEvidence(id),
            async () => set({ draft }),
          );
        if (draft?.capturePages?.length) await deleteDraftPages(draft.id);
        if (draft?.sourceTabId) {
          await deleteDraftPages(`point-${draft.sourceTabId}`);
          await chrome.tabs
            .sendMessage(draft.sourceTabId, { type: "discardDraftPoints" })
            .catch(() => {});
        }
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
  await retireRawDiagnostics(id).catch(() => {});
  recordings.stop(id);
  await clearVideoCreateForTab(chrome.storage.session, id);
  await deleteDraftPages(`point-${id}`);
  const state = await get();
  const sessions = { ...state.sessions };
  delete sessions[id];
  await set({ sessions });
});
chrome.tabs.onUpdated.addListener((id, change, tab) => {
  if (
    change.status === "loading" ||
    (change.url && !change.url.startsWith(chrome.runtime.getURL("video.html")))
  ) {
    // The native tab stream continues across navigation. Page controls can be
    // restored for the original project on explicitly approved recording origins.
    clearVideoCreateForTab(chrome.storage.session, id).catch(() => {});
    deleteDraftPages(`point-${id}`).catch(() => {});
  }
  if (change.status === "complete") {
    void (async () => {
      await recordingAnnotations.recoverNavigation({
        tab: { id },
        frameId: 0,
        url: tab.url,
      });
      const nativeActive = ["starting", "recording", "paused", "stopping"].includes(
        recordings.state(id),
      );
      const context = await sessionCapture
        .contextForControls({ tab: { id }, frameId: 0, url: tab.url })
        .catch(() => null);
      if (context && (context.active || nativeActive)) {
        await review.restoreRecording(id, context.target);
        if (context.mode === "session")
          await sessionCapture.restore(id, context.target.reviewId);
        else await recordings.restore(id);
        return;
      }
      if (!nativeActive) return;
      const { sessions = {} } = await get();
      const session = sessions[id];
      if (!session || new URL(tab.url).origin !== session.origin) return;
      await review.activate(id, session.projectId);
      await recordings.restore(id);
    })().catch((error) => {
      void sessionCapture
        .annotate(
          "controls",
          `Recording controls could not be restored on this page: ${error.message}`,
        )
        .catch(() => {});
    });
  }
});

let preferencesWrite = Promise.resolve();
