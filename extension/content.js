(() => {
  if (globalThis.feedbacksInstalled) return;
  globalThis.feedbacksInstalled = true;
  const U = globalThis.FeedbacksUtil;
  const F = globalThis.FeedbacksFrames;
  let host,
    root,
    bar,
    notice,
    meta,
    pinLayer,
    categoryLists,
    sizes,
    targetBox,
    hoverBox,
    freezeFrame,
    pointMenu,
    draftPin,
    draftPoints,
    pointText,
    reviewButton,
    draftList,
    pointRequest = false,
    pointSignature,
    freezePending = false,
    active = false,
    reviewShortcuts = true,
    choosing = false,
    chosen = null,
    annotations = [],
    draftEditing = false,
    threads = [],
    showPins = true,
    showResolved = false,
    project,
    timer,
    mode = "custom",
    requested,
    captureActive = false,
    captureEpoch = 0,
    drawerHandle,
    reviewDock,
    dockPosition,
    drawerTimer,
    loadingPins,
    occlusionPins = [],
    occlusionFrame,
    activePreviewHide,
    activationGeneration = 0,
    reviewId,
    pendingReview = false,
    draftRenderSignature = "";
  function ageLabel(value) {
    const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60000));
    if (!Number.isFinite(minutes)) return "recently";
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
    const days = Math.floor(hours / 24);
    return `${days} ${days === 1 ? "day" : "days"} ago`;
  }
  function updatePinOcclusion() {
    if (!active || !host?.isConnected || !occlusionPins.length) return;
    for (const { pin, element, x, y, hidePreview } of occlusionPins) {
      if (!pin.isConnected) continue;
      const top = document
        .elementsFromPoint(x, y)
        .find((candidate) => candidate !== host);
      const covered =
        !!element && (!top || (!element.contains(top) && !top.contains(element)));
      pin.style.visibility = covered ? "hidden" : "";
      if (covered) hidePreview?.();
    }
  }
  function schedulePinOcclusion() {
    if (occlusionFrame) return;
    occlusionFrame = requestAnimationFrame(() => {
      occlusionFrame = null;
      updatePinOcclusion();
    });
  }
  function revealDrawer(open = true) {
    if (!bar) return;
    if (open) reviewDock.hidden = false;
    bar.classList.toggle("hidden", !open);
    drawerHandle.setAttribute("aria-expanded", String(open));
    positionControls();
    clearTimeout(drawerTimer);
    // Keep the point list open until explicitly closed; edits must not disappear.
  }
  function positionControls() {
    if (!reviewDock || reviewDock.hidden) return;
    if (dockPosition) {
      const rect = reviewDock.getBoundingClientRect();
      dockPosition.x = Math.max(8, Math.min(dockPosition.x, innerWidth - rect.width - 8));
      dockPosition.y = Math.max(
        8,
        Math.min(dockPosition.y, innerHeight - rect.height - 8),
      );
      Object.assign(reviewDock.style, {
        left: `${dockPosition.x}px`,
        top: `${dockPosition.y}px`,
        right: "auto",
        bottom: "auto",
      });
    }
    if (bar.classList.contains("hidden")) return;
    const dock = reviewDock.getBoundingClientRect();
    const belowSpace = innerHeight - dock.bottom - 16;
    const aboveSpace = dock.top - 16;
    const below =
      belowSpace >= Math.min(bar.scrollHeight, 360) || belowSpace > aboveSpace;
    const available = Math.max(0, below ? belowSpace : aboveSpace);
    bar.style.maxHeight = `${available}px`;
    const height = Math.min(bar.scrollHeight + 2, available);
    Object.assign(bar.style, {
      left: `${Math.max(8, Math.min(dock.left, innerWidth - bar.offsetWidth - 8))}px`,
      top: `${Math.max(8, below ? dock.bottom + 8 : dock.top - height - 8)}px`,
      right: "auto",
      bottom: "auto",
    });
  }
  function movableControls(grip) {
    grip.title = "Drag to move review controls. Arrow keys move them when focused.";
    grip.onpointerdown = (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const rect = reviewDock.getBoundingClientRect();
      const origin = { x: event.clientX, y: event.clientY };
      grip.setPointerCapture(event.pointerId);
      grip.onpointermove = (move) => {
        dockPosition = {
          x: rect.left + move.clientX - origin.x,
          y: rect.top + move.clientY - origin.y,
        };
        positionControls();
      };
      grip.onpointerup = grip.onpointercancel = () => {
        grip.onpointermove = null;
      };
    };
    grip.onkeydown = (event) => {
      const delta = {
        ArrowLeft: [-24, 0],
        ArrowRight: [24, 0],
        ArrowUp: [0, -24],
        ArrowDown: [0, 24],
      }[event.key];
      if (!delta) return;
      event.preventDefault();
      const rect = reviewDock.getBoundingClientRect();
      dockPosition = { x: rect.left + delta[0], y: rect.top + delta[1] };
      positionControls();
    };
  }
  async function exitReview() {
    await send({ type: "stopReview" });
  }
  const invalidateCapture = (event) => {
    // Capture-phase listeners also see scroll/resize events from carousels and
    // videos. Only movement of the reviewed viewport invalidates its pixels.
    if (event.type === "scroll" && event.target !== document && event.target !== window)
      return;
    if (event.type === "resize" && event.target !== window) return;
    if (captureActive) captureEpoch++;
  };
  for (const event of ["scroll", "resize", "popstate", "hashchange", "pagehide"])
    F.listen(event, invalidateCapture, {
      capture: true,
      passive: true,
    });
  globalThis.navigation?.addEventListener("navigate", invalidateCapture);
  const send = async (message) => {
    const r = await chrome.runtime.sendMessage(message);
    if (!r.ok) throw Error(r.error);
    return r.data;
  };
  const hash = (str) => {
    let h = 2166136261;
    for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return (h >>> 0).toString(16);
  };
  const identity = () => U.safeUrl(location.href);
  const localSelector = (element) => {
    const parts = [];
    for (
      let el = element;
      el && el !== element.ownerDocument.documentElement && parts.length < 8;
      el = el.parentElement
    ) {
      const tag = el.tagName.toLowerCase();
      if (
        el.id &&
        !/token|password|secret|session|auth/i.test(el.id) &&
        el.id.length < 80
      ) {
        parts.unshift(`${tag}#${CSS.escape(el.id)}`);
        break;
      }
      const siblings = [...(el.parentElement?.children || [])].filter(
        (e) => e.tagName === el.tagName,
      );
      parts.unshift(`${tag}:nth-of-type(${siblings.indexOf(el) + 1})`);
    }
    return parts.join(" > ");
  };
  const selector = (element) => F.path(element, localSelector);
  function recordKey(element) {
    let uniqueAnchor;
    for (let el = element, depth = 0; el && depth < 12; el = el.parentElement, depth++) {
      for (const name of ["data-feedbacks-record-id", "data-record-id", "data-item-id"]) {
        const value = el.getAttribute(name);
        if (value === null) continue;
        if (
          !value ||
          value.length > 200 ||
          element.ownerDocument.querySelectorAll(`[${name}="${CSS.escape(value)}"]`)
            .length !== 1
        )
          return null;
        return hash(`${name}|${value}`);
      }
      if (el.matches('tr,li,article,[role="row"],[role="listitem"]')) return null;
      if (
        el !== element &&
        ["DIV", "SECTION"].includes(el.tagName) &&
        [...(el.parentElement?.children || [])].filter(
          (sibling) => sibling.tagName === el.tagName,
        ).length > 1
      )
        return null;
      if (
        el === element &&
        el.id &&
        el.id.length < 80 &&
        !/token|password|secret|session|auth/i.test(el.id) &&
        el.ownerDocument.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1
      )
        uniqueAnchor ||= `id:${hash(el.id)}`;
      if (
        el === element &&
        /^(HEADER|MAIN|FOOTER|NAV|H1|BUTTON)$/.test(el.tagName) &&
        el.ownerDocument.querySelectorAll(el.tagName).length === 1
      )
        uniqueAnchor ||= `tag:${el.tagName}`;
    }
    // null is an explicit ambiguity veto; undefined means no key was found.
    return uniqueAnchor || undefined;
  }
  // A unique heading on a document page is useful even without application
  // record attributes. Never use this fallback inside unkeyed repeatable rows.
  function headingFingerprint(el) {
    if (!/^H[1-6]$/.test(el.tagName) || el.isContentEditable) return null;
    if (el.closest('tr,li,article,[role="row"],[role="listitem"]')) return null;
    if (el.querySelector("input,textarea,select,[contenteditable]")) return null;
    const label = el.textContent.trim().replace(/\s+/g, " ");
    if (!label || label.length > 500) return null;
    const matches = [...el.ownerDocument.querySelectorAll(el.tagName)].filter(
      (candidate) => candidate.textContent.trim().replace(/\s+/g, " ") === label,
    );
    return matches.length === 1
      ? `heading-v1:${hash(`${el.tagName}|${label}|${selector(el)}`)}`
      : null;
  }
  const fingerprint = (el) => {
    const record = recordKey(el);
    if (record === null) return null;
    return record
      ? `record-v3:${hash(`${record}|${el.tagName}|${selector(el)}|${el.getAttribute("role") || ""}`)}`
      : headingFingerprint(el);
  };
  function context() {
    const anchor = {
      confidence: "coordinate-only",
      screenshotPoint: { x: innerWidth / 2, y: innerHeight / 2 },
    };
    if (chosen && chosen.record === identity()) {
      Object.assign(anchor, chosen.evidence);
      const el = chosen.element;
      const stable =
        el.isConnected && chosen.fingerprint && fingerprint(el) === chosen.fingerprint;
      anchor.confidence = stable && el.tagName !== "IFRAME" ? "element" : "unmatched";
      if (stable)
        Object.assign(
          anchor,
          targetEvidence(el, chosen.point, chosen.evidence.fingerprint),
        );
      else if (
        !chosen.fingerprint &&
        el.isConnected &&
        selector(el) === chosen.evidence.selector
      )
        Object.assign(
          anchor,
          targetEvidence(el, chosen.point, chosen.evidence.fingerprint),
        );
    }
    const saved = annotations.map(({ id, body, anchor }) => ({ id, body, anchor }));
    return {
      url: U.safeUrl(location.href),
      viewport: { width: innerWidth, height: innerHeight },
      devicePixelRatio,
      scroll: { x: scrollX, y: scrollY },
      preset: mode,
      ...(requested ? { requestedSize: { width: requested, height: innerHeight } } : {}),
      capturedAt: new Date().toISOString(),
      anchor: saved[0]?.anchor || anchor,
      ...(saved.length
        ? {
            annotations: saved,
            pointEvidence: annotations.map(({ id, snapshot }) => ({ id, snapshot })),
            liveAnnotations: annotations.map((item) => {
              const location = draftLocation(item);
              return location.element &&
                (location.visible || location.reason === "Outside visible area")
                ? {
                    ...saved.find((entry) => entry.id === item.id),
                    anchor: {
                      ...targetEvidence(
                        location.element,
                        item.anchor.point,
                        item.anchor.fingerprint,
                      ),
                      confidence: item.anchor.confidence,
                    },
                  }
                : { id: item.id, body: item.body, anchor: {} };
            }),
          }
        : {}),
    };
  }
  function targetEvidence(el, point, evidenceFingerprint) {
    const r = F.rect(el),
      style = el.ownerDocument.defaultView.getComputedStyle(el),
      record = recordKey(el);
    return {
      tagName: el.tagName.toLowerCase(),
      selector: selector(el),
      fingerprint: evidenceFingerprint,
      ...(record ? { recordIdentity: record } : {}),
      point,
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      screenshotPoint: {
        x: r.x + point.x * r.width,
        y: r.y + point.y * r.height,
      },
      pagePoint: {
        x: scrollX + r.x + point.x * r.width,
        y: scrollY + r.y + point.y * r.height,
      },
      styles: {
        fontFamily: style.fontFamily.slice(0, 200),
        fontSize: style.fontSize.slice(0, 50),
        color: style.color.slice(0, 100),
        backgroundColor: style.backgroundColor.slice(0, 100),
        borderWidth: style.borderWidth.slice(0, 100),
        borderStyle: style.borderStyle.slice(0, 100),
        borderColor: style.borderColor.slice(0, 100),
        borderRadius: style.borderRadius.slice(0, 100),
      },
    };
  }
  const signature = () => {
    const url = new URL(location.href);
    url.hash = "";
    return `${url.href}|${innerWidth}|${innerHeight}|${scrollX}|${scrollY}|${devicePixelRatio}`;
  };
  function button(text, action, parent = bar) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = text;
    b.onclick = async () => {
      notice.textContent = "";
      b.disabled = true;
      try {
        await action(b);
      } catch (e) {
        notice.textContent = e.message;
        revealDrawer();
      } finally {
        b.disabled = false;
      }
    };
    parent.append(b);
    return b;
  }
  async function changeMode(value, narrow = false) {
    const result = await send({ type: "resize", mode: value, narrow });
    mode = value;
    requested = result.requested;
    for (const control of sizes.querySelectorAll("[data-viewport-mode]"))
      control.setAttribute(
        "aria-pressed",
        String(control.dataset.viewportMode === value),
      );
    setTimeout(() => {
      renderPins();
      if (value === "mobile" && innerWidth > 450)
        notice.textContent =
          "Chrome kept a wider minimum. Use “Move to narrow window” for mobile. Your page stays loaded.";
    }, 450);
  }
  function closePointMenu(restoreFocus = false) {
    if (!pointMenu) return;
    pointMenu.classList.add("hidden");
    freezeFrame.classList.add("hidden");
    freezeFrame.removeAttribute("src");
    if (restoreFocus && chosen?.element?.isConnected)
      chosen.element.focus({ preventScroll: true });
  }
  function clearChosenPoint(token) {
    if (token && chosen?.token !== token) return;
    chosen?.instantDispose?.();
    chosen = null;
    freezePending = false;
    freezeFrame?.classList.add("hidden");
    freezeFrame?.removeAttribute("src");
    targetBox?.classList.add("hidden");
  }
  function choosePoint(el, x, y) {
    if (el?.nodeType !== 1 || !el.isConnected) return false;
    const r = F.rect(el);
    if (!r.width || !r.height) return false;
    choosing = false;
    releasePointImage(chosen);
    clearChosenPoint();
    chosen = {
      token: crypto.randomUUID(),
      element: el,
      record: identity(),
      viewport: { width: innerWidth, height: innerHeight },
      capturedAt: new Date().toISOString(),
      fingerprint: fingerprint(el),
      point: {
        x: Math.max(0, Math.min(1, (x - r.x) / r.width)),
        y: Math.max(0, Math.min(1, (y - r.y) / r.height)),
      },
    };
    chosen.evidence = targetEvidence(
      el,
      chosen.point,
      chosen.fingerprint || `evidence-v1:${crypto.randomUUID()}`,
    );
    pointSignature = signature();
    Object.assign(targetBox.style, {
      left: `${r.x}px`,
      top: `${r.y}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
    });
    targetBox.classList.remove("hidden");
    renderChosenPoint();
    return true;
  }
  function assertPoint(token) {
    if (!token) return;
    if (
      !chosen ||
      chosen.token !== token ||
      pointSignature !== signature() ||
      !chosen.element.isConnected ||
      (chosen.instantValid && !chosen.instantValid())
    )
      throw Error("The page moved. Right-click the point again.");
    const r = F.rect(chosen.element),
      was = chosen.evidence.rect;
    if (
      selector(chosen.element) !== chosen.evidence.selector ||
      fingerprint(chosen.element) !== chosen.fingerprint ||
      ["x", "y", "width", "height"].some((key) => Math.abs(r[key] - was[key]) > 1)
    )
      throw Error("The element moved. Right-click the point again.");
  }
  function renderDraftPoints() {
    if (draftEditing) return;
    const locations = annotations.map(draftLocation);
    const renderSignature = JSON.stringify([
      showPins,
      pendingReview,
      annotations.map((item, index) => [
        item.id,
        item.body,
        !!item.snapshot,
        locations[index].visible,
        locations[index].reason,
        locations[index].x,
        locations[index].y,
      ]),
    ]);
    if (draftRenderSignature === renderSignature) return;
    draftRenderSignature = renderSignature;
    activePreviewHide?.();
    occlusionPins = occlusionPins.filter((entry) => entry.kind !== "draft");
    draftPoints.replaceChildren();
    draftList.replaceChildren();
    let outside = 0;
    annotations.forEach((item, index) => {
      const location = locations[index];
      if (!location.visible) outside++;
      const row = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = `${index + 1}. ${item.body}`;
      row.append(label);
      const state = document.createElement("small");
      state.className = "draft-state";
      state.textContent = `${location.visible ? "On this view" : location.reason} · ${item.snapshot ? "Original image saved" : "No original image"}`;
      row.append(state);
      if (item.snapshot) button("Original view", () => showPointImage(item, index), row);
      const editButton = button(
        "Edit",
        () => {
          if (pendingReview) return send({ type: "openCapturedReview" });
          draftEditing = true;
          row.replaceChildren();
          const edit = document.createElement("textarea");
          edit.value = item.body;
          edit.maxLength = 4000;
          edit.rows = 2;
          edit.setAttribute("aria-label", `Edit point ${index + 1}`);
          row.append(edit);
          button(
            "Save",
            () => {
              if (!edit.value.trim()) {
                edit.focus();
                return;
              }
              item.body = edit.value.trim();
              draftEditing = false;
              draftRenderSignature = "";
              renderDraftPoints();
            },
            row,
          );
          button(
            "Cancel",
            () => {
              draftEditing = false;
              draftRenderSignature = "";
              renderDraftPoints();
            },
            row,
          );
          edit.focus();
        },
        row,
      );
      button(
        "Remove",
        () => {
          if (pendingReview) return send({ type: "openCapturedReview" });
          releasePointImage(item);
          annotations.splice(index, 1);
          renderDraftPoints();
        },
        row,
      );
      draftList.append(row);
      if (!location.visible || !showPins) return;
      const { x, y, element } = location;
      const pin = document.createElement("button");
      pin.className = "pin saved-draft-pin";
      pin.type = "button";
      pin.textContent = String(index + 1);
      pin.style.left = `${x}px`;
      pin.style.top = `${y}px`;
      pin.setAttribute(
        "aria-label",
        `Draft point ${index + 1}, not sent: ${item.body}. Click to edit.`,
      );
      pin.title = `Draft · not sent. ${item.body} Click to edit. Take a screenshot, review it, then Send feedback to share.`;
      pin.onclick = () => {
        revealDrawer();
        editButton.click();
        row.scrollIntoView({ block: "nearest" });
      };
      draftPoints.append(pin);
      let preview, hideTimer;
      const hide = () => {
        clearTimeout(hideTimer);
        preview?.remove();
        preview = null;
        if (activePreviewHide === hide) activePreviewHide = null;
      };
      const show = () => {
        clearTimeout(hideTimer);
        if (preview?.isConnected) return;
        activePreviewHide?.();
        activePreviewHide = hide;
        preview = document.createElement("section");
        preview.className = "preview draft-preview";
        preview.setAttribute("aria-label", `Draft point ${index + 1}`);
        const state = document.createElement("strong");
        state.textContent = `Point ${index + 1} · Draft, not sent`;
        const note = document.createElement("p");
        note.className = "preview-note";
        note.textContent = item.body;
        const hint = document.createElement("p");
        hint.className = "meta";
        hint.textContent =
          "Review screenshots, then Send feedback to share with your team.";
        preview.append(state, note, hint);
        button(
          "Edit point",
          () => {
            hide();
            pin.click();
          },
          preview,
        );
        if (item.snapshot)
          button("Original view", () => showPointImage(item, index), preview);
        draftPoints.append(preview);
        const rect = preview.getBoundingClientRect();
        preview.style.left = `${Math.max(8, Math.min(x + 18, innerWidth - rect.width - 8))}px`;
        preview.style.top = `${Math.max(8, Math.min(y + 18, innerHeight - rect.height - 8))}px`;
        preview.onpointerenter = () => clearTimeout(hideTimer);
        preview.onpointerleave = leave;
        preview.onfocusin = () => clearTimeout(hideTimer);
        preview.onfocusout = leave;
      };
      const leave = () => {
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
          if (!preview?.matches(":hover") && !preview?.contains(root.activeElement))
            hide();
        }, 250);
      };
      pin.onpointerenter = show;
      pin.onfocus = show;
      pin.onpointerleave = leave;
      pin.onblur = leave;
      occlusionPins.push({ kind: "draft", pin, element, x, y, hidePreview: hide });
    });
    reviewButton.hidden = annotations.length === 0;
    drawerHandle.textContent = annotations.length
      ? `Feedbacks · ${annotations.length} not sent${outside ? ` · ${outside} outside this view` : ""}`
      : "Feedbacks";
    drawerHandle.title = "Open or collapse review controls and unsent points";
    positionControls();
    meta.textContent = annotations.length
      ? `${annotations.length} points not sent${outside ? ` · ${outside} outside this view` : ""}. Open any point below to edit or view its original image.`
      : `${threads.length} comments on this view · ${innerWidth} × ${innerHeight}`;
    schedulePinOcclusion();
  }
  function releasePointImage(item) {
    if (item?.snapshot)
      send({ type: "releasePointImage", key: item.snapshot.key }).catch(() => {});
  }
  async function showPointImage(item, index) {
    const { image } = await send({ type: "pointImage", key: item.snapshot.key });
    activePreviewHide?.();
    const preview = document.createElement("section");
    preview.className = "point-image-view";
    preview.setAttribute("role", "dialog");
    preview.setAttribute("aria-label", `Original view for point ${index + 1}`);
    const heading = document.createElement("strong");
    heading.textContent = `Point ${index + 1} · Original ${item.snapshot.viewport.width} × ${item.snapshot.viewport.height} view · Not sent`;
    const imageElement = document.createElement("img");
    imageElement.src = image;
    imageElement.alt = `Original page state for point ${index + 1}: ${item.body}`;
    preview.append(heading);
    const close = button("Close original view", () => preview.remove(), preview);
    const stage = document.createElement("div");
    stage.className = "point-image-stage";
    stage.append(imageElement);
    const marker = document.createElement("span");
    marker.className = "image-point";
    marker.textContent = String(index + 1);
    marker.style.left = `${(item.anchor.screenshotPoint.x / item.snapshot.viewport.width) * 100}%`;
    marker.style.top = `${(item.anchor.screenshotPoint.y / item.snapshot.viewport.height) * 100}%`;
    stage.append(marker);
    preview.append(stage);
    root.append(preview);
    close.focus();
  }
  function draftLocation(item) {
    // A live DOM reference survives responsive reflow. Never move a point to a
    // different element merely because it occupies the old coordinates.
    let element = item.element;
    if (
      !element?.isConnected &&
      /^(record-v3:|heading-v1:)/.test(item.anchor.fingerprint || "")
    ) {
      try {
        const candidates = F.find(item.anchor.selector);
        if (
          candidates.length === 1 &&
          fingerprint(candidates[0]) === item.anchor.fingerprint
        )
          element = candidates[0];
      } catch {}
    }
    if (!element?.isConnected)
      return { visible: false, reason: "Element no longer available" };
    const r = F.rect(element);
    const style = element.ownerDocument.defaultView.getComputedStyle(element);
    if (
      !r.width ||
      !r.height ||
      style.visibility === "hidden" ||
      style.display === "none" ||
      style.opacity === "0" ||
      element.closest('[hidden],[aria-hidden="true"]')
    )
      return { visible: false, reason: "Element hidden in this view" };
    const x = r.x + r.width * (item.anchor.point?.x ?? 0.5);
    const y = r.y + r.height * (item.anchor.point?.y ?? 0.5);
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight)
      return { visible: false, reason: "Outside visible area", element, x, y };
    const top = document.elementsFromPoint(x, y).find((el) => el !== host);
    if (!top || (!element.contains(top) && !top.contains(element)))
      return { visible: false, reason: "Covered by another element", element, x, y };
    return { visible: true, element, x, y };
  }
  function savePoint() {
    hoverTarget = null;
    hoverBox?.classList.add("hidden");
    if (!chosen) throw Error("Right-click an element first.");
    // The selected element may disappear when a hover menu loses focus. Its
    // geometry and selector were recorded at the right-click, before editing.
    if (pointSignature !== signature())
      throw Error("The page moved. Right-click the point again.");
    const body = pointText.value.trim();
    if (!body) {
      pointMenu.querySelector(".point-tip").textContent =
        "Write a comment for this point first.";
      pointText.focus();
      return;
    }
    if (annotations.length >= 100)
      throw Error("Send this review before adding more points.");
    annotations.push({
      id: crypto.randomUUID(),
      body,
      element: chosen.element,
      snapshot: chosen.snapshot,
      anchor: {
        ...chosen.evidence,
        viewport: chosen.viewport,
        capturedAt: chosen.capturedAt,
        confidence:
          chosen.fingerprint &&
          chosen.element.isConnected &&
          fingerprint(chosen.element) === chosen.fingerprint
            ? "element"
            : chosen.snapshotOnly || chosen.fingerprint
              ? "unmatched"
              : "coordinate-only",
      },
    });
    pointText.value = "";
    pointMenu.querySelector(".point-tip").textContent =
      "The outlined element and this comment stay together.";
    closePointMenu();
    clearChosenPoint();
    renderDraftPoints();
    notice.textContent = `Point ${annotations.length} saved here, not sent. Right-click another element or review screenshots and send.`;
    revealDrawer(false);
  }
  async function capturePoint() {
    if (pointRequest || !annotations.length) return;
    if (draftEditing)
      throw Error("Save or cancel the point edit before reviewing screenshots.");
    if (chosen && pointText.value.trim()) savePoint();
    else if (chosen) {
      pointText.value = "";
      clearChosenPoint();
    }
    pointRequest = true;
    closePointMenu();
    notice.textContent = "Capturing your review…";
    try {
      await send({ type: "capture", scope: "visible" });
      notice.textContent = "Review the screenshot and send your comments.";
    } catch (error) {
      notice.textContent = error.message;
      throw error;
    } finally {
      pointRequest = false;
    }
  }
  async function openPointMenu(el, x, y) {
    hoverTarget = null;
    hoverBox?.classList.add("hidden");
    if (pointRequest || captureActive) return;
    if (pendingReview) {
      await send({ type: "openCapturedReview" });
      return;
    }
    if (freezePending) return;
    if (chosen && pointText.value.trim()) {
      pointMenu.classList.remove("hidden");
      pointMenu.querySelector(".point-tip").textContent =
        "Save or cancel your current point before selecting another.";
      pointText.focus({ preventScroll: true });
      return;
    }
    // A menu may still be entering when it is selected. Hold its visual
    // position while Chrome captures it, then resume the website's motion.
    const motions = document
      .getAnimations()
      .filter((motion) => motion.playState === "running");
    for (const motion of motions) motion.pause();
    const resumeMotion = () => {
      for (const motion of motions) if (motion.playState === "paused") motion.play();
    };
    if (!choosePoint(el, x, y)) {
      resumeMotion();
      return;
    }
    const token = chosen.token;
    freezePending = true;
    host.style.setProperty("display", "none", "important");
    try {
      // Flush the hidden extension UI before Chrome captures the still-hovered
      // website. Keep that original view with the point until explicit Send.
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      const { image, snapshot } = await send({ type: "freezeView", key: token });
      if (chosen?.token === token && pointSignature === signature()) {
        chosen.snapshot = snapshot;
        freezeFrame.src = image;
        freezeFrame.classList.remove("hidden");
      } else releasePointImage({ snapshot });
    } catch (error) {
      // A denied screenshot must not prevent a text-only point from being saved.
      pointMenu.querySelector(".point-tip").textContent =
        `Original view could not be saved: ${error.message} Your point text can still be saved.`;
    } finally {
      resumeMotion();
      host.style.removeProperty("display");
      freezePending = false;
    }
    if (chosen?.token !== token || pointSignature !== signature()) return;
    pointMenu.classList.remove("hidden");
    const r = pointMenu.getBoundingClientRect();
    pointMenu.style.left = `${Math.max(8, Math.min(x + 16, innerWidth - r.width - 8))}px`;
    pointMenu.style.top = `${Math.max(8, Math.min(y + 16, innerHeight - r.height - 8))}px`;
    pointText.focus({ preventScroll: true });
  }
  function renderChosenPoint() {
    draftPin.classList.add("hidden");
    if (!chosen || chosen.record !== identity()) return;
    const r =
      chosen.snapshotOnly || !chosen.element.isConnected
        ? chosen.evidence.rect
        : F.rect(chosen.element);
    Object.assign(targetBox.style, {
      left: `${r.x}px`,
      top: `${r.y}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
    });
    targetBox.classList.remove("hidden");
    const x = r.x + r.width * chosen.point.x,
      y = r.y + r.height * chosen.point.y;
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return;
    draftPin.style.left = `${x}px`;
    draftPin.style.top = `${y}px`;
    draftPin.classList.remove("hidden");
  }
  function setup(css) {
    draftRenderSignature = "";
    host = document.createElement("div");
    (globalThis.feedbacksOwnedRoots ||= new WeakSet()).add(host);
    host.id = "feedbacks-review-root";
    host.style.cssText =
      "all:initial!important;position:fixed!important;z-index:2147483647!important;pointer-events:none!important;inset:0!important";
    root = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = css;
    root.append(style);
    bar = document.createElement("section");
    bar.className = "bar hidden";
    bar.style.pointerEvents = "auto";
    bar.setAttribute("aria-label", "Feedbacks review");
    root.append(bar);
    reviewDock = document.createElement("div");
    reviewDock.className = "review-dock";
    root.append(reviewDock);
    const grip = button("⠿", () => {}, reviewDock);
    grip.className = "review-drag";
    grip.setAttribute("aria-label", "Move review controls");
    movableControls(grip);
    drawerHandle = document.createElement("button");
    drawerHandle.className = "drawer-handle";
    drawerHandle.textContent = "Feedbacks";
    drawerHandle.setAttribute("aria-expanded", "false");
    drawerHandle.setAttribute("aria-controls", "feedbacks-drawer");
    drawerHandle.onclick = () => revealDrawer(bar.classList.contains("hidden"));
    drawerHandle.hidden = false;
    reviewDock.append(drawerHandle);
    const dockExit = button("Exit", exitReview, reviewDock);
    dockExit.className = "dock-exit";
    dockExit.title = "Exit review (R). Draft points stay on this page.";
    dockExit.setAttribute("aria-label", "Exit review");
    bar.id = "feedbacks-drawer";
    bar.addEventListener("pointerenter", () => clearTimeout(drawerTimer));

    bar.addEventListener("focusin", () => clearTimeout(drawerTimer));

    const heading = document.createElement("strong");
    heading.textContent = `Feedbacks · ${project.name}`;
    const barHeading = document.createElement("div");
    barHeading.className = "review-bar-heading";
    barHeading.append(heading);
    button("Collapse", () => revealDrawer(false), barHeading);
    button(
      "Hide",
      () => {
        revealDrawer(false);
        reviewDock.hidden = true;
        activePreviewHide?.();
      },
      barHeading,
    ).title = "Hide page controls. Reopen Feedbacks from Chrome to restore them.";
    bar.append(barHeading);
    meta = document.createElement("p");
    meta.className = "meta";
    bar.append(meta);
    const row = document.createElement("div");
    row.className = "row";
    bar.append(row);
    button(
      "Choose element",
      () => {
        closePointMenu();
        choosing = true;
        notice.textContent = "Click the element to review. Escape cancels selection.";
      },
      row,
    );
    button(
      "Capture & annotate",
      async () => {
        if (annotations.length) await capturePoint();
        else await send({ type: "capture" });
      },
      row,
    ).className = "primary";
    button(
      "Hide pins",
      (b) => {
        showPins = !showPins;
        b.textContent = showPins ? "Hide pins" : "Show pins";
        b.setAttribute("aria-pressed", String(!showPins));
        renderPins();
      },
      row,
    ).setAttribute("aria-pressed", "false");
    button(
      "Show resolved",
      async (b) => {
        showResolved = !showResolved;
        b.textContent = showResolved ? "Hide resolved" : "Show resolved";
        b.setAttribute("aria-pressed", String(showResolved));
        await loadPins();
      },
      row,
    ).setAttribute("aria-pressed", "false");
    sizes = document.createElement("div");
    sizes.className = "row";
    sizes.style.marginTop = "8px";
    bar.append(sizes);
    for (const [label, value] of [
      ["M", "mobile"],
      ["T", "tablet"],
      ["D", "desktop"],
      ["W", "wide"],
    ]) {
      const control = button(label, () => changeMode(value), sizes);
      control.title = `${value} viewport`;
      control.dataset.viewportMode = value;
      control.setAttribute("aria-pressed", String(mode === value));
    }
    button("Move to narrow window", () => changeMode("mobile", true), sizes);
    button("Exit review", exitReview, sizes);
    notice = document.createElement("p");
    notice.className = "notice";
    notice.setAttribute("role", "status");
    bar.append(notice);
    categoryLists = document.createElement("div");
    categoryLists.className = "category-lists";
    bar.append(categoryLists);
    pinLayer = document.createElement("div");
    root.append(pinLayer);
    hoverBox = document.createElement("div");
    hoverBox.className = "hover-target hidden";
    root.append(hoverBox);
    targetBox = document.createElement("div");
    targetBox.className = "target hidden";
    root.append(targetBox);
    freezeFrame = document.createElement("img");
    freezeFrame.className = "freeze-frame hidden";
    freezeFrame.alt = "";
    freezeFrame.setAttribute("aria-hidden", "true");
    for (const event of ["wheel", "touchmove"])
      freezeFrame.addEventListener(event, (action) => action.preventDefault(), {
        passive: false,
      });
    root.append(freezeFrame);
    draftPin = document.createElement("span");
    draftPin.className = "pin draft-pin hidden";
    draftPin.setAttribute("aria-label", "Selected feedback point — not sent");
    draftPin.textContent = "+";
    root.append(draftPin);
    pointMenu = document.createElement("section");
    pointMenu.className = "point-menu hidden";
    pointMenu.setAttribute("role", "dialog");
    pointMenu.setAttribute("aria-label", "Feedback at this point");
    root.append(pointMenu);
    const pointHeading = document.createElement("strong");
    pointHeading.textContent = "Comment on this element";
    pointMenu.append(pointHeading);
    pointText = document.createElement("textarea");
    pointText.rows = 3;
    pointText.maxLength = 4000;
    pointText.placeholder = "What should change here?";
    pointText.setAttribute("aria-label", "Comment on selected element");
    pointMenu.append(pointText);
    button("Save point", savePoint, pointMenu).className = "primary";
    button(
      "Cancel",
      () => {
        releasePointImage(chosen);
        closePointMenu(true);
        pointText.value = "";
        clearChosenPoint();
        renderPins();
      },
      pointMenu,
    );
    const tip = document.createElement("p");
    tip.className = "point-tip";
    tip.textContent = "The outlined element and this comment stay together.";
    pointMenu.append(tip);
    draftPoints = document.createElement("div");
    root.append(draftPoints);
    const draftSection = document.createElement("section");
    draftSection.className = "draft-section";
    draftList = document.createElement("ol");
    draftSection.append(draftList);
    reviewButton = button("Review screenshots", capturePoint, draftSection);
    reviewButton.className = "primary";
    reviewButton.hidden = true;
    bar.append(draftSection);
    const shortcutTip = document.createElement("p");
    shortcutTip.className = "meta";
    shortcutTip.textContent =
      "While not typing: M mobile · T tablet · D desktop · W reset · S screenshot · R exit review.";
    bar.append(shortcutTip);
    document.documentElement.append(host);
  }
  async function loadPins() {
    if (!active || document.visibilityState !== "visible") return;
    const request = {
      generation: activationGeneration,
      projectId: project.id,
      reviewId,
      signature: signature(),
      showResolved,
    };
    const current = () =>
      active &&
      request.generation === activationGeneration &&
      request.projectId === project.id &&
      request.reviewId === reviewId &&
      request.signature === signature() &&
      request.showResolved === showResolved;
    if (
      loadingPins &&
      loadingPins.generation === request.generation &&
      loadingPins.signature === request.signature &&
      loadingPins.showResolved === request.showResolved
    )
      return;
    loadingPins = request;
    try {
      let offset = 0,
        all = [];
      do {
        if (!current()) return;
        const data = await send({
          type: "threads",
          projectId: request.projectId,
          reviewId: request.reviewId,
          showResolved: request.showResolved,
          offset,
        });
        if (!current()) return;
        all.push(...data.items);
        offset = data.nextOffset;
      } while (offset !== null && all.length < 10000);
      threads = all;
      renderPins();
    } catch (error) {
      if (current()) throw error;
    } finally {
      if (loadingPins === request) loadingPins = null;
    }
  }
  function renderPins() {
    if (!active) return;
    occlusionPins = occlusionPins.filter((entry) => entry.kind === "draft");
    pinLayer.replaceChildren();
    targetBox.classList.add("hidden");
    const current = {
      url: U.safeUrl(location.href),
      viewport: { width: innerWidth, height: innerHeight },
    };
    renderChosenPoint();
    renderDraftPoints();
    const unmatched = [],
      other = [];
    let matched = 0;
    for (const thread of threads) {
      if (!U.pinVisible(thread, showResolved)) continue;
      const linked = thread.context.annotations?.length
        ? thread.context.annotations
        : [{ anchor: thread.context.anchor, body: thread.body }];
      for (const item of linked) {
        const pointState = U.pointState(thread, item.id);
        if (pointState === "removed" || (!showResolved && pointState !== "open"))
          continue;
        const a = item.anchor;
        let element;
        if (
          U.safeUrl(thread.context.url) === current.url &&
          a?.confidence === "element" &&
          a.selector &&
          /^(record-v3:|heading-v1:)/.test(a.fingerprint || "")
        ) {
          try {
            const candidates = F.find(a.selector);
            if (candidates.length === 1 && fingerprint(candidates[0]) === a.fingerprint)
              element = candidates[0];
          } catch {}
        }
        if (
          !element &&
          U.sameContext(thread.context, current) &&
          a?.confidence === "coordinate-only" &&
          a.selector &&
          a.rect &&
          a.pagePoint
        ) {
          try {
            const candidates = F.find(a.selector);
            if (candidates.length === 1) {
              const candidate = candidates[0];
              const r = F.rect(candidate);
              const x = a.pagePoint.x - scrollX;
              const y = a.pagePoint.y - scrollY;
              if (
                Math.abs(r.width - a.rect.width) <= 2 &&
                Math.abs(r.height - a.rect.height) <= 2 &&
                x >= r.left - 2 &&
                x <= r.right + 2 &&
                y >= r.top - 2 &&
                y <= r.bottom + 2
              )
                element = candidate;
            }
          } catch {}
        }
        if (!element) {
          const list =
            U.device((a?.viewport || thread.context.viewport).width) ===
            U.device(innerWidth)
              ? unmatched
              : other;
          if (!list.includes(thread)) list.push(thread);
          continue;
        }
        const r = F.rect(element);
        matched++;
        if (!showPins || !r.width || !r.height) continue;
        const x = r.x + r.width * (a.point?.x ?? 0.5),
          y = r.y + r.height * (a.point?.y ?? 0.5);
        if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
        const pin = button(
          String(matched),
          () => send({ type: "openThread", id: thread.id }),
          pinLayer,
        );
        pin.className = `pin${pointState !== "open" ? " resolved" : ""}`;
        pin.style.pointerEvents = "auto";
        pin.style.left = `${x}px`;
        pin.style.top = `${y}px`;
        pin.setAttribute(
          "aria-label",
          `${thread.author.name}, ${ageLabel(thread.createdAt)}: ${item.body.slice(0, 160)}. Open thread for details.`,
        );
        let preview, hideTimer;
        const hide = () => {
          clearTimeout(hideTimer);
          preview?.remove();
          preview = null;
          if (activePreviewHide === hide) activePreviewHide = null;
        };
        const scheduleHide = () => {
          clearTimeout(hideTimer);
          hideTimer = setTimeout(() => {
            if (preview?.matches(":hover") || preview?.contains(root.activeElement))
              return;
            hide();
          }, 180);
        };
        const show = () => {
          clearTimeout(hideTimer);
          if (preview?.isConnected) return;
          activePreviewHide?.();
          preview = document.createElement("div");
          activePreviewHide = hide;
          preview.className = "preview";
          const byline = document.createElement("p");
          byline.className = "preview-byline";
          byline.textContent = `${thread.author.name} · ${ageLabel(thread.createdAt)} · ${pointState === "open" ? "Open" : pointState === "closed" ? "Thread closed" : "Resolved"}`;
          byline.title = new Date(thread.createdAt).toLocaleString();
          const note = document.createElement("p");
          note.className = "preview-note";
          note.textContent = item.body;
          const actions = document.createElement("div");
          actions.className = "preview-actions";
          const link = document.createElement("a");
          link.href = thread.threadUrl;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.textContent = "Open thread";
          actions.append(link);
          if (
            project.canResolve &&
            !["resolved", "declined"].includes(thread.work.state)
          ) {
            const resolve = button(
              item.id
                ? pointState === "resolved"
                  ? "Reopen point"
                  : "Resolve point"
                : "Resolve thread",
              async () => {
                try {
                  await send(
                    item.id
                      ? {
                          type: "pointStatus",
                          id: thread.id,
                          annotationId: item.id,
                          revision: thread.revision,
                          state: pointState === "resolved" ? "open" : "resolved",
                          reviewId,
                        }
                      : { type: "resolveThread", id: thread.id, reviewId },
                  );
                } catch (error) {
                  if (!/outside token scope|unknown operation/i.test(error.message))
                    throw error;
                  await send({ type: "openThread", id: thread.id });
                  notice.textContent =
                    "Manage this point in the thread. Update the server and reconnect Feedbacks for point actions here.";
                  revealDrawer();
                  return;
                }
                hide();
                await loadPins();
                notice.textContent = item.id
                  ? pointState === "resolved"
                    ? "Point reopened."
                    : "Point resolved. Other points and the thread stay open."
                  : "Thread resolved. Its pin is hidden.";
              },
              actions,
            );
            resolve.className = "resolve-thread";
          }
          preview.append(byline, note, actions);
          preview.style.left = `${Math.max(8, Math.min(x + 18, innerWidth - 302))}px`;
          preview.style.top = `${Math.max(8, Math.min(y + 18, innerHeight - 185))}px`;
          preview.addEventListener("pointerenter", () => clearTimeout(hideTimer));
          preview.addEventListener("pointerleave", scheduleHide);
          preview.addEventListener("focusin", () => clearTimeout(hideTimer));
          preview.addEventListener("focusout", scheduleHide);
          pinLayer.append(preview);
        };
        pin.onmouseenter = show;
        pin.onfocus = show;
        pin.onmouseleave = scheduleHide;
        pin.onblur = scheduleHide;
        occlusionPins.push({ kind: "published", pin, element, x, y, hidePreview: hide });
      }
    }
    renderCategories(unmatched, other);
    if (!annotations.length)
      meta.textContent = `${matched + unmatched.length} comments on this view · ${innerWidth} × ${innerHeight}`;
    schedulePinOcclusion();
  }
  function renderCategories(unmatched, other) {
    // Keep open details and keyboard focus stable during scroll/repaint.
    const signature = JSON.stringify(
      [unmatched, other].map((items) => items.map((t) => [t.id, t.revision])),
    );
    if (categoryLists.dataset.signature === signature) return;
    categoryLists.dataset.signature = signature;
    const opened = [...categoryLists.querySelectorAll("details[open]")].map(
      (el) => el.dataset.category,
    );
    categoryLists.replaceChildren();
    for (const [label, items] of [
      ["Comments without a pin", unmatched],
      ["Comments on other screen sizes", other],
    ]) {
      if (!items.length) continue;
      const details = document.createElement("details"),
        summary = document.createElement("summary");
      details.dataset.category = label;
      details.open = opened.includes(label);
      summary.textContent = `${label} (${items.length})`;
      details.append(summary);
      if (label === "Comments without a pin") {
        const explanation = document.createElement("p");
        explanation.textContent =
          "Saved safely. The original element could not be located on this page.";
        details.append(explanation);
      }
      const list = document.createElement("ul");
      for (const thread of items) {
        const item = document.createElement("li"),
          preview = document.createElement("p");
        preview.textContent = `${thread.author.name}: ${thread.body.slice(0, 300)}`;
        item.append(preview);
        button("Open thread", () => send({ type: "openThread", id: thread.id }), item);
        const { width, height } = thread.context.viewport;
        button(
          `Preview ${width} × ${height}`,
          () => send({ type: "openThread", id: thread.id, preview: true }),
          item,
        );
        list.append(item);
      }
      details.append(list);
      categoryLists.append(details);
    }
  }
  // Window capture runs before site handlers on document. Only explicit review
  // mode intercepts right-click; Shift+right-click bypasses the review menu.
  F.listen(
    "pointerdown",
    (event) => {
      if (!active || event.composedPath().includes(host)) return;
      if (event.button === 2 && !event.shiftKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        openPointMenu(event.target, event.clientX, event.clientY);
      } else closePointMenu();
    },
    true,
  );
  F.listen(
    "contextmenu",
    (event) => {
      if (!active || event.shiftKey || event.composedPath().includes(host)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      // Also supports keyboard context-menu and macOS Control-click.
      if (pointMenu.classList.contains("hidden") && !freezePending) {
        const el = event.target;
        if (el?.nodeType !== 1) return;
        const r = F.rect(el);
        openPointMenu(
          el,
          event.clientX || r.x + r.width / 2,
          event.clientY || r.y + r.height / 2,
        );
      }
    },
    true,
  );
  F.listen(
    "click",
    (event) => {
      if (!active || event.composedPath().includes(host)) return;
      const quick = event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
      if (!choosing && !quick) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (quick) {
        openPointMenu(event.target, event.clientX, event.clientY);
        return;
      }
      if (!choosePoint(event.target, event.clientX, event.clientY)) return;
      notice.textContent = "Point selected. Write your comment beside the element.";
      const r = F.rect(chosen.element);
      Object.assign(targetBox.style, {
        left: `${r.x}px`,
        top: `${r.y}px`,
        width: `${r.width}px`,
        height: `${r.height}px`,
      });
      targetBox.classList.remove("hidden");
      openPointMenu(event.target, event.clientX, event.clientY);
    },
    true,
  );
  F.listen(
    "keydown",
    (event) => {
      if (!active) return;
      if (event.key === "Escape") {
        const imageView = root.querySelector(".point-image-view");
        if (imageView) {
          imageView.remove();
          return;
        }
        releasePointImage(chosen);
        closePointMenu(true);
        pointText.value = "";
        choosing = false;
        clearChosenPoint();
        renderPins();
        notice.textContent = "";
        revealDrawer(false);
        return;
      }
      if (event.composedPath().includes(host)) return;
      const value = reviewShortcuts && U.shortcut(event);
      if (value) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const action =
          value === "stop"
            ? send({ type: "stopReview" })
            : value === "capture" || value === "capture-full"
              ? send({
                  type: "capture",
                  scope: value === "capture-full" ? "fullPage" : "visible",
                })
              : changeMode(value);
        action.catch((e) => {
          notice.textContent = e.message;
          revealDrawer();
        });
      }
    },
    true,
  );
  let scheduled = false;
  let hoverTarget, hoverFrame;
  F.listen(
    "pointermove",
    (event) => {
      if (active) schedulePinOcclusion();
      if (!active) return;
      if (event.composedPath().includes(host)) {
        hoverBox.classList.add("hidden");
        return;
      }
      hoverTarget = event.target;
      if (hoverFrame) return;
      hoverFrame = requestAnimationFrame(() => {
        hoverFrame = null;
        if (
          !active ||
          freezePending ||
          captureActive ||
          hoverTarget?.nodeType !== 1 ||
          !pointMenu.classList.contains("hidden")
        ) {
          hoverBox.classList.add("hidden");
          return;
        }
        if (hoverTarget === document.documentElement || hoverTarget === document.body) {
          hoverBox.classList.add("hidden");
          return;
        }
        const r = F.rect(hoverTarget);
        Object.assign(hoverBox.style, {
          left: `${r.x}px`,
          top: `${r.y}px`,
          width: `${r.width}px`,
          height: `${r.height}px`,
        });
        hoverBox.classList.remove("hidden");
      });
    },
    { passive: true, capture: true },
  );
  F.listen("focusin", schedulePinOcclusion, true);
  F.listen("focusout", schedulePinOcclusion, true);
  F.listen(
    "pointerover",
    (event) => {
      schedulePinOcclusion();
      if (active && !event.composedPath().includes(host)) repaint();
    },
    true,
  );
  const layoutObserver = new MutationObserver((records) => {
    if (
      active &&
      records.some((record) => record.target !== host && !host?.contains(record.target))
    )
      repaint();
  });
  layoutObserver.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["class", "style", "hidden", "open", "aria-hidden", "aria-expanded"],
  });
  F.listen("visibilitychange", () => {
    if (active && document.visibilityState === "visible")
      loadPins().catch((error) => (notice.textContent = error.message));
  });
  const repaint = () => {
    if (active && !scheduled) {
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        renderPins();
      });
    }
  };
  F.listen(
    "scroll",
    (event) => {
      if (event.composedPath().includes(host)) return;
      if (event.target !== document && event.target !== window) {
        repaint();
        return;
      }
      closePointMenu();
      repaint();
    },
    { passive: true, capture: true },
  );
  F.listen("resize", (event) => {
    if (event.target !== window) return;
    positionControls();
    closePointMenu();
    repaint();
  });
  addEventListener("popstate", () => loadPins().catch(() => {}));
  addEventListener("hashchange", () => loadPins().catch(() => {}));
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== chrome.runtime.id) return;
    if (
      ![
        "activate",
        "reviewPreferences",
        "instantCapturePoint",
        "openInlinePoint",
        "choosePoint",
        "deactivate",
        "metrics",
        "feedbackSaved",
        "feedbackThreadCreated",
        "feedbackSubmissionIncomplete",
        "captureContext",
        "prepareCapture",
        "captureCheck",
        "fullPageMetrics",
        "fullPageScroll",
        "qaScan",
        "restore",
        "discardPoint",
        "discardDraftPoints",
        "draftPrepared",
        "popupControls",
      ].includes(message.type)
    )
      return;
    (async () => {
      if (message.type === "draftPrepared") {
        pendingReview = true;
        return {};
      }
      if (message.type === "discardDraftPoints") {
        annotations = [];
        pendingReview = false;
        renderPins();
        return {};
      }
      if (message.type === "popupControls") {
        if (!active) throw Error("Open Feedbacks to connect this page.");
        if (message.action === "show-controls") revealDrawer(true);
        if (message.action === "pins") {
          showPins = !showPins;
          renderPins();
        }
        if (message.action === "resolved") {
          showResolved = !showResolved;
          await loadPins();
        }
        return {
          showPins,
          showResolved,
          comments: threads.length,
          drafts: annotations.length,
          viewport: { width: innerWidth, height: innerHeight },
        };
      }
      if (message.type === "reviewPreferences") {
        reviewShortcuts = message.reviewShortcuts !== false;
        return {};
      }
      if (message.type === "activate") {
        reviewShortcuts = message.reviewShortcuts !== false;
        const wasActive = active && host?.isConnected;
        if (wasActive) reviewDock.hidden = false;
        activationGeneration++;
        reviewId = message.reviewId;
        threads = [];
        active = true;
        globalThis.feedbacksReviewActive = true;
        if (project?.id !== message.project.id) {
          threads = [];
          releasePointImage(chosen);
          annotations.forEach(releasePointImage);
          clearChosenPoint();
          annotations = [];
          host?.remove();
        }
        project = message.project;
        if (!host?.isConnected) setup(message.css);
        renderPins();
        if (!wasActive) revealDrawer(false);
        clearInterval(timer);
        timer = setInterval(
          () => loadPins().catch((e) => (notice.textContent = e.message)),
          15000,
        );
        loadPins().catch((e) => {
          if (active) {
            notice.textContent = e.message;
            revealDrawer();
          }
        });
        return {};
      }
      if (message.type === "instantCapturePoint") {
        const p = globalThis.feedbacksInstantPoint;
        if (!active || !p || p.signature !== signature())
          throw Error("The page moved. Right-click again.");
        const stable =
          p.valid?.() &&
          ["x", "y", "width", "height"].every(
            (key) => Math.abs(F.rect(p.element)[key] - p.rect[key]) <= 1,
          );
        if (stable && choosePoint(p.element, p.x, p.y)) {
          chosen.instantValid = p.valid;
          chosen.instantDispose = p.dispose;
        } else {
          clearChosenPoint();
          chosen = {
            token: crypto.randomUUID(),
            element: p.element,
            record: identity(),
            fingerprint: null,
            point: p.point,
            evidence: p.evidence,
            snapshotOnly: true,
            instantDispose: p.dispose,
          };
          pointSignature = signature();
          renderChosenPoint();
        }
        if (p.frozen) {
          freezeFrame.src = p.frozen;
          freezeFrame.classList.remove("hidden");
        }
        return { pointToken: chosen.token };
      }
      if (message.type === "openInlinePoint") {
        if (!chosen) throw Error("Right-click the element again.");
        const r =
          chosen.snapshotOnly || !chosen.element.isConnected
            ? chosen.evidence.rect
            : F.rect(chosen.element);
        pointMenu.classList.remove("hidden");
        const x = r.x + r.width * chosen.point.x;
        const y = r.y + r.height * chosen.point.y;
        pointMenu.style.left = `${Math.max(8, Math.min(x + 16, innerWidth - 336))}px`;
        pointMenu.style.top = `${Math.max(8, Math.min(y + 16, innerHeight - 245))}px`;
        pointText.focus({ preventScroll: true });
        return {};
      }
      if (message.type === "choosePoint") {
        choosing = true;
        revealDrawer();
        notice.textContent = "Click the point you want to comment on.";
        return {};
      }
      if (message.type === "deactivate") {
        activationGeneration++;
        clearChosenPoint();
        draftEditing = false;
        active = false;
        globalThis.feedbacksReviewActive = false;
        clearInterval(timer);
        clearTimeout(drawerTimer);
        host?.remove();
        return {};
      }
      if (message.type === "metrics")
        return { outerWidth, width: innerWidth, height: innerHeight };
      if (message.type === "feedbackSaved") {
        pendingReview = false;
        annotations = [];
        renderDraftPoints();
        if (chosen?.evidence.fingerprint === message.fingerprint) clearChosenPoint();
        notice.textContent =
          "Feedback sent. The thread and screenshots are ready for your team.";
        if (active) {
          renderPins();
          loadPins().catch((e) => {
            if (active) notice.textContent = e.message;
          });
        }
        return {};
      }
      if (message.type === "feedbackThreadCreated") {
        annotations = [];
        renderDraftPoints();
        if (chosen?.evidence.fingerprint === message.fingerprint) clearChosenPoint();
        notice.textContent =
          "Thread published. Screenshots are uploading in the review tab.";
        if (active) await loadPins();
        return {};
      }
      if (message.type === "feedbackSubmissionIncomplete") {
        notice.textContent =
          "Thread published, but sending is incomplete. Retry Send in the review tab to finish images.";
        if (active) await loadPins();
        return {};
      }
      if (message.type === "captureContext") {
        if (!active) throw Error("Review is not active.");
        assertPoint(message.pointToken);
        return context();
      }
      if (message.type === "qaScan") {
        if (!active || captureActive)
          throw Error("Start review before scanning the page.");
        const started = signature();
        const missingAlt = [...document.querySelectorAll("img:not([alt])")]
          .slice(0, 10)
          .map((image) =>
            Math.max(0, Math.round(image.getBoundingClientRect().top + scrollY)),
          );
        const links = [];
        for (const anchor of document.querySelectorAll("a[href]:not([download])")) {
          if (links.length >= 12) break;
          try {
            const url = new URL(anchor.href);
            if (
              url.origin === location.origin &&
              /^https?:$/.test(url.protocol) &&
              !links.includes(url.href)
            )
              links.push(url.href);
          } catch {}
        }
        const brokenLinks = [];
        for (let i = 0; i < links.length; i += 3) {
          await Promise.all(
            links.slice(i, i + 3).map(async (url) => {
              const controller = new AbortController();
              const timeout = setTimeout(() => controller.abort(), 3000);
              try {
                const response = await fetch(url, {
                  method: "HEAD",
                  credentials: "same-origin",
                  signal: controller.signal,
                  cache: "no-store",
                  redirect: "manual",
                });
                if ([404, 410].includes(response.status))
                  brokenLinks.push({
                    url: new URL(url).origin + new URL(url).pathname,
                    status: response.status,
                  });
              } catch {
                // Network and unsupported HEAD outcomes are unknown, not broken.
              } finally {
                clearTimeout(timeout);
              }
            }),
          );
        }
        if (signature() !== started)
          throw Error("The page moved during the scan. Try again once it is still.");
        return { missingAlt, brokenLinks, checkedLinks: links.length };
      }
      if (message.type === "prepareCapture") {
        if (!active) throw Error("Review is not active.");
        assertPoint(message.pointToken);
        captureActive = true;
        captureEpoch = 0;
        host.style.setProperty("display", "none", "important");
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
        assertPoint(message.pointToken);
        return {
          context: context(),
          signature: signature(),
          captureEpoch,
        };
      }
      if (message.type === "captureCheck") {
        assertPoint(message.pointToken);
        return { signature: signature(), captureEpoch };
      }
      if (message.type === "fullPageMetrics") {
        if (!captureActive || message.pointToken)
          throw Error("Start a full-page capture without a selected point.");
        return {
          url: U.safeUrl(location.href),
          viewportWidth: innerWidth,
          viewportHeight: innerHeight,
          documentWidth: (document.scrollingElement || document.documentElement)
            .scrollWidth,
          documentHeight: Math.max(
            document.documentElement.scrollHeight,
            document.body?.scrollHeight || 0,
          ),
        };
      }
      if (message.type === "fullPageScroll") {
        if (
          !captureActive ||
          message.pointToken ||
          !Number.isSafeInteger(message.y) ||
          (message.x !== undefined && !Number.isSafeInteger(message.x))
        )
          throw Error("Invalid full-page capture step.");
        scrollTo({ left: message.x || 0, top: message.y, behavior: "instant" });
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
        const metrics = {
          url: U.safeUrl(location.href),
          viewportWidth: innerWidth,
          viewportHeight: innerHeight,
          documentWidth: (document.scrollingElement || document.documentElement)
            .scrollWidth,
          documentHeight: Math.max(
            document.documentElement.scrollHeight,
            document.body?.scrollHeight || 0,
          ),
          x: scrollX,
          y: scrollY,
          signature: signature(),
          captureEpoch: 0,
        };
        captureEpoch = 0;
        return metrics;
      }
      if (message.type === "restore") {
        captureActive = false;
        if (message.scroll && Number.isSafeInteger(message.scroll.y))
          scrollTo({
            left: message.scroll.x || 0,
            top: message.scroll.y,
            behavior: "instant",
          });
        if (message.captured && message.pointToken) clearChosenPoint(message.pointToken);
        if (host) host.style.removeProperty("display");
        if (message.captured) renderPins();
        return {};
      }
      if (message.type === "discardPoint") {
        if (message.pointToken) clearChosenPoint(message.pointToken);
        renderPins();
        return {};
      }
      return {};
    })()
      .then(reply)
      .catch((e) => reply({ error: e.message }));
    return true;
  });
})();
