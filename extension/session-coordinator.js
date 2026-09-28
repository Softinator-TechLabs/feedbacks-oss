import {
  createCaptureStore,
  captureUrl,
  sanitizeCapture,
  clipRecording,
  CAPTURE_BATCH_BYTES,
  captureByteLength,
  CAPTURE_MAX_BYTES,
  CAPTURE_SNAPSHOT_BYTES,
  captureOrigins,
  originAllowed,
} from "./session-capture.js";
import { createSessionStorage } from "./session-storage.js";
import { videoFingerprint } from "./video-target.js";
import { installSessionBridge } from "./session-bridge.js";

// CDP previews are passive values captured by Chrome; never invoke getters or
// evaluate page objects. Rewrite property-name DTOs so credential redaction applies.
export function consoleArgument(argument) {
  if (Object.hasOwn(argument, "value")) return sanitizeCapture(argument.value);
  if (argument.unserializableValue)
    return String(argument.unserializableValue).slice(0, 2000);
  const preview = (value, depth = 0) => {
    const properties = Object.create(null);
    if (depth < 3)
      for (const item of (value.properties || []).slice(0, 50)) {
        const name = String(item.name).slice(0, 160);
        properties[name] = item.valuePreview
          ? preview(item.valuePreview, depth + 1)
          : item.value !== undefined
            ? String(item.value).slice(0, 2000)
            : `[${item.type || "unavailable"}]`;
      }
    return {
      properties,
      truncated: !!value.overflow || (value.properties?.length || 0) > 50 || depth >= 3,
    };
  };
  return sanitizeCapture({
    type: argument.type,
    description: String(argument.description || argument.type || "unknown").slice(
      0,
      2000,
    ),
    ...(argument.preview
      ? { preview: preview(argument.preview) }
      : { propertiesUnavailable: true }),
  });
}

export function isTopDocumentRequest(params, mainFrameId) {
  return params.type === "Document" && !!mainFrameId && params.frameId === mainFrameId;
}

