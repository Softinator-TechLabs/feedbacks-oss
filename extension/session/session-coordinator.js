import {
  createCaptureStore,
  captureUrl,
  sanitizeCapture,
  clipRecording,
  CAPTURE_BATCH_BYTES,
  captureByteLength,
  CAPTURE_MAX_BYTES,
  CAPTURE_SNAPSHOT_BYTES,
  captureElapsed,
  captureOrigins,
  originAllowed,
} from "./session-capture.js";
import { createSessionStorage } from "./session-storage.js";
import { videoFingerprint } from "../video/video-target.js";
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
  annotationImage,
}) {
  const store = createCaptureStore({ storage: captureStorage });
  let pendingNavigation = null;
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
    pendingNavigation = null;
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
    if (s.recording.mode !== "video")
      await chrome.tabs
        .sendMessage(s.target.sourceTabId, {
          type: "recordingState",
          mode: "session",
          state: "ready",
          elapsedMs: s.recording.durationMs,
        })
        .catch(() => {});
  }
  async function stop(detail) {
    const current = await store.read();
    if (current?.active && !current.annotationPause && !detail) {
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
    if (s.annotationPause) return;
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
          replayDisabled: !!s.replayDisabled,
          privacy: s.recording.privacy,
          debugger: !!s.debuggerAttached,
          remainingMs: 300000 - captureElapsed(s),
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
      throw Object.assign(
        Error("The page is outside the explicitly allowed recording origins."),
        { code: "recording_origin_outside" },
      );
    await assertAccount(s);
    return tab;
  }
  async function assertAccount(s) {
    const account = await chrome.storage.local.get(["server", "accounts"]);
    if (
      s.accountFingerprint &&
      (account.server !== s.target.server ||
        !account.accounts?.[s.target.server]?.token ||
        (await videoFingerprint(account.accounts[s.target.server].token)) !==
          s.accountFingerprint)
    )
      throw Error("Recording server or account changed.");
  }
  async function suspendNavigation() {
    await store.update((s) => {
      s.scopeActive = false;
      s.documentId = null;
      s.requests = {};
    });
    await store.coverage(
      "navigation",
      "partial",
      "Left the approved recording origins; collection is suspended until return.",
    );
  }
  function deferNavigationEvent(method, params, ingressAt) {
    if (!pendingNavigation || pendingNavigation.events.length >= 4) return;
    const clean = sanitizeCapture(params, 0, 16384);
    // The approved request is useful evidence; its outside-page initiator is not.
    delete clean.initiator;
    delete clean.redirectResponse;
    if (clean.request) {
      delete clean.request.postData;
      delete clean.request.postDataEntries;
      for (const key of Object.keys(clean.request.headers || {}))
        if (/^referer$|^referrer$/i.test(key)) delete clean.request.headers[key];
    }
    const event = { method, params: clean, ingressAt };
    const bytes = captureByteLength(JSON.stringify(event));
    if (pendingNavigation.bytes + bytes > 128 * 1024) return;
    pendingNavigation.events.push(event);
    pendingNavigation.bytes += bytes;
  }
  async function drainNavigation(s) {
    if (!pendingNavigation) return false;
    if (!s?.active || s.annotationPause) {
      pendingNavigation = null;
      return false;
    }
    try {
      await assertAccount(s);
      const tab = await assertScope(s);
      if (new URL(tab.url).origin !== pendingNavigation.origin) {
        pendingNavigation = null;
        return false;
      }
    } catch (error) {
      if (error.code === "recording_origin_outside") return false;
      pendingNavigation = null;
      await stop("Recording server or account changed; capture stopped.");
      return false;
    }
    const pending = pendingNavigation;
    pendingNavigation = null;
    for (const event of pending.events)
      await collectDebuggerEvent(
        { tabId: s.target.sourceTabId },
        event.method,
        event.params,
        event.ingressAt,
        true,
      );
    return true;
  }
  async function collectDebuggerEvent(
    source,
    method,
    params,
    ingressAt,
    deferred = false,
  ) {
    let s = await store.read();
    if (!s?.active || s.annotationPause) pendingNavigation = null;
    if (
      !s?.active ||
      s.annotationPause ||
      source.tabId !== s.target.sourceTabId ||
      source.sessionId
    )
      return;
    if (!deferred && pendingNavigation) {
      await drainNavigation(s);
      s = await store.read();
      if (!s?.active) return;
      if (
        pendingNavigation &&
        params.requestId === pendingNavigation.requestId &&
        [
          "Network.responseReceived",
          "Network.loadingFinished",
          "Network.loadingFailed",
        ].includes(method)
      ) {
        if (!params.response || originAllowed(s.target, params.response.url))
          deferNavigationEvent(method, params, ingressAt);
        return;
      }
    }
    let returningDocument = false;
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
        pendingNavigation = null;
        return suspendNavigation();
      }
      returningDocument = !s.scopeActive;
    }
    if (!s.scopeActive && !returningDocument) return;
    try {
      const tab = await assertScope(s);
      if (returningDocument) {
        // Resume the incoming approved document before load completes, but
        // only once Chrome's live tab URL and the original account agree.
        s.scopeActive = true;
        s.currentOrigin = new URL(tab.url).origin;
        await store.update((v) => {
          v.scopeActive = true;
          v.currentOrigin = s.currentOrigin;
          v.documentId = null;
        });
      }
    } catch (error) {
      // A queued event can observe the new tab URL before the navigation
      // notification suspends collection. Leaving scope is not revocation.
      if (error.code === "recording_origin_outside") {
        if (returningDocument && !deferred) {
          try {
            await assertAccount(s);
          } catch {
            pendingNavigation = null;
            return stop("Recording server or account changed; capture stopped.");
          }
          pendingNavigation = {
            origin: new URL(params.request.url).origin,
            requestId: params.requestId,
            events: [],
            bytes: 0,
          };
          deferNavigationEvent(method, params, ingressAt);
        }
        return suspendNavigation();
      }
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
    // Enabling lifecycle notifications can replay the existing document's old
    // milestones. Without a calibrated monotonic clock they are not new activity.
    if (
      method === "Page.lifecycleEvent" &&
      (!Number.isFinite(s.networkClockOffset) || !Number.isFinite(params.timestamp))
    )
      return;
    const protocolAt =
      (method.startsWith("Network.") || method === "Page.lifecycleEvent") &&
      Number.isFinite(s.networkClockOffset) &&
      Number.isFinite(params.timestamp)
        ? s.networkClockOffset + params.timestamp * 1000
        : method.startsWith("Runtime.") && Number.isFinite(params.timestamp)
          ? params.timestamp
          : method === "Log.entryAdded" && Number.isFinite(params.entry?.timestamp)
            ? params.entry.timestamp
            : ingressAt;
    if (method === "Page.lifecycleEvent" && protocolAt < s.started) return;
    const at = Math.min(ingressAt, protocolAt);
    s.eventCapturedAt = at;
    if (
      method === "Page.lifecycleEvent" ||
      method === "Page.frameStartedLoading" ||
      method === "Page.frameStoppedLoading"
    ) {
      if (params.frameId !== s.mainFrameId) return;
      await append(
        {
          type: "activity",
          data: {
            action: "loading",
            phase:
              params.name || (method.endsWith("StartedLoading") ? "started" : "finished"),
            url: (await chrome.tabs.get(source.tabId)).url,
          },
        },
        s,
      );
    } else if (method === "Runtime.consoleAPICalled") {
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
      // Responses omitted during suspension stay omitted even if their
      // callbacks arrive after an approved page has returned.
      if (!s.requests?.[params.requestId]) return;
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
  }
  chrome.debugger.onEvent.addListener((source, method, params) => {
    const ingressAt = Date.now();
    void serial(() => collectDebuggerEvent(source, method, params, ingressAt)).catch(
      async () => {
        await store
          .coverage("debugger", "partial", "A debugger event could not be collected.")
          .catch(() => {});
      },
    );
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
  async function scheduleLimit(s) {
    if (!s.active || (s.recording.mode === "session" && s.annotationPause))
      return chrome.alarms.clear("feedbacks-session-limit");
    await chrome.alarms.create("feedbacks-session-limit", {
      when: Date.now() + Math.max(0, 300000 - captureElapsed(s)),
    });
  }
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "feedbacks-session-limit")
      void serial(async () => {
        const s = await store.read();
        if (!s?.active) return;
        if (captureElapsed(s) >= 300000) await stop("5 minute duration limit reached.");
        else await scheduleLimit(s);
      }).catch(() => {});
  });
  chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
    if (!change.url && change.status !== "complete") return;
    void serial(async () => {
      let s = await store.read();
      if (!s?.active || s.target.sourceTabId !== tabId) return;
      let inScope = false;
      try {
        inScope = originAllowed(s.target, tab.url);
      } catch {}
      if (!inScope) {
        return suspendNavigation();
      }
      await drainNavigation(s);
      s = await store.read();
      if (!s?.active) return;
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
        } catch (error) {
          if (error.code === "recording_origin_outside") return suspendNavigation();
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
    beginAnnotation: (details) =>
      serial(async () => {
        pendingNavigation = null;
        let s = await store.read();
        if (!s?.active)
          throw Error("Start a recording with debug context before adding a point.");
        await assertScope(s);
        if (s.annotationPause) {
          if (s.annotationPause.key === details.key) return s.annotationPause;
          throw Error("Save or cancel the current point first.");
        }
        if ((s.annotations || []).length >= 20)
          throw Error("This recording already has 20 screenshot points.");
        try {
          const tail = await chrome.scripting.executeScript({
            target: { tabId: s.target.sourceTabId },
            world: "MAIN",
            func: () => {
              const events = globalThis.__feedbacksSessionPageTake?.() || [];
              globalThis.__feedbacksSessionPageStop?.();
              return events;
            },
          });
          const events = tail[0]?.result || [];
          if (
            !Array.isArray(events) ||
            captureByteLength(JSON.stringify(events)) > 16 * 1024 * 1024
          )
            throw Error("Could not pause the page capture safely.");
          for (const event of events) await append(event, s);
          s = await store.read();
          if (!s.active) throw Error("Capture ended before the point could be added.");
        } catch (error) {
          const latest = await store.read();
          if (latest?.active) {
            await store.update((v) => {
              v.bridgeToken = crypto.randomUUID();
              v.lastPageSeq = 0;
              v.documentId = null;
            });
            await store.coverage(
              "annotations",
              "partial",
              "The point could not be paused safely; page capture was restarted from a fresh baseline.",
            );
            try {
              await assertScope(latest);
              await inject(await store.read());
            } catch {
              await store.coverage(
                "replay",
                "partial",
                "Page capture could not restart after an interrupted screenshot comment. Earlier evidence is preserved.",
              );
            }
          }
          throw error;
        }
        const startedAt = Date.now();
        const point = {
          annotationId: crypto.randomUUID(),
          key: details.key,
          startedAt,
          atMs: Number.isFinite(details.atMs)
            ? Math.max(0, Math.round(details.atMs))
            : captureElapsed(s, startedAt),
          ...(Number.isFinite(details.videoTimeMs)
            ? { videoTimeMs: details.videoTimeMs }
            : {}),
          resumeAfter: details.resumeAfter !== false,
        };
        await store.update((v) => {
          v.annotationPause = point;
        });
        if (s.recording.mode === "session") {
          await chrome.alarms.clear("feedbacks-session-limit");
          await chrome.tabs
            .sendMessage(s.target.sourceTabId, {
              type: "recordingState",
              mode: "session",
              state: "paused",
              elapsedMs: point.atMs,
            })
            .catch(() => {});
        }
        return point;
      }),
    saveAnnotation: (input) =>
      serial(async () => {
        const s = await store.read();
        await assertScope(s);
        const point = s.annotationPause;
        if (
          !point ||
          point.annotationId !== input.annotationId ||
          point.key !== input.key
        )
          throw Error("This point is no longer being edited.");
        const body = String(input.body || "").trim();
        if (!body || body.length > 10000)
          throw Error("Write a comment of up to 10,000 characters.");
        if (!input.anchor || captureByteLength(JSON.stringify(input.anchor)) > 32768)
          throw Error("Invalid screenshot point.");
        const annotation = sanitizeCapture({
          id: point.annotationId,
          body,
          anchor: input.anchor,
          atMs: s.active ? point.atMs : Math.min(point.atMs, s.recording.durationMs),
          ...(Number.isFinite(point.videoTimeMs)
            ? { videoTimeMs: point.videoTimeMs }
            : {}),
        });
        await store.update((v) => {
          v.annotations ||= [];
          if (!v.annotations.some((a) => a.id === annotation.id)) {
            const data = {
              action: "annotation",
              annotationId: annotation.id,
              body: annotation.body,
              anchor: annotation.anchor,
            };
            const bytes = captureByteLength(JSON.stringify(data));
            if (v.bytes + bytes > CAPTURE_MAX_BYTES || v.recording.events.length >= 45000)
              throw Error("Capture is full. Stop and send it before adding points.");
            v.annotations.push(annotation);
            v.recording.events.push({
              seq: v.recording.events.length,
              type: "activity",
              atMs: annotation.atMs,
              data,
            });
            v.bytes += bytes;
            if (!v.active) {
              v.recording.events.sort((a, b) => a.atMs - b.atMs || a.seq - b.seq);
              v.recording.events.forEach((event, seq) => {
                event.seq = seq;
              });
            }
          }
        });
        return annotation;
      }),
    endAnnotation: (annotationId) =>
      serial(async () => {
        const s = await store.read();
        const point =
          s?.annotationPause ||
          (s?.lastAnnotation?.annotationId === annotationId ? s.lastAnnotation : null);
        if (!point || point.annotationId !== annotationId)
          throw Error("This point is no longer being edited.");
        await assertScope(s);
        let resumed = s;
        if (s.annotationPause) {
          const resumedAt = Date.now();
          const candidate = {
            ...s,
            annotationPause: null,
            pausedMs:
              (s.pausedMs || 0) +
              (s.recording.mode === "session" ? resumedAt - point.startedAt : 0),
            requests: {},
            bridgeToken: crypto.randomUUID(),
            lastPageSeq: 0,
            documentId: null,
          };
          try {
            if (candidate.active) await inject(candidate);
          } catch (error) {
            // Injection can partially install a collector. Stop it while retaining
            // the pending pause so retry excludes the whole editing interval.
            await chrome.scripting
              .executeScript({
                target: { tabId: s.target.sourceTabId },
                world: "MAIN",
                func: () => globalThis.__feedbacksSessionPageStop?.(),
              })
              .catch(() => {});
            await chrome.scripting
              .executeScript({
                target: { tabId: s.target.sourceTabId },
                func: () => globalThis.__feedbacksSessionBridgeStop?.(),
              })
              .catch(() => {});
            throw error;
          }
          await store.update((v) => {
            v.annotationIntervals ||= [];
            v.annotationIntervals.push({ start: point.startedAt, end: resumedAt });
            v.pausedMs = candidate.pausedMs;
            v.lastAnnotation = point;
            v.annotationPause = null;
            v.requests = candidate.requests;
            v.bridgeToken = candidate.bridgeToken;
            v.lastPageSeq = 0;
            v.documentId = null;
          });
          resumed = await store.read();
        }
        await scheduleLimit(resumed);
        if (resumed.recording.mode === "session")
          await chrome.tabs
            .sendMessage(resumed.target.sourceTabId, {
              type: "recordingState",
              mode: "session",
              state: resumed.active ? "recording" : "ready",
              elapsedMs: captureElapsed(resumed),
            })
            .catch(() => {});
        return point;
      }),
    contextForControls: (sender) =>
      serial(async () => {
        const s = await store.read();
        if (
          !s ||
          sender.frameId !== 0 ||
          sender.tab?.id !== s.target.sourceTabId ||
          !originAllowed(s.target, sender.url)
        )
          return null;
        const tab = await assertScope(s);
        if (new URL(tab.url).origin !== new URL(sender.url).origin) return null;
        const { sessions = {} } = await chrome.storage.local.get("sessions");
        const review = sessions[s.target.sourceTabId];
        if (
          !review ||
          ["server", "reviewId", "projectId"].some((key) => review[key] !== s.target[key])
        )
          return null;
        return {
          target: structuredClone(s.target),
          mode: s.recording.mode,
          active: s.active,
          elapsedMs: s.active ? captureElapsed(s) : s.recording.durationMs,
        };
      }),
    restore: (tabId, reviewId) =>
      serial(async () => {
        const s = await store.read();
        if (
          !s ||
          s.recording.mode !== "session" ||
          s.target.sourceTabId !== tabId ||
          s.target.reviewId !== reviewId
        )
          return false;
        await assertScope(s);
        await chrome.tabs.sendMessage(tabId, {
          type: "recordingState",
          mode: "session",
          state: s.active ? (s.annotationPause ? "paused" : "recording") : "ready",
          elapsedMs: s.active ? captureElapsed(s) : s.recording.durationMs,
        });
        return true;
      }),
    health: () =>
      serial(async () => {
        const s = await store.read();
        const counts = { activity: 0, console: 0, network: 0, replay: 0 };
        for (const e of s?.recording.events || []) if (e.type in counts) counts[e.type]++;
        return {
          active: !!s?.active,
          counts,
          coverage: s?.recording.coverage || [],
          replayStoppedAtMs: s?.recording.environment.replayStoppedAtMs,
        };
      }),
    status: () =>
      serial(async () => {
        let s = await store.read();
        if (s?.active && captureElapsed(s) >= 300000)
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
          await command(target.sourceTabId, "Page.enable");
          await command(target.sourceTabId, "Page.setLifecycleEventsEnabled", {
            enabled: true,
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
        if (mode !== "video")
          await chrome.tabs
            .sendMessage(target.sourceTabId, {
              type: "recordingState",
              mode: "session",
              state: "recording",
              elapsedMs: Date.now() - s.started,
            })
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
        } catch (error) {
          if (error.code === "recording_origin_outside") return suspendNavigation();
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
        if (s.annotationPause)
          throw Error(
            "Save or cancel the pending screenshot comment on the website before sending.",
          );
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
        let thread = s.submission.frameThread || result.thread;
        if (s.recording.mode === "session") {
          for (const annotation of s.annotations || []) {
            s = await store.read();
            let attempt = s.submission.annotationUploads?.[annotation.id];
            if (!attempt) {
              attempt = {
                input: {
                  threadId: thread.id,
                  revision: thread.revision,
                  idempotencyKey: crypto.randomUUID(),
                  rendition: "screenshot",
                  filename: `point-${annotation.atMs}.webp`,
                  recordingFrame: {
                    recordingId: s.recording.id,
                    atMs: annotation.atMs,
                    annotationId: annotation.id,
                  },
                },
              };
              await store.update((v) => {
                v.submission.annotationUploads ||= {};
                v.submission.annotationUploads[annotation.id] = attempt;
              });
            }
            if (!attempt.result) {
              if (!annotationImage)
                throw Error("Screenshot storage is unavailable. Retry this recording.");
              const imageBase64 = await annotationImage(s.recording.id, annotation.id);
              let uploaded;
              try {
                uploaded = await authenticated(
                  "assets.upload",
                  { ...attempt.input, imageBase64 },
                  s.target.server,
                );
              } catch (error) {
                if (error.code !== "CONFLICT") throw error;
                const fresh = await authenticated(
                  "threads.get",
                  { threadId: thread.id },
                  s.target.server,
                );
                attempt.input = {
                  ...attempt.input,
                  revision: (fresh.thread || fresh).revision,
                  idempotencyKey: crypto.randomUUID(),
                };
                await store.update((v) => {
                  v.submission.annotationUploads[annotation.id] = attempt;
                });
                uploaded = await authenticated(
                  "assets.upload",
                  { ...attempt.input, imageBase64 },
                  s.target.server,
                );
              }
              attempt.result = uploaded;
              await store.update((v) => {
                v.submission.annotationUploads[annotation.id] = attempt;
                v.submission.frameThread = uploaded.thread;
              });
            }
            thread = attempt.result.thread;
          }
        }
        await store.discard();
        return {
          ...result,
          thread,
          url: `${s.target.server}/threads/${result.thread.id}`,
        };
      }),
  };
}
