import { diagnosticCollector, cleanDiagnostics } from "../diagnostics/diagnostics.js";
import { fullPagePlan, verifyFullPageStep } from "./full-page.js";
import { putPage, getPage, deletePage, deleteDraftPages } from "./page-store.js";
import { pointShapes, attachPointEvidence } from "./markings.js";

export function createCaptureWorkflow({
  get,
  set,
  captureUrl,
  captureVisibleTab,
  review,
  sessionFor,
  openDraft,
  watchCapture,
  captureDiagnostics,
  accountIdentity,
  deleteDiagnosticEvidence,
}) {
  let capturing = false;
  async function capture(
    sender,
    retryId,
    pointToken = null,
    scope = "visible",
    body = "",
  ) {
    if (capturing) throw Error("A capture is already in progress.");
    capturing = true;
    const guard = watchCapture(sender.tab.id, sender.tab.windowId, sender.tab.url);
    const retainedPointStates = new Map();
    let retainedAnnotations;
    let previousDiagnosticEvidence;
    let replacedEvidenceId;
    let replacedEvidenceDeleted = false;
    let unattachedEvidenceId;
    async function clearReplacedEvidence() {
      if (
        replacedEvidenceId &&
        !replacedEvidenceDeleted &&
        pending?.diagnosticEvidence?.evidenceId !== replacedEvidenceId
      ) {
        await deleteDiagnosticEvidence(replacedEvidenceId);
        replacedEvidenceDeleted = true;
      }
    }
    let pending,
      captured = false;
    try {
      const session = await sessionFor(sender),
        state = await get();
      const ownerIdentity = await accountIdentity(session.server);
      if (retryId) {
        pointToken = state.draft?.pointToken || null;
        scope = state.draft?.captureScope === "fullPage" ? "fullPage" : "visible";
      }
      if (
        state.draft &&
        (state.draft.id !== retryId ||
          state.draft.frozen ||
          state.draft.image ||
          (state.draft.capturePages?.length && !state.draft.captureError))
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
      if (scope === "points" && !context.annotations?.length)
        throw Error("Add a point before reviewing feedback.");
      if (
        retryId &&
        (!state.draft ||
          state.draft.sourceTabId !== tab.id ||
          state.draft.context.url !== context.url ||
          state.draft.server !== session.server ||
          state.draft.projectId !== session.projectId ||
          (state.draft.evidenceOwnerIdentity &&
            state.draft.evidenceOwnerIdentity !== ownerIdentity))
      )
        throw Error(
          "The original review page changed. Send this draft without an image, or discard it and capture the new page.",
        );
      if (retryId) {
        previousDiagnosticEvidence = state.draft?.diagnosticEvidence;
        replacedEvidenceId = state.draft?.diagnosticEvidence?.evidenceId;
        retainedAnnotations = state.draft.context.annotations;
        context.annotations = retainedAnnotations;
        // Return retained originals to the local point cache before replacing the
        // failed page capture. These are the current, possibly redacted pixels.
        for (const [index, page] of (state.draft.capturePages || []).entries()) {
          if (!page.snapshotKey) continue;
          const blob = await getPage(retryId, index);
          if (blob) {
            await putPage(`point-${tab.id}`, page.snapshotKey, "source", blob);
            retainedPointStates.set(
              page.annotationId,
              state.draft.pageToolStates?.[index] || [],
            );
          }
        }
        await deleteDraftPages(retryId);
      }
      pending = {
        ...(retryId ? state.draft : {}),
        id: retryId || crypto.randomUUID(),
        server: session.server,
        projectId: state.draft?.projectId || session.projectId,
        sourceTabId: tab.id,
        context,
        diagnostics: retryId
          ? state.draft?.diagnostics
          : cleanDiagnostics(
              (
                await chrome.scripting
                  .executeScript({
                    target: { tabId: tab.id },
                    world: "MAIN",
                    func: diagnosticCollector,
                    args: ["take", session.reviewId],
                  })
                  .catch(() => [])
              )[0]?.result,
            ),
        includeDiagnostics: retryId
          ? state.draft?.includeDiagnostics
          : state.reviewDefaults?.includeDiagnostics !== false,
        evidenceOwnerIdentity: retryId
          ? state.draft?.evidenceOwnerIdentity
          : ownerIdentity,
        image: null,
        approvedImage: null,
        capturePages: [],
        pageToolStates: [],
        body: state.draft?.body || body,
        toolState: [],
        imageRevision: (state.draft?.imageRevision || 0) + 1,
        noImage: true,
        createdAt: state.draft?.createdAt || Date.now(),
        captureError:
          "Capture did not complete. Retry capture or continue without an image.",
        captureNotice: null,
        pointCapture: Boolean(pointToken),
        pointToken,
        captureScope: scope,
      };
      if (scope === "points") {
        // Finalizing consumes the originals captured with each point. It must never
        // invoke native capture: menus, viewports and scroll positions may have changed.
        const before = await chrome.tabs.sendMessage(tab.id, {
          type: "captureCheck",
          pointToken,
        });
        if (before.error || before.captureEpoch !== 0)
          throw Error(before.error || "The page moved before point diagnostics.");
        guard.assert();
        pending.diagnosticEvidence = await captureDiagnostics({
          tabId: tab.id,
          sourceUrl: tab.url,
          sourceOrigin: session.origin,
          server: session.server,
          projectId: session.projectId,
          reviewId: session.reviewId,
          ownerIdentity,
          signature: before.signature,
          captureEpoch: before.captureEpoch,
          pointSnapshot: true,
        });
        unattachedEvidenceId = pending.diagnosticEvidence.evidenceId;
        const checked = await chrome.tabs.sendMessage(tab.id, {
          type: "captureCheck",
          pointToken,
        });
        if (checked.signature !== before.signature || checked.captureEpoch !== 0)
          throw Error("The page moved while collecting point diagnostics.");
        pending.captureError = null;
        await attachPointEvidence(pending);
        await set({ draft: pending });
        unattachedEvidenceId = null;
        await clearReplacedEvidence();
        captured = true;
        await chrome.tabs.create({
          url: chrome.runtime.getURL(`editor.html?draft=${pending.id}`),
        });
        return { captured: true };
      }
      // Save context before invoking native capture; rejected pixels never enter storage.
      await set({ draft: pending });
      const before = await chrome.tabs.sendMessage(tab.id, {
        type: "prepareCapture",
        pointToken,
      });
      if (before.error) throw Error(before.error);
      if (retainedAnnotations) before.context.annotations = retainedAnnotations;
      if (before.captureEpoch !== 0)
        throw Error(
          "The page moved while preparing capture. Try again once it is still.",
        );
      guard.assert();
      const diagnosticEvidence = await captureDiagnostics({
        tabId: tab.id,
        sourceUrl: tab.url,
        sourceOrigin: session.origin,
        server: session.server,
        projectId: session.projectId,
        reviewId: session.reviewId,
        ownerIdentity,
        signature: before.signature,
        captureEpoch: before.captureEpoch,
      });
      unattachedEvidenceId = diagnosticEvidence.evidenceId;
      const afterDiagnostics = await chrome.tabs.sendMessage(tab.id, {
        type: "captureCheck",
        pointToken,
      });
      if (
        afterDiagnostics.signature !== before.signature ||
        afterDiagnostics.captureEpoch !== 0
      )
        throw Error("The page moved while collecting diagnostics. Retry capture.");
      guard.assert();
      pending.diagnosticEvidence = diagnosticEvidence;
      await set({ draft: pending });
      unattachedEvidenceId = null;
      await clearReplacedEvidence();
      let canvas,
        sx,
        sy,
        expectedSignature = before.signature,
        plan,
        metrics;
      if (scope === "fullPage") {
        metrics = await chrome.tabs.sendMessage(tab.id, {
          type: "fullPageMetrics",
        });
        if (metrics.error || metrics.url !== before.context.url)
          throw Error(metrics.error || "The page changed before capture.");
        if (
          metrics.viewportWidth !== before.context.viewport.width ||
          metrics.viewportHeight !== before.context.viewport.height
        )
          throw Error("The page size changed before capture. Retry the visible area.");
        plan = fullPagePlan(metrics);
      }
      if (scope === "fullPage") {
        let tileWidth, tileHeight;
        let coveredHeight = plan.height;
        for (let pageIndex = 0; pageIndex < plan.pages.length; pageIndex++) {
          const page = plan.pages[pageIndex];
          const y = page.scrollY;
          guard.assert();
          const step = await chrome.tabs.sendMessage(tab.id, {
            type: "fullPageScroll",
            y,
          });
          if (step.error) throw Error(step.error);
          verifyFullPageStep(metrics, step, y);
          await new Promise((resolve) => setTimeout(resolve, 550));
          const pixels = await captureVisibleTab(tab.windowId);
          guard.assert();
          const after = await chrome.tabs.sendMessage(tab.id, {
            type: "captureCheck",
          });
          const current = await chrome.tabs.get(tab.id);
          if (
            !current.active ||
            current.windowId !== tab.windowId ||
            captureUrl(current.url) !== captureUrl(tab.url) ||
            after.signature !== step.signature ||
            after.captureEpoch !== 0
          )
            throw Error(
              "The page moved during full-page capture. Retry on the original tab.",
            );
          const bitmap = await createImageBitmap(await (await fetch(pixels)).blob());
          try {
            if (!tileWidth) {
              tileWidth = bitmap.width;
              tileHeight = bitmap.height;
              const sourceX = tileWidth / metrics.viewportWidth;
              const sourceY = tileHeight / metrics.viewportHeight;
              if (Math.abs(sourceX - sourceY) > 0.03)
                throw Error(
                  `The browser's captured area changed during capture (${bitmap.width}×${bitmap.height} image, ${metrics.viewportWidth}×${metrics.viewportHeight} viewport). Keep the original tab active and retry.`,
                );
              sx = sourceX;
              sy = sourceY;
            }
            if (bitmap.width !== tileWidth || bitmap.height !== tileHeight)
              throw Error(
                "The browser size changed during capture. Retry the visible area.",
              );
            const cropTop = Math.round(page.cropY * sy);
            const cropHeight = Math.max(1, Math.round((page.endY - page.startY) * sy));
            const tile = new OffscreenCanvas(bitmap.width, cropHeight);
            tile
              .getContext("2d")
              .drawImage(
                bitmap,
                0,
                cropTop,
                bitmap.width,
                cropHeight,
                0,
                0,
                bitmap.width,
                cropHeight,
              );
            let blob = await tile.convertToBlob({ type: "image/webp", quality: 0.9 });
            if (blob.size > 10 * 1024 * 1024)
              blob = await tile.convertToBlob({ type: "image/webp", quality: 0.75 });
            if (blob.size > 10 * 1024 * 1024)
              throw Error(
                `Screenshot ${page.index + 1} exceeds the server's per-image size. Narrow the browser window and retry.`,
              );
            await putPage(pending.id, page.index, "source", blob);
            Object.assign(page, {
              viewportWidth: metrics.viewportWidth,
              pixelWidth: tile.width,
              pixelHeight: tile.height,
            });
            pending.capturePages.push(page);
            pending.pageToolStates.push(
              (
                before.context.liveAnnotations ||
                before.context.annotations ||
                []
              ).flatMap((item, index) =>
                pointShapes(
                  item,
                  index,
                  {
                    startY: page.startY,
                    endY: page.endY,
                    width: metrics.viewportWidth,
                  },
                  sx,
                  sy,
                  before.context.captureMarker,
                ),
              ),
            );
          } finally {
            bitmap.close();
          }
          // Lazy sections may add document height as they enter the viewport.
          // Continue scrolling until the newly revealed tail has been captured.
          if (step.documentHeight > coveredHeight) {
            let startY = coveredHeight;
            while (startY < step.documentHeight) {
              const scrollY = Math.min(
                startY,
                Math.max(0, step.documentHeight - metrics.viewportHeight),
              );
              const endY = Math.min(
                step.documentHeight,
                scrollY + metrics.viewportHeight,
              );
              plan.pages.push({
                index: plan.pages.length,
                scrollY,
                cropY: startY - scrollY,
                startY,
                endY,
              });
              startY = endY;
            }
            coveredHeight = step.documentHeight;
          }
        }
        const digits = Math.max(3, String(pending.capturePages.length).length);
        pending.capturePages.forEach((page, index) => {
          page.name = `full-page-${String(index + 1).padStart(digits, "0")}-of-${String(pending.capturePages.length).padStart(digits, "0")}.webp`;
        });
        const restored = await chrome.tabs.sendMessage(tab.id, {
          type: "fullPageScroll",
          x: before.context.scroll.x,
          y: before.context.scroll.y,
        });
        if (restored.error || restored.signature !== before.signature)
          throw Error(
            "The page changed during full-page capture. Retry the visible area.",
          );
        expectedSignature = restored.signature;
        const still = await chrome.tabs.sendMessage(tab.id, {
          type: "captureCheck",
          pointToken,
        });
        if (still.signature !== expectedSignature || still.captureEpoch !== 0)
          throw Error("The page moved during capture. Retry the visible area.");
        guard.assert();
        const draft = {
          ...pending,
          context: {
            ...before.context,
            captureDimensions: {
              width: Math.round(metrics.viewportWidth * sx),
              height: Math.round(metrics.viewportHeight * sy),
            },
          },
          noImage: false,
          captureError: null,
          capturePages: [...pending.capturePages],
          captureNotice: `${plan.pages.length} ordered ${plan.pages.length === 1 ? "screenshot" : "screenshots"}. Review each page before sending.`,
          pageToolStates: [...pending.pageToolStates],
        };
        await attachPointEvidence(draft, retainedPointStates);
        await set({ draft });
        const persisted = await chrome.tabs.sendMessage(tab.id, {
          type: "captureCheck",
          pointToken,
        });
        if (persisted.signature !== expectedSignature || persisted.captureEpoch !== 0)
          throw Error("The page moved during capture. Retry the visible area.");
        guard.assert();
        guard.dispose();
        if (!retryId)
          await chrome.tabs.create({ url: chrome.runtime.getURL("editor.html") });
        captured = true;
        return { captured: true, pages: pending.capturePages.length };
      }
      {
        const pixels = await captureVisibleTab(tab.windowId);
        guard.assert();
        const after = await chrome.tabs.sendMessage(tab.id, {
          type: "captureCheck",
          pointToken,
        });
        const current = await chrome.tabs.get(tab.id);
        if (
          !current.active ||
          current.windowId !== tab.windowId ||
          captureUrl(tab.url) !== captureUrl(current.url) ||
          before.signature !== after.signature ||
          after.captureEpoch !== 0
        )
          throw Error("The page changed during capture. Try again once it is still.");
        guard.assert();
        const bitmap = await createImageBitmap(await (await fetch(pixels)).blob());
        canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        canvas.getContext("2d").drawImage(bitmap, 0, 0);
        sx = bitmap.width / before.context.viewport.width;
        sy = bitmap.height / before.context.viewport.height;
        bitmap.close();
      }
      // Preserve visible page pixels, including forms and embedded previews.
      // Capture remains local until the reviewer explicitly sends the draft.
      before.context.captureDimensions = {
        width: canvas.width,
        height: canvas.height,
      };
      let bytes;
      for (let attempt = 0; attempt < 4; attempt++) {
        bytes = new Uint8Array(
          await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer(),
        );
        if (bytes.length <= 5 * 1024 * 1024) break;
      }
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
        toolState: before.context.annotations?.length
          ? (before.context.liveAnnotations || before.context.annotations).flatMap(
              (item, index) => {
                const anchor = item.anchor;
                if (!anchor?.pagePoint) return [];
                const visible = {
                  ...item,
                  anchor: {
                    ...anchor,
                    pagePoint: {
                      x: anchor.pagePoint.x - before.context.scroll.x,
                      y: anchor.pagePoint.y - before.context.scroll.y,
                    },
                  },
                };
                return pointShapes(
                  visible,
                  index,
                  {
                    startY: 0,
                    endY: before.context.viewport.height,
                    width: before.context.viewport.width,
                  },
                  sx,
                  sy,
                  before.context.captureMarker,
                );
              },
            )
          : pending.pointCapture && before.context.anchor?.screenshotPoint
            ? [
                {
                  tool: "point",
                  number: 1,
                  markerStyle: before.context.captureMarker?.style || "ring",
                  markerSize: before.context.captureMarker?.size || "small",
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
      if (still.signature !== expectedSignature || still.captureEpoch !== 0)
        throw Error("The page moved during capture. Try again once it is still.");
      guard.assert();
      if (before.context.annotations?.length) {
        await putPage(draft.id, 0, "source", await (await fetch(draft.image)).blob());
        draft.capturePages = [
          {
            index: 0,
            name: "page-visible.webp",
            startY: before.context.scroll.y,
            endY: before.context.scroll.y + before.context.viewport.height,
            viewportWidth: before.context.viewport.width,
            pixelWidth: canvas.width,
            pixelHeight: canvas.height,
          },
        ];
        draft.pageToolStates = [draft.toolState];
        draft.image = null;
        draft.toolState = [];
      }
      await attachPointEvidence(draft, retainedPointStates);
      await set({ draft });
      const persisted = await chrome.tabs.sendMessage(tab.id, {
        type: "captureCheck",
        pointToken,
      });
      if (persisted.signature !== expectedSignature || persisted.captureEpoch !== 0)
        throw Error("The page moved during capture. Try again once it is still.");
      guard.assert();
      guard.dispose();
      if (!retryId)
        await chrome.tabs.create({ url: chrome.runtime.getURL("editor.html") });
      captured = true;
      return { captured: true };
    } catch (error) {
      if (unattachedEvidenceId) {
        await deleteDiagnosticEvidence(unattachedEvidenceId).catch(() => {});
        if (pending?.diagnosticEvidence?.evidenceId === unattachedEvidenceId)
          pending.diagnosticEvidence = previousDiagnosticEvidence || null;
      }
      if (pending) {
        const partial =
          pending.captureScope === "fullPage" && pending.capturePages.length > 0;
        if (!partial) {
          await deleteDraftPages(pending.id).catch(() => {});
          pending.capturePages = [];
          pending.pageToolStates = [];
        } else {
          const continuous = pending.capturePages.filter((page) => !page.annotationId);
          const digits = Math.max(3, String(continuous.length).length);
          continuous.forEach((page, index) => {
            page.name = `full-page-${String(index + 1).padStart(digits, "0")}-of-${String(continuous.length).padStart(digits, "0")}-partial.webp`;
          });
        }
        await attachPointEvidence(pending, retainedPointStates);
        const { draft } = await get();
        if (draft?.id === pending.id) {
          await set({
            draft: {
              ...pending,
              captureError: error.message,
              captureNotice:
                pending.captureNotice ||
                (partial
                  ? `${pending.capturePages.length} pages were saved before capture stopped. This is an incomplete page; review or remove them, or retry the full capture.`
                  : null),
              noImage: pending.capturePages.length === 0,
              imageRevision:
                Math.max(pending.imageRevision, draft.imageRevision || 0) + 1,
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
      const saved = (await get()).draft;
      if (pending && saved?.id === pending.id) {
        // The editor owns the only original now, so permanent redaction cannot
        // leave an unredacted duplicate behind in the point cache.
        for (const page of saved.capturePages || [])
          if (page.snapshotKey)
            await deletePage(`point-${sender.tab.id}`, page.snapshotKey);
        await chrome.tabs
          .sendMessage(sender.tab.id, { type: "draftPrepared" })
          .catch(() => {});
      }
      capturing = false;
      await chrome.tabs
        .sendMessage(sender.tab.id, {
          type: "restore",
          captured,
          pointToken,
          ...(pending?.captureScope === "fullPage"
            ? { scroll: pending.context.scroll }
            : {}),
        })
        .catch(() => {});
    }
  }
  return capture;
}