export function createSessionCoordinator({
  chrome,
  sessionFor,
  authenticated,
  ready,
  captureStorage = createSessionStorage(),
}) {
  const store = createCaptureStore({ storage: captureStorage });
  let queue = Promise.resolve();
  const serial = (fn) => {
    const result = queue.then(async () => {
      await ready;
      try {
        return await fn();
      } catch (error) {
        const latest = await store.read().catch(() => null);
        if (latest?.storageFailure) await cleanup(latest).catch(() => {});
        throw error;
      }
    });
    queue = result.catch(() => {});
    return result;
  };
  const command = (tabId, method, params = {}) =>
    chrome.debugger.sendCommand({ tabId }, method, params);
  async function cleanup(s) {
    if (!s) return;
    await chrome.alarms.clear("feedbacks-session-limit");
    await chrome.scripting
      .executeScript({
        target: { tabId: s.target.sourceTabId },
        world: "MAIN",
        func: () => {
          globalThis.__feedbacksSessionPageStop?.();
        },
      })
      .catch(() => {});
    await chrome.scripting
      .executeScript({
        target: { tabId: s.target.sourceTabId },
        func: () => {
          globalThis.__feedbacksSessionBridgeStop?.();
        },
      })
      .catch(() => {});
    if (s.debuggerAttached)
      await chrome.debugger.detach({ tabId: s.target.sourceTabId }).catch(() => {});
    await chrome.tabs
      .sendMessage(s.target.sourceTabId, { type: "recordingState", state: "ready" })
      .catch(() => {});
  }
  async function stop(detail) {
    const current = await store.read();
    if (current?.active && !detail) {
      try {
        await assertScope(current);
        const result = await chrome.scripting.executeScript({
          target: { tabId: current.target.sourceTabId },
          world: "MAIN",
          func: () => {
            const tail = globalThis.__feedbacksSessionPageTake?.() || [];
            globalThis.__feedbacksSessionPageStop?.();
            return tail;
          },
        });
        const tail = result[0]?.result;
        if (
          !Array.isArray(tail) ||
          tail.length > 45000 ||
          captureByteLength(JSON.stringify(tail)) > 16 * 1024 * 1024
        )
          throw Error("Invalid final capture batch");
        for (const event of tail) {
          const next = await store.append(
            event,
            current.target.sourceTabId,
            current.currentOrigin || current.target.origin,
          );
          if (!next?.active) break;
        }
      } catch {
        await store.coverage(
          "capture",
          "partial",
          "The final page batch could not be flushed; earlier evidence is preserved.",
        );
      }
    }
    let stopped;
    try {
      stopped = await store.stop(detail);
      return stopped;
    } finally {
      await cleanup(stopped || current);
    }
  }
  async function inject(s) {
    await chrome.scripting.executeScript({
      target: { tabId: s.target.sourceTabId },
      func: installSessionBridge,
      args: [s.bridgeToken],
    });
    await chrome.scripting.executeScript({
      target: { tabId: s.target.sourceTabId },
      world: "MAIN",
      files: ["rrweb-capture.js"],
    });
    await chrome.scripting.executeScript({
      target: { tabId: s.target.sourceTabId },
      world: "MAIN",
      func: (config) => globalThis.__feedbacksStartSessionCapture(config),
      args: [
        {
          token: s.bridgeToken,
          privacy: s.recording.privacy,
          debugger: !!s.debuggerAttached,
          remainingMs: 300000 - (Date.now() - s.started),
          startedAt: s.started,
        },
      ],
    });
  }
  async function append(event, s) {
    const next = await store.append(
      { ...event, capturedAt: event.capturedAt ?? s.eventCapturedAt },
      s.target.sourceTabId,
      s.currentOrigin || s.target.origin,
    );
    if (next && !next.active && s.active) {
      s.active = false;
      await cleanup(next);
    }
  }
  async function assertScope(s) {
    const tab = await chrome.tabs.get(s.target.sourceTabId);
    if (!originAllowed(s.target, tab.url))
      throw Error("The page is outside the explicitly allowed recording origins.");
    const account = await chrome.storage.local.get(["server", "accounts"]);
    if (
      s.accountFingerprint &&
      (account.server !== s.target.server ||
        !account.accounts?.[s.target.server]?.token ||
        (await videoFingerprint(account.accounts[s.target.server].token)) !==
          s.accountFingerprint)
    )
      throw Error("Recording server or account changed.");
    return tab;
  }
  chrome.debugger.onEvent.addListener((source, method, params) => {
    const ingressAt = Date.now();
    void serial(async () => {
      let s = await store.read();
      if (!s?.active || source.tabId !== s.target.sourceTabId || source.sessionId) return;
      // Stop collecting before an out-of-origin document starts receiving data.
      if (
        method === "Network.requestWillBeSent" &&
        isTopDocumentRequest(params, s.mainFrameId)
      ) {
        let inScope = false;
        try {
          inScope = originAllowed(s.target, params.request.url);
        } catch {}
        if (!inScope) {
          await store.update((v) => {
            v.scopeActive = false;
          });
          await store.coverage(
            "navigation",
            "partial",
            "Left the approved recording origins; collection is suspended until return.",
          );
          return;
        }
      }
      if (!s.scopeActive) return;
      try {
        await assertScope(s);
      } catch {
        await stop("Selected project or review changed; capture stopped.");
        return;
      }
      if (
        method === "Network.requestWillBeSent" &&
        Number.isFinite(params.wallTime) &&
        Number.isFinite(params.timestamp)
      ) {
        s.networkClockOffset = params.wallTime * 1000 - params.timestamp * 1000;
        await store.update((v) => {
          v.networkClockOffset = s.networkClockOffset;
        });
      }
      const protocolAt =
        method.startsWith("Network.") &&
        Number.isFinite(s.networkClockOffset) &&
        Number.isFinite(params.timestamp)
          ? s.networkClockOffset + params.timestamp * 1000
          : method.startsWith("Runtime.") && Number.isFinite(params.timestamp)
            ? params.timestamp
            : method === "Log.entryAdded" && Number.isFinite(params.entry?.timestamp)
              ? params.entry.timestamp
              : ingressAt;
      const at = Math.min(ingressAt, protocolAt);
      s.eventCapturedAt = at;
      if (method === "Runtime.consoleAPICalled") {
        if (params.timestamp < s.started) return;
        const args = (params.args || []).slice(0, 20).map(consoleArgument);
        if (args.some((arg) => arg?.propertiesUnavailable))
          await store.coverage(
            "console",
            "partial",
            "Console messages captured. Some object properties were unavailable in Chrome passive previews; getters are never evaluated.",
          );
        await append(
          {
            type: "console",
            data: {
              level: params.type,
              args,
              stackTrace: params.stackTrace,
              source: "debugger",
            },
          },
          s,
        );
      } else if (method === "Runtime.exceptionThrown") {
        await append(
          {
            type: "console",
            data: {
              level: "error",
              args: [
                params.exceptionDetails?.text,
                params.exceptionDetails?.exception?.description,
              ],
              stackTrace: params.exceptionDetails?.stackTrace,
              source: "exception",
            },
          },
          s,
        );
      } else if (method === "Log.entryAdded") {
        const e = params.entry || {};
        if (e.timestamp < s.started) return;
        await append(
          {
            type: "console",
            data: {
              level: e.level,
              args: [e.text],
              url: e.url,
              lineNumber: e.lineNumber,
              stackTrace: e.stackTrace,
              source: e.source,
            },
          },
          s,
        );
      } else if (method === "Network.requestWillBeSent") {
        if (params.wallTime && params.wallTime * 1000 < s.started) return;
        const r = params.request;
        if (!/^https?:/.test(r.url)) return;
        await store.update((v) => {
          v.requests ||= {};
          if (Object.keys(v.requests).length >= 500) {
            v.requestDrops = (v.requestDrops || 0) + 1;
            return;
          }
          v.requests[params.requestId] = { url: captureUrl(r.url), start: at };
        });
        await append(
          {
            type: "network",
            data: {
              phase: "request",
              requestId: params.requestId,
              url: r.url,
              method: r.method,
              requestHeaders: r.headers,
              requestBody:
                s.recording.privacy.networkBodies &&
                /^(?:application\/(?:[\w.-]+\+)?json|text\/plain|application\/x-www-form-urlencoded)(?:;|$)/i.test(
                  Object.entries(r.headers || {}).find(
                    ([key]) => key.toLowerCase() === "content-type",
                  )?.[1] || "",
                )
                  ? r.postData?.slice(0, 16384)
                  : undefined,
              initiator: params.initiator,
              resourceType: params.type,
              redirectResponse: params.redirectResponse
                ? {
                    status: params.redirectResponse.status,
                    url: params.redirectResponse.url,
                  }
                : undefined,
            },
          },
          s,
        );
      } else if (method === "Network.responseReceived") {
        const r = params.response;
        await store.update((v) => {
          if (v.requests?.[params.requestId])
            Object.assign(v.requests[params.requestId], {
              mimeType: r.mimeType,
              status: r.status,
            });
        });
        await append(
          {
            type: "network",
            data: {
              phase: "response",
              requestId: params.requestId,
              url: r.url,
              status: r.status,
              statusText: r.statusText,
              responseHeaders: r.headers,
              mimeType: r.mimeType,
              protocol: r.protocol,
              fromDiskCache: r.fromDiskCache,
              timing: r.timing,
            },
          },
          s,
        );
      } else if (
        method === "Network.loadingFinished" ||
        method === "Network.loadingFailed"
      ) {
        const request = s.requests?.[params.requestId];
        if (!request) return;
        let responseBody, bodyOmitted;
        if (s.recording.privacy.networkBodies && method === "Network.loadingFinished") {
          if (
            params.encodedDataLength <= 32768 &&
            /^(?:application\/(?:[\w.-]+\+)?json|text\/plain|application\/x-www-form-urlencoded)(?:;|$)/i.test(
              request.mimeType || "",
            )
          ) {
            try {
              const body = await command(source.tabId, "Network.getResponseBody", {
                requestId: params.requestId,
              });
              if (!body.base64Encoded && body.body.length <= 16384)
                responseBody = body.body;
              else bodyOmitted = "Binary or over 16 KiB decoded body";
            } catch {
              bodyOmitted = "Body unavailable from Chrome";
            }
          } else
            bodyOmitted =
              "Only JSON, plain text or form bodies below 32 KiB are captured; HTML, scripts, XML and binary bodies are omitted";
        }
        await append(
          {
            type: "network",
            data: {
              phase: method === "Network.loadingFailed" ? "failed" : "finished",
              requestId: params.requestId,
              url: request.url,
              status: request.status,
              durationMs: at - request.start,
              encodedDataLength: params.encodedDataLength,
              error: params.errorText,
              responseBody,
              bodyOmitted,
            },
          },
          s,
        );
        await store.update((v) => {
          delete v.requests?.[params.requestId];
        });
      }
    }).catch(async () => {
      await store
        .coverage("debugger", "partial", "A debugger event could not be collected.")
        .catch(() => {});
    });
  });
  chrome.debugger.onDetach.addListener((source) => {
    void serial(async () => {
      const s = await store.read();
      if (s?.active && s.target.sourceTabId === source.tabId) {
        await store.update((v) => {
          v.debuggerAttached = false;
        });
        await store.coverage(
          "console",
          "partial",
          "Debugger detached; subsequent console coverage may be absent until navigation.",
        );
        await store.coverage(
          "network",
          "partial",
          "Debugger detached; subsequent requests may be absent until navigation.",
        );
      }
    }).catch(() => {});
  });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "feedbacks-session-limit")
      void serial(() => stop("5 minute duration limit reached.")).catch(() => {});
  });
  chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
    if (!change.url && change.status !== "complete") return;
    void serial(async () => {
      const s = await store.read();
      if (!s?.active || s.target.sourceTabId !== tabId) return;
      let inScope = false;
      try {
        inScope = originAllowed(s.target, tab.url);
      } catch {}
      if (!inScope) {
        await store.update((v) => {
          v.scopeActive = false;
          v.documentId = null;
        });
        await store.coverage(
          "navigation",
          "partial",
          "Left the approved recording origins; no evidence collected there.",
        );
        return;
      }
      if (change.status === "complete") {
        try {
          await assertScope(s);
          s.scopeActive = true;
          s.currentOrigin = new URL(tab.url).origin;
          s.documentId = null;
          s.bridgeToken = crypto.randomUUID();
          await store.update((v) => {
            v.scopeActive = true;
            v.currentOrigin = s.currentOrigin;
            v.documentId = null;
            v.lastPageSeq = 0;
            v.bridgeToken = s.bridgeToken;
          });
          await append(
            { type: "activity", data: { action: "navigation", url: tab.url } },
            s,
          );
          await inject(s);
        } catch {
          await stop(
            "Source review changed or page reinjection failed after navigation.",
          );
        }
      }
    }).catch(() => {});
  });
  chrome.tabs.onRemoved.addListener((id) => {
    void serial(async () => {
      const s = await store.read();
      if (s?.active && s.target.sourceTabId === id)
        await stop("Source tab closed. Earlier evidence remains available.");
    }).catch(() => {});
  });
  return {
    status: () =>
      serial(async () => {
        let s = await store.read();
        if (s?.active && Date.now() - s.started >= 300000)
          s = await stop("5 minute duration limit reached.");
        return s;
      }),
    start: (target, privacy, mode, ownerTabId) =>
      serial(async () => {
        const tab = await chrome.tabs.get(target.sourceTabId);
        const session = await sessionFor({ tab, frameId: 0, url: tab.url });
        if (
          target.projectId !== session.projectId ||
          target.reviewId !== session.reviewId ||
          target.server !== session.server
        )
          throw Error("Open the recorder from the selected project.");
        const allowedOrigins = captureOrigins(
          new URL(tab.url).origin,
          target.allowedOrigins || [],
        );
        const extra = allowedOrigins.filter(
          (origin) => origin !== new URL(tab.url).origin,
        );
        if (
          extra.length &&
          !(await chrome.permissions.contains({
            origins: extra.map((origin) => `${origin}/*`),
          }))
        )
          throw Error("Allow the listed redirect origins before starting capture.");
        const s = await store.start(
          { ...target, origin: new URL(tab.url).origin, allowedOrigins, ownerTabId },
          privacy,
          mode,
          {
            userAgent: globalThis.navigator?.userAgent,
            viewport: target.viewport,
            source: "chrome-extension",
            limits: {
              maxMs: 300000,
              maxBytes: CAPTURE_MAX_BYTES,
              maxSnapshotBytes: CAPTURE_SNAPSHOT_BYTES,
              maxEvents: 45000,
            },
            captureOrigins: allowedOrigins,
            trust: "Page evidence is untrusted.",
          },
        );
        const accountState = await chrome.storage.local.get("accounts");
        await store.update((v) => {
          v.accountFingerprint = null;
        });
        const accountFingerprint = await videoFingerprint(
          accountState.accounts?.[target.server]?.token || "",
        );
        await store.update((v) => {
          v.accountFingerprint = accountFingerprint;
        });
        await chrome.alarms.create("feedbacks-session-limit", {
          when: s.started + 300000,
        });
        try {
          await chrome.debugger.attach({ tabId: target.sourceTabId }, "1.3");
          s.debuggerAttached = true;
          await store.update((v) => {
            v.debuggerAttached = true;
          });
          const frameTree = await command(target.sourceTabId, "Page.getFrameTree");
          await store.update((v) => {
            v.mainFrameId = frameTree.frameTree?.frame?.id || null;
          });
          await command(target.sourceTabId, "Network.enable", {
            maxTotalBufferSize: 1024 * 1024,
            maxResourceBufferSize: 32768,
            maxPostDataSize: 16384,
          });
          await command(target.sourceTabId, "Runtime.enable");
          await command(target.sourceTabId, "Log.enable");
          await store.coverage(
            "console",
            "complete",
            "Runtime and browser Log events from the selected top-level target while recording.",
          );
          await store.coverage(
            "network",
            "partial",
            "Requests and responses from the selected target. Bodies are opt-in and bounded; service worker/child targets and streaming bodies may be absent.",
          );
        } catch {
          if (s.debuggerAttached)
            await chrome.debugger.detach({ tabId: target.sourceTabId }).catch(() => {});
          s.debuggerAttached = false;
          await store.update((v) => {
            v.debuggerAttached = false;
          });
          await store.coverage(
            "console",
            "partial",
            "Debugger unavailable. Page console wrappers omit object values and may be overridden.",
          );
          await store.coverage(
            "network",
            "partial",
            "Debugger unavailable. Resource timings only; no request headers or bodies.",
          );
        }
        try {
          await inject(s);
        } catch {
          await store.coverage(
            "replay",
            "unavailable",
            "DOM recorder could not be injected. Use the built extension package.",
          );
        }
        await chrome.tabs
          .sendMessage(target.sourceTabId, { type: "recordingState", state: "recording" })
          .catch(() => {});
        return store.read();
      }),
    events: (message, sender) =>
      serial(async () => {
        const s = await store.read();
        if (
          !s?.active ||
          !s.scopeActive ||
          sender.frameId !== 0 ||
          sender.tab?.id !== s.target.sourceTabId ||
          message.token !== s.bridgeToken ||
          !originAllowed(s.target, sender.url)
        )
          return {};
        try {
          await assertScope(s);
        } catch {
          return stop("Selected project or review changed; capture stopped.");
        }
        if (s.documentId && sender.documentId !== s.documentId) return {};
        if (sender.documentId && !s.documentId)
          await store.update((v) => {
            v.documentId = sender.documentId;
          });
        if (message.type === "sessionBridgeLimit")
          return stop("Page bridge size/event limit reached.");
        if (!Array.isArray(message.events) || message.events.length > 100) return {};
        let size;
        try {
          size = captureByteLength(JSON.stringify(message.events));
        } catch {
          return {};
        }
        if (size > CAPTURE_BATCH_BYTES)
          return stop("Oversized page bridge batch; capture is incomplete.");
        for (const event of message.events) {
          if (
            event?.data?.action === "capture-limit" ||
            event?.data?.action === "capture-time-limit"
          )
            return stop(
              `Page recorder limit reached: nodes ${event.data.eventNodes ?? "unknown"} (node limit ${event.data.nodeLimit ?? "unknown"}), event ${event.data.eventBytes ?? "unknown"} bytes (event limit ${event.data.eventLimit ?? "unknown"}), page total ${event.data.totalBytes ?? "unknown"} bytes (limit ${event.data.totalLimit ?? "unknown"}).`,
            );
          await append(event, s);
        }
        return {};
      }),
    stop: () => serial(() => stop()),
    retire: (tabId) =>
      serial(async () => {
        const s = await store.read();
        if (s?.active && s.target.sourceTabId === tabId)
          return stop("Review ended; earlier evidence remains available.");
        return {};
      }),
    discard: () =>
      serial(async () => {
        await cleanup(await store.read());
        await store.discard();
        return {};
      }),
    annotate: (channel, detail) =>
      serial(async () => {
        const s = await store.read();
        if (s?.submission?.input) {
          const prior = s.recording.coverage.find(
            (item) => item.channel === String(channel).slice(0, 80),
          );
          if (
            prior?.status === "partial" &&
            prior.detail === String(detail).slice(0, 500)
          )
            return s;
          throw Error("The submitted recording is immutable. Retry the original upload.");
        }
        return store.coverage(
          String(channel).slice(0, 80),
          "partial",
          String(detail).slice(0, 500),
        );
      }),
    submit: (message, ownerTabId) =>
      serial(async () => {
        let s = await store.read();
        if (!s || s.active) throw Error("Stop the recording before sending.");
        if (message.video && s.target.ownerTabId !== ownerTabId && !s.submission)
          throw Error("This video evidence belongs to another recorder.");
        const state = await chrome.storage.local.get(["server", "accounts"]);
        if (state.server !== s.target.server || !state.accounts?.[s.target.server]?.token)
          throw Error("Reconnect the original Feedbacks server before retrying.");
        if (
          s.accountFingerprint !==
          (await videoFingerprint(state.accounts[s.target.server].token))
        )
          throw Error(
            "The connected account changed. Reconnect the original account before sending this capture.",
          );
        if (!s.submission) {
          if (typeof message.body !== "string" || !message.body.trim())
            throw Error("Write a comment before sending.");
          await store.update((v) => {
            v.submission = {
              body: message.body,
              createKey: crypto.randomUUID(),
              uploadKey: crypto.randomUUID(),
              thread: message.thread || null,
            };
            if (message.clipReplay && message.video?.segments?.length)
              v.recording = clipRecording(v.recording, message.video.segments);
            if (message.video) {
              v.recording.video = sanitizeCapture(message.video);
              v.recording.mode = "video";
            } else {
              v.recording.mode = "session";
            }
          });
          s = await store.read();
        }
        if (!s.submission.thread) {
          const thread = await authenticated(
            "threads.create",
            {
              projectId: s.target.projectId,
              body: s.submission.body,
              context: { url: s.recording.url, viewport: s.target.viewport },
              idempotencyKey: s.submission.createKey,
            },
            s.target.server,
          );
          await store.update((v) => {
            v.submission.thread = thread;
          });
          s = await store.read();
        }
        // Save immutable input before upload, so response loss retries byte-identically.
        if (!s.submission.input) {
          await store.update((v) => {
            v.submission.input = {
              threadId: v.submission.thread.id,
              revision: v.submission.thread.revision,
              idempotencyKey: v.submission.uploadKey,
            };
          });
          s = await store.read();
        }
        const result = await authenticated(
          "recordings.upload",
          { ...s.submission.input, recording: s.recording },
          s.target.server,
        );
        await store.discard();
        return { ...result, url: `${s.target.server}/threads/${result.thread.id}` };
      }),
  };
}
