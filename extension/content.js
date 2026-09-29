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
    pointThumbnail,
    reviewButton,
    finalizeButton,
    draftList,
    pointRequest = false,
    pointSignature,
    freezePending = false,
    active = false,
    recordingOnly = false,
    reviewShortcuts = true,
    choosing = false,
    chosen = null,
    annotations = [],
    draftEditing = false,
    threads = [],
    showPins = true,
    showResolved = false,
    captureMarkerStyle = "ring",
    captureMarkerSize = "small",
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
    navigationLocked = true,
    navigationButton,
    recordingControls,
    recordingState = "idle",
    recordingMode = "video",
    recordingElapsedMs = 0,
    recordingUpdatedAt = 0,
    recordingTimer,
    recordingClock,
    recordingError,
    recordingFocusAction,
    recordingOptions = {},
    recordingRedirectOrigins = [],
    highlightEnabled = true,
    highlightButton,
    clickIndicators = true,
    beforeRecording,
    defaults = {},
    clicksButton,
    pinsButton,
    resolvedButton,
    diagnosticsButton,
    diagnosticsActive = false,
    diagnosticsBusy = false,
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
  const recordingBusy = (state = recordingState) =>
    ["starting", "recording", "paused", "stopping"].includes(state);
  function revealDrawer(open = true) {
    if (!bar) return;
    if (recordingOnly || recordingBusy()) {
      reviewDock.hidden = false;
      open = false;
    }
    if (open && bar.classList.contains("hidden")) void updateDiagnostics("status");
    if (open) reviewDock.hidden = false;
    bar.classList.toggle("hidden", !open);
    drawerHandle.setAttribute("aria-expanded", String(open));
    positionControls();
    clearTimeout(drawerTimer);
    // Keep the point list open until explicitly closed; edits must not disappear.
  }
  function collapseAfterLeave() {
    clearTimeout(drawerTimer);
    drawerTimer = setTimeout(() => {
      if (
        !bar.matches(":hover") &&
        !reviewDock.matches(":hover") &&
        !root.activeElement?.matches("textarea,input,select,[contenteditable]") &&
        !draftEditing
      )
        revealDrawer(false);
    }, 220);
  }
  function hideControls() {
    revealDrawer(false);
    reviewDock.hidden = true;
    activePreviewHide?.();
  }
  function setNavigationLock(value) {
    navigationLocked = value;
    navigationButton?.setAttribute("aria-pressed", String(value));
    if (navigationButton)
      navigationButton.textContent = value ? "Navigation locked" : "Navigation allowed";
  }
  function blockNavigation(event) {
    if (
      !active ||
      recordingOnly ||
      !navigationLocked ||
      event.composedPath?.().includes(host)
    )
      return;
    event.preventDefault();
    notice.textContent = "Navigation locked. Use Navigation allowed to follow links.";
    revealDrawer();
  }
  function setHighlight(value) {
    highlightEnabled = value;
    highlightButton?.setAttribute("aria-pressed", String(value));
    if (highlightButton)
      highlightButton.textContent = value ? "Highlight on" : "Highlight off";
    if (!value) hoverBox?.classList.add("hidden");
  }
  function setClicks(value) {
    clickIndicators = value;
    if (!clicksButton) return;
    clicksButton.textContent = value ? "Click indicators on" : "Click indicators off";
    clicksButton.setAttribute("aria-pressed", String(value));
  }
  function syncPinControls() {
    if (pinsButton) {
      pinsButton.textContent = showPins ? "Hide pins" : "Show pins";
      pinsButton.setAttribute("aria-pressed", String(!showPins));
    }
    if (resolvedButton) {
      resolvedButton.textContent = showResolved ? "Hide resolved" : "Show resolved";
      resolvedButton.setAttribute("aria-pressed", String(showResolved));
    }
  }
  async function updateDiagnostics(action) {
    if (!diagnosticsButton || diagnosticsBusy || !active) return;
    diagnosticsBusy = true;
    diagnosticsButton.disabled = true;
    try {
      const result = await send({ type: "diagnostics", action });
      diagnosticsActive = result.active === true;
      diagnosticsButton.textContent = diagnosticsActive
        ? "Stop diagnostics"
        : "Start diagnostics";
      diagnosticsButton.setAttribute("aria-pressed", String(diagnosticsActive));
      if (action !== "status")
        notice.textContent = diagnosticsActive
          ? "Diagnostics stay local. Capture within 5 minutes to review and share."
          : "Diagnostics stopped and discarded.";
    } catch (error) {
      if (action !== "status") notice.textContent = error.message;
    } finally {
      diagnosticsBusy = false;
      diagnosticsButton.disabled = false;
    }
  }
  const recordingPointAllowed = () => ["recording", "paused"].includes(recordingState);
  function syncRecordingAnnotationControls() {
    const editing = !!(chosen?.recordingAnnotation || chosen?.recordingAnnotationPending);
    for (const control of recordingControls?.querySelectorAll(
      "[data-recording-action]",
    ) || []) {
      control.disabled = editing;
      control.title = editing
        ? "Save or cancel this point before changing the recording."
        : "";
    }
    const hint = recordingControls?.querySelector(".recording-hint");
    if (hint)
      hint.textContent = editing ? "Save or cancel point" : "Right-click to comment";
  }
  function updateRecordingClock() {
    if (!recordingClock) return;
    const elapsed =
      recordingElapsedMs +
      (recordingState === "recording" ? performance.now() - recordingUpdatedAt : 0);
    const seconds = Math.max(0, Math.floor(elapsed / 1000));
    recordingClock.textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  }
  function renderRecording(
    state = recordingState,
    elapsedMs,
    captureMode = recordingMode,
  ) {
    const nextMode = captureMode === "session" ? "session" : "video";
    const busy = recordingBusy(state);
    const compact = busy || recordingOnly;
    if (compact && !beforeRecording) {
      beforeRecording = { highlightEnabled, navigationLocked, clickIndicators };
      setHighlight(false);
      setNavigationLock(!recordingOnly && defaults.recordingNavigationLocked === true);
      setClicks(defaults.recordingClickIndicators === true);
    } else if (!compact && beforeRecording) {
      setHighlight(beforeRecording.highlightEnabled);
      setNavigationLock(beforeRecording.navigationLocked);
      setClicks(beforeRecording.clickIndicators);
      beforeRecording = null;
    }
    const changed =
      state !== recordingState ||
      nextMode !== recordingMode ||
      !recordingControls?.childElementCount;
    const now = performance.now();
    recordingElapsedMs = Number.isFinite(elapsedMs)
      ? Math.max(0, elapsedMs)
      : !["idle", "starting"].includes(state)
        ? recordingElapsedMs +
          (recordingState === "recording" ? now - recordingUpdatedAt : 0)
        : 0;
    recordingUpdatedAt = now;
    recordingState = state;
    recordingMode = nextMode;
    clearInterval(recordingTimer);
    if (state === "recording" && active)
      recordingTimer = setInterval(updateRecordingClock, 250);
    if (!recordingControls) return;
    // Heartbeats update the clock without replacing the focused Pause/Stop button.
    if (!changed) {
      updateRecordingClock();
      syncRecordingAnnotationControls();
      return;
    }
    const focusedAction =
      root.activeElement?.dataset.recordingAction || recordingFocusAction;
    recordingFocusAction = null;
    recordingControls.replaceChildren();
    recordingClock = null;
    recordingError = null;
    reviewDock.dataset.recording = compact ? state : "";
    reviewDock.setAttribute("role", "group");
    reviewDock.setAttribute(
      "aria-label",
      compact
        ? `Feedbacks ${recordingMode} recording · ${project.name}`
        : "Feedbacks review controls",
    );
    drawerHandle.setAttribute(
      "aria-label",
      compact
        ? `Move ${recordingMode} recording controls`
        : "Feedbacks review controls — drag to move",
    );
    if (compact) {
      reviewDock.append(recordingControls);
      reviewDock.hidden = false;
      revealDrawer(false);
      const status = document.createElement("span");
      status.className = "recording-status";
      const label = document.createElement("span");
      label.setAttribute("role", "status");
      label.textContent = {
        starting: `Starting ${recordingMode}`,
        recording: "Recording",
        paused: "Paused",
        stopping: `Saving ${recordingMode}`,
        ready: recordingMode === "session" ? "Session ready" : "Video ready",
        idle: "Recorder",
      }[state];
      recordingClock = document.createElement("span");
      recordingClock.className = "recording-clock";
      recordingClock.setAttribute("aria-label", "Recording duration");
      status.append(label, recordingClock);
      if (["recording", "paused"].includes(state)) {
        const hint = document.createElement("span");
        hint.className = "recording-hint";
        status.append(hint);
      }
      recordingControls.append(status);
      if (["recording", "paused"].includes(state)) {
        if (recordingMode === "video") {
          const pause = button(
            state === "paused" ? "Resume" : "Pause",
            () =>
              send({
                type: "recordingControl",
                action: state === "paused" ? "resume" : "pause",
              }),
            recordingControls,
          );
          pause.dataset.recordingAction = "pause";
          pause.setAttribute(
            "aria-label",
            state === "paused" ? "Resume video" : "Pause video",
          );
        }
        const stop = button(
          "Stop",
          () => send({ type: "recordingControl", action: "stop" }),
          recordingControls,
        );
        stop.setAttribute("aria-label", `Stop ${recordingMode}`);
        stop.className = "recording-stop";
        stop.dataset.recordingAction = "stop";
      }
      if (state === "ready")
        button(
          `Review ${recordingMode}`,
          () =>
            send({
              type: recordingMode === "session" ? "openSessionReview" : "openRecorder",
            }),
          recordingControls,
        );
      recordingError = document.createElement("span");
      recordingError.className = "recording-error";
      recordingError.setAttribute("role", "alert");
      recordingControls.append(recordingError);
    } else {
      if (navigationButton?.parentElement?.parentElement === bar)
        bar.insertBefore(recordingControls, navigationButton.parentElement);
      if (state === "ready") {
        button(
          `Review ${recordingMode}`,
          () =>
            send({
              type: recordingMode === "session" ? "openSessionReview" : "openRecorder",
            }),
          recordingControls,
        );
      } else {
        let selectedMode = recordingOptions.mode === "session" ? "session" : "video";
        const start = button(
          selectedMode === "session" ? "Record session" : "Record video + session",
          async () => {
            renderRecording("starting", 0, selectedMode);
            try {
              await send({ type: "startRecording", mode: selectedMode });
            } catch (error) {
              renderRecording("idle", 0, selectedMode);
              throw error;
            }
          },
          recordingControls,
        );
        start.className = "recording-primary";
        start.title =
          selectedMode === "session"
            ? "Record page activity, replay, console and network without video"
            : "Record tab video with synced activity, replay, console and network";
        const settings = document.createElement("details");
        settings.className = "recording-options";
        const summary = document.createElement("summary");
        summary.textContent = "Options";
        summary.setAttribute("aria-label", "Recording options");
        settings.append(summary);
        const panel = document.createElement("div");
        panel.className = "recording-options-panel";
        const modeLabel = document.createElement("label");
        modeLabel.textContent = "Capture";
        const mode = document.createElement("select");
        mode.setAttribute("aria-label", "Recording mode");
        for (const [value, label] of [
          ["video", "Video + session"],
          ["session", "Session only"],
        ])
          mode.add(new Option(label, value));
        mode.value = selectedMode;
        mode.onchange = async () => {
          try {
            recordingOptions = await send({
              type: "recordingOptions",
              options: { mode: mode.value },
            });
            selectedMode = mode.value;
            start.textContent =
              mode.value === "session" ? "Record session" : "Record video + session";
            audio.hidden = mode.value === "session";
          } catch (error) {
            mode.value = selectedMode;
            notice.textContent = error.message;
          }
        };
        modeLabel.append(mode);
        panel.append(modeLabel);
        const audio = document.createElement("div");
        audio.className = "recording-option-group";
        audio.hidden = selectedMode === "session";
        panel.append(audio);
        const addOption = (parent, key, label) => {
          const row = document.createElement("label");
          const input = document.createElement("input");
          input.type = "checkbox";
          input.checked = recordingOptions[key] === true;
          input.onchange = async () => {
            try {
              recordingOptions = await send({
                type: "recordingOptions",
                options: { [key]: input.checked },
              });
            } catch (error) {
              input.checked = !input.checked;
              notice.textContent = error.message;
            }
          };
          row.append(input, document.createTextNode(label));
          parent.append(row);
        };
        addOption(audio, "tabAudio", "Tab audio");
        addOption(audio, "microphone", "Microphone");
        addOption(panel, "maskInputs", "Mask input values");
        addOption(panel, "maskText", "Mask page text");
        addOption(panel, "networkBodies", "Include bounded network bodies");
        const redirects = document.createElement("label");
        redirects.textContent = "Redirect sites (exact origins)";
        const origins = document.createElement("input");
        origins.type = "text";
        origins.placeholder = "https://dashboard.example.com";
        origins.value = recordingRedirectOrigins.join(", ");
        origins.setAttribute("aria-label", "Redirect site origins");
        redirects.append(origins);
        panel.append(redirects);
        button(
          "Allow sites",
          async () => {
            const result = await send({
              type: "recordingRedirects",
              origins: origins.value,
            });
            recordingRedirectOrigins = result.origins.slice(1);
            origins.value = recordingRedirectOrigins.join(", ");
            notice.textContent = recordingRedirectOrigins.length
              ? "Redirect sites allowed for this recording."
              : "Recording limited to this site.";
          },
          panel,
        );
        settings.append(panel);
        recordingControls.append(settings);
      }
    }
    updateRecordingClock();
    syncRecordingAnnotationControls();
    positionControls();
    if (focusedAction)
      recordingControls
        .querySelector(`[data-recording-action="${focusedAction}"]`)
        ?.focus({ preventScroll: true });
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
      let dragged = false;
      grip.setPointerCapture(event.pointerId);
      grip.onpointermove = (move) => {
        dragged ||=
          Math.abs(move.clientX - origin.x) + Math.abs(move.clientY - origin.y) > 4;
        dockPosition = {
          x: rect.left + move.clientX - origin.x,
          y: rect.top + move.clientY - origin.y,
        };
        positionControls();
      };
      grip.onpointerup = grip.onpointercancel = () => {
        grip.onpointermove = null;
        grip.dataset.dragged = String(dragged);
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
  const anchors = globalThis.FeedbacksReviewAnchors;
  const { selector, fingerprint, targetEvidence } = anchors;
  const identity = () => U.safeUrl(location.href);
  const context = () =>
    anchors.context({
      chosen,
      annotations,
      mode,
      requested,
      captureMarkerStyle,
      captureMarkerSize,
      draftLocation,
    });
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
      if (recordingError) recordingError.textContent = "";
      const restoreRecordingFocus =
        (recordingOnly || recordingBusy()) &&
        root.activeElement === b &&
        b.dataset.recordingAction;
      if (restoreRecordingFocus) recordingFocusAction = b.dataset.recordingAction;
      b.disabled = true;
      try {
        await action(b);
      } catch (e) {
        if ((recordingOnly || recordingBusy()) && recordingControls.contains(b))
          recordingError.textContent = e.message;
        else if (chosen?.recordingAnnotation && pointMenu.contains(b)) {
          pointMenu.classList.remove("hidden");
          pointMenu.querySelector(".point-tip").textContent = e.message;
        } else {
          notice.textContent = e.message;
          revealDrawer();
        }
      } finally {
        b.disabled = false;
        if (restoreRecordingFocus && b.isConnected && !root.activeElement)
          b.focus({ preventScroll: true });
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
    chosen?.releaseView?.();
    host.removeAttribute("data-editing-point");
    pointMenu.classList.add("hidden");
    freezeFrame.classList.add("hidden");
    freezeFrame.removeAttribute("src");
    if (restoreFocus && chosen?.element?.isConnected)
      chosen.element.focus({ preventScroll: true });
  }
  function clearChosenPoint(token) {
    if (token && chosen?.token !== token) return;
    chosen?.releaseView?.();
    clearTimeout(chosen?.captureRestoreTimer);
    host?.removeAttribute("data-editing-point");
    host?.style.removeProperty("opacity");
    chosen?.instantDispose?.();
    chosen = null;
    freezePending = false;
    freezeFrame?.classList.add("hidden");
    freezeFrame?.removeAttribute("src");
    targetBox?.classList.add("hidden");
    draftPin?.classList.add("hidden");
    syncRecordingAnnotationControls();
  }
  function choosePoint(el, x, y, deferOverlay = false) {
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
      scroll: { x: scrollX, y: scrollY },
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
    if (deferOverlay) return true;
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
      label.textContent = item.body;
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
          "Choose Review & send to check saved images and share with your team.";
        preview.append(state, note, hint);
        button(
          "Edit point",
          () => {
            hide();
            pin.click();
          },
          preview,
        );
        if (item.snapshot) {
          const thumb = document.createElement("img");
          thumb.className = "point-thumbnail";
          thumb.alt = `Original view for point ${index + 1}`;
          preview.append(thumb);
          send({ type: "pointImage", key: item.snapshot.key })
            .then(({ image }) => {
              if (thumb.isConnected) thumb.src = image;
            })
            .catch(() => thumb.remove());
          button("Original view", () => showPointImage(item, index), preview);
        }
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
    reviewButton.hidden = finalizeButton.hidden = annotations.length === 0;
    finalizeButton.querySelector(".unsent-count").textContent =
      `${annotations.length} unsent`;
    finalizeButton.setAttribute(
      "aria-label",
      `Review and send ${annotations.length} unsent ${annotations.length === 1 ? "point" : "points"}`,
    );
    const dockLabel = annotations.length
      ? `Feedbacks · ${annotations.length} not sent${outside ? ` · ${outside} outside this view` : ""}`
      : "Feedbacks";
    drawerHandle.dataset.count = annotations.length || "";
    drawerHandle.setAttribute("aria-label", dockLabel);
    drawerHandle.title = `${dockLabel}. Hover for controls; drag to move.`;
    positionControls();
    meta.textContent = annotations.length
      ? `${annotations.length} not sent${outside ? ` · ${outside} outside this view` : ""}`
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
    if (captureMarkerStyle !== "none") {
      const marker = document.createElement("span");
      marker.className = "image-point";
      marker.dataset.style = captureMarkerStyle;
      marker.dataset.size = captureMarkerSize;
      marker.textContent = captureMarkerStyle === "pin" ? String(index + 1) : "";
      marker.style.left = `${(item.anchor.screenshotPoint.x / item.snapshot.viewport.width) * 100}%`;
      marker.style.top = `${(item.anchor.screenshotPoint.y / item.snapshot.viewport.height) * 100}%`;
      stage.append(marker);
    }
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
  async function savePoint() {
    const selection = chosen;
    await selection?.snapshotTask;
    if (!selection || chosen !== selection) return;
    hoverTarget = null;
    hoverBox?.classList.add("hidden");
    if (!chosen) throw Error("Right-click an element first.");
    // The selected element may disappear when a hover menu loses focus. Its
    // geometry and selector were recorded at the right-click, before editing.
    if (pointSignature !== signature() && !selection.recordingAnnotation)
      throw Error("The page moved. Right-click the point again.");
    const body = pointText.value.trim();
    if (!body) {
      pointMenu.querySelector(".point-tip").textContent =
        "Write a comment for this point first.";
      pointText.focus();
      return;
    }
    const anchor = {
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
    };
    if (selection.recordingAnnotation) {
      if (!selection.snapshot) await captureRecordingPoint(selection);
      if (!selection.snapshot)
        throw Error(
          "The original view is required. Save point retries its capture; Cancel returns to the recording.",
        );
      if (selection.annotationAction) return;
      selection.annotationAction = "save";
      try {
        await send({
          type: "recordingAnnotationSave",
          annotationId: selection.recordingAnnotation.annotationId,
          key: selection.token,
          body,
          anchor,
        });
      } finally {
        selection.annotationAction = null;
      }
      closePointMenu();
      pointText.value = "";
      clearChosenPoint();
      return;
    }
    if (annotations.length >= 100)
      throw Error("Send this review before adding more points.");
    annotations.push({
      id: crypto.randomUUID(),
      body,
      element: chosen.element,
      snapshot: chosen.snapshot,
      anchor,
    });
    pointText.value = "";
    pointMenu.querySelector(".point-tip").textContent =
      "The outlined element and this comment stay together.";
    closePointMenu();
    clearChosenPoint();
    renderDraftPoints();
    notice.textContent = `Point ${annotations.length} saved here, not sent. Right-click another element or choose Review & send.`;
    revealDrawer(false);
  }
  async function capturePoint(scope = "visible") {
    if (pointRequest) return;
    if (draftEditing)
      throw Error("Save or cancel the point edit before reviewing screenshots.");
    if (chosen && pointText.value.trim()) await savePoint();
    else if (chosen) {
      pointText.value = "";
      clearChosenPoint();
    }
    pointRequest = true;
    closePointMenu();
    notice.textContent =
      scope === "points" ? "Opening saved points…" : "Capturing your review…";
    try {
      await send(
        pendingReview && scope === "points"
          ? { type: "openCapturedReview" }
          : { type: "capture", scope },
      );
      notice.textContent = "Review the screenshot and send your comments.";
    } catch (error) {
      notice.textContent = error.message;
      throw error;
    } finally {
      pointRequest = false;
    }
  }
  async function captureRecordingPoint(selection) {
    try {
      const { snapshot } = await send({
        type: "recordingFreezeView",
        key: selection.token,
      });
      if (chosen !== selection) return;
      if (!snapshot) throw Error("Screenshot capture did not return an original view.");
      selection.snapshot = snapshot;
      pointMenu.querySelector(".point-tip").textContent =
        "Original saved · Save point adds it to this recording.";
    } catch (error) {
      if (chosen === selection)
        pointMenu.querySelector(".point-tip").textContent =
          `Original view could not be saved: ${error.message} Save point retries the capture; Cancel returns to the recording.`;
    }
  }
  async function cancelPoint() {
    const selection = chosen;
    if (selection?.recordingAnnotation) {
      if (selection.annotationAction) return;
      selection.annotationAction = "cancel";
      await selection.snapshotTask;
      try {
        await send({
          type: "recordingAnnotationCancel",
          annotationId: selection.recordingAnnotation.annotationId,
        });
      } catch (error) {
        pointMenu.classList.remove("hidden");
        pointMenu.querySelector(".point-tip").textContent = error.message;
        throw error;
      } finally {
        selection.annotationAction = null;
      }
    }
    releasePointImage(selection);
    closePointMenu(true);
    pointText.value = "";
    clearChosenPoint();
    renderPins();
  }
  async function openPointMenu(el, x, y) {
    hoverTarget = null;
    hoverBox?.classList.add("hidden");
    if (pointRequest || captureActive || freezePending) return;
    const recordingPoint = recordingPointAllowed();
    if (pendingReview && !recordingPoint) {
      await send({ type: "openCapturedReview" });
      return;
    }
    if (chosen && (chosen.recordingAnnotation || pointText.value.trim())) {
      pointMenu.classList.remove("hidden");
      pointMenu.querySelector(".point-tip").textContent =
        "Save or cancel your current point before selecting another.";
      pointText.focus({ preventScroll: true });
      return;
    }
    if (!choosePoint(el, x, y, recordingPoint)) return;
    const selection = chosen;
    const token = selection.token;
    if (recordingPoint) {
      freezePending = true;
      selection.recordingAnnotationPending = true;
      syncRecordingAnnotationControls();
      try {
        selection.recordingAnnotation = await send({
          type: "recordingAnnotationBegin",
          key: token,
        });
        if (chosen !== selection) return;
      } catch (error) {
        if (recordingError) recordingError.textContent = error.message;
        clearChosenPoint(token);
        return;
      } finally {
        freezePending = false;
        selection.recordingAnnotationPending = false;
        syncRecordingAnnotationControls();
      }
    }
    selection.releaseView = F.holdPointView(el);
    host.setAttribute("data-editing-point", "");
    pointThumbnail.hidden = true;
    pointThumbnail.removeAttribute("src");
    pointMenu.classList.remove("hidden");
    pointMenu.querySelector(".point-tip").textContent = "Capturing… You can type now.";
    const r = pointMenu.getBoundingClientRect();
    pointMenu.style.left = `${Math.max(8, Math.min(x + 16, innerWidth - r.width - 8))}px`;
    pointMenu.style.top = `${Math.max(8, Math.min(y + 16, innerHeight - r.height - 8))}px`;
    pointText.focus({ preventScroll: true });
    selection.snapshotTask = (async () => {
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      if (recordingPoint) return captureRecordingPoint(selection);
      try {
        const { snapshot } = await send({ type: "freezeView", key: token });
        if (chosen?.token === token) {
          chosen.snapshot = snapshot;
          pointMenu.querySelector(".point-tip").textContent = "Original saved · Not sent";
        } else releasePointImage({ snapshot });
      } catch (error) {
        if (chosen?.token === token)
          pointMenu.querySelector(".point-tip").textContent =
            `Original view could not be saved: ${error.message} Your point text can still be saved.`;
      }
    })();
  }
  function renderChosenPoint() {
    draftPin.classList.add("hidden");
    if (!chosen || chosen.record !== identity()) return;
    if (chosen.recordingAnnotation || chosen.recordingAnnotationPending) {
      targetBox.classList.add("hidden");
      return;
    }
    const r =
      chosen.releaseView || chosen.snapshotOnly || !chosen.element.isConnected
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
    for (const name of [
      "click",
      "dblclick",
      "pointerdown",
      "pointerup",
      "mousedown",
      "mouseup",
      "contextmenu",
      "keydown",
      "keyup",
    ])
      host.addEventListener(name, (event) => event.stopPropagation());
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
    drawerHandle = document.createElement("button");
    drawerHandle.className = "drawer-handle review-drag";
    drawerHandle.setAttribute("aria-label", "Feedbacks review controls — drag to move");
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(icon.namespaceURI, "path");
    path.setAttribute("d", "M4 4h16v12H10l-6 4V4Zm4 4h8M8 12h5");
    icon.append(path);
    const grip = document.createElementNS(icon.namespaceURI, "svg");
    grip.setAttribute("viewBox", "0 0 8 20");
    grip.setAttribute("aria-hidden", "true");
    grip.classList.add("drag-grip");
    for (const x of [2, 6])
      for (const y of [5, 10, 15]) {
        const dot = document.createElementNS(icon.namespaceURI, "circle");
        dot.setAttribute("cx", String(x));
        dot.setAttribute("cy", String(y));
        dot.setAttribute("r", "1");
        grip.append(dot);
      }
    drawerHandle.append(grip, icon);
    movableControls(drawerHandle);
    drawerHandle.setAttribute("aria-expanded", "false");
    drawerHandle.setAttribute("aria-controls", "feedbacks-drawer");
    drawerHandle.onclick = () => {
      if (drawerHandle.dataset.dragged === "true") {
        drawerHandle.dataset.dragged = "false";
        return;
      }
      revealDrawer(bar.classList.contains("hidden"));
    };
    drawerHandle.hidden = false;
    reviewDock.append(drawerHandle);
    finalizeButton = button("", () => capturePoint("points"), reviewDock);
    finalizeButton.className = "finalize-review";
    finalizeButton.hidden = true;
    finalizeButton.title = "Review saved points, then send. No extra screenshot.";
    const finalizeIcon = icon.cloneNode(true);
    finalizeIcon
      .querySelector("path")
      .setAttribute("d", "M9 5h10v16H5V5h4Zm0-2h6v4H9V3Zm-1 11 3 3 5-6");
    const finalizeLabel = document.createElement("span");
    const finalizeTitle = document.createElement("strong");
    finalizeTitle.textContent = "Review & send";
    const unsentCount = document.createElement("span");
    unsentCount.className = "unsent-count";
    finalizeLabel.append(finalizeTitle, unsentCount);
    finalizeButton.append(finalizeIcon, finalizeLabel);
    bar.id = "feedbacks-drawer";
    drawerHandle.addEventListener("pointerenter", () => revealDrawer());
    reviewDock.addEventListener("pointerleave", collapseAfterLeave);
    bar.addEventListener("pointerenter", () => clearTimeout(drawerTimer));
    bar.addEventListener("pointerleave", collapseAfterLeave);
    bar.addEventListener("focusin", () => clearTimeout(drawerTimer));
    bar.addEventListener("focusout", collapseAfterLeave);

    const heading = document.createElement("strong");
    heading.textContent = `Feedbacks · ${project.name}`;
    const barHeading = document.createElement("div");
    barHeading.className = "review-bar-heading";
    barHeading.append(heading);
    button("Hide", hideControls, barHeading).title =
      "Keep reviewing without the icon. Reopen Feedbacks from Chrome to restore it.";
    button("Exit", exitReview, barHeading).title =
      "Stop review (Esc or R). Draft points stay on this page.";
    bar.append(barHeading);
    const dragHint = document.createElement("p");
    dragHint.className = "drag-hint";
    dragHint.textContent = "Drag the dotted handle to move · Arrow keys when focused";
    bar.append(dragHint);
    meta = document.createElement("p");
    meta.className = "meta";
    bar.append(meta);
    const row = document.createElement("div");
    row.className = "row";
    bar.append(row);
    button("Screenshot", () => capturePoint(), row).className = "primary";
    row.lastChild.title = "Capture the visible view and each point’s original (S)";
    button("Full page", () => capturePoint("fullPage"), row).title =
      "Optional: scroll and capture the whole page (P). More images can increase agent processing and token use.";
    recordingControls = document.createElement("div");
    recordingControls.className = "row recording-controls";
    recordingControls.title =
      "Long recordings can increase agent processing and token use.";
    bar.append(recordingControls);
    renderRecording();
    const navigationRow = document.createElement("div");
    navigationRow.className = "row navigation-controls";
    bar.append(navigationRow);
    navigationButton = button(
      "Navigation locked",
      () => setNavigationLock(!navigationLocked),
      navigationRow,
    );
    navigationButton.title =
      "Prevent page links and forms from leaving this review. Menu toggles still work.";
    setNavigationLock(navigationLocked);
    highlightButton = button(
      "Highlight on",
      () => setHighlight(!highlightEnabled),
      navigationRow,
    );
    highlightButton.title =
      "Outline the element under your pointer. Off by default while recording.";
    setHighlight(highlightEnabled);
    clicksButton = button(
      "Click indicators on",
      () => setClicks(!clickIndicators),
      navigationRow,
    );
    clicksButton.title =
      "Show clicks in recordings. Does not change website interaction.";
    setClicks(clickIndicators);
    const pinRow = document.createElement("div");
    pinRow.className = "row pin-controls";
    bar.append(pinRow);
    pinsButton = button(
      "Hide pins",
      (b) => {
        showPins = !showPins;
        b.textContent = showPins ? "Hide pins" : "Show pins";
        b.setAttribute("aria-pressed", String(!showPins));
        renderPins();
      },
      pinRow,
    );
    resolvedButton = button(
      "Show resolved",
      async (b) => {
        showResolved = !showResolved;
        b.textContent = showResolved ? "Hide resolved" : "Show resolved";
        b.setAttribute("aria-pressed", String(showResolved));
        await loadPins();
      },
      pinRow,
    );
    syncPinControls();
    const markerControls = document.createElement("div");
    markerControls.className = "capture-marker-controls";
    bar.append(markerControls);
    const markerStyleLabel = document.createElement("label");
    markerStyleLabel.textContent = "Screenshot marker";
    const markerStyleSelect = document.createElement("select");
    markerStyleSelect.setAttribute("aria-label", "Screenshot marker for this review");
    for (const [label, value] of [
      ["No marker", "none"],
      ["Outline circle", "ring"],
      ["Solid circle", "dot"],
      ["Arrow", "arrow"],
      ["Numbered pin", "pin"],
    ])
      markerStyleSelect.add(new Option(label, value));
    markerStyleSelect.value = captureMarkerStyle;
    markerStyleSelect.onchange = () => {
      captureMarkerStyle = markerStyleSelect.value;
      markerSizeSelect.disabled = captureMarkerStyle === "none";
    };
    markerStyleLabel.append(markerStyleSelect);
    const markerSizeLabel = document.createElement("label");
    markerSizeLabel.textContent = "Marker size";
    const markerSizeSelect = document.createElement("select");
    markerSizeSelect.setAttribute("aria-label", "Screenshot marker size for this review");
    for (const [label, value] of [
      ["Small", "small"],
      ["Medium", "medium"],
      ["Large", "large"],
    ])
      markerSizeSelect.add(new Option(label, value));
    markerSizeSelect.value = captureMarkerSize;
    markerSizeSelect.disabled = captureMarkerStyle === "none";
    markerSizeSelect.onchange = () => {
      captureMarkerSize = markerSizeSelect.value;
    };
    markerSizeLabel.append(markerSizeSelect);
    markerControls.append(markerStyleLabel, markerSizeLabel);
    const feedbackRow = document.createElement("div");
    feedbackRow.className = "row feedback-controls";
    bar.append(feedbackRow);
    button("Page comments", () => send({ type: "openPageThreads" }), feedbackRow).title =
      "Open your team’s threads for this page, across all screen sizes";
    diagnosticsButton = button(
      "Start diagnostics",
      () => updateDiagnostics(diagnosticsActive ? "stop" : "start"),
      feedbackRow,
    );
    diagnosticsButton.title =
      "Console and network diagnostics. Collected locally for up to 5 minutes; review before sharing. Stop discards the collection.";
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
    button("Narrow window", () => changeMode("mobile", true), sizes).title =
      "Move this page into a window that fits a phone preview";
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
    button("Cancel", cancelPoint, pointMenu);
    const tip = document.createElement("p");
    tip.className = "point-tip";
    tip.setAttribute("role", "status");
    tip.textContent = "Local draft · not sent";
    const evidenceRow = document.createElement("div");
    evidenceRow.className = "point-evidence";
    pointThumbnail = document.createElement("img");
    pointThumbnail.className = "point-thumbnail";
    pointThumbnail.alt = "Original view of selected element";
    pointThumbnail.hidden = true;
    evidenceRow.append(pointThumbnail, tip);
    pointMenu.append(evidenceRow);
    draftPoints = document.createElement("div");
    root.append(draftPoints);
    const draftSection = document.createElement("section");
    draftSection.className = "draft-section";
    draftList = document.createElement("ol");
    draftSection.append(draftList);
    reviewButton = button("Review & send", () => capturePoint("points"), draftSection);
    reviewButton.className = "primary";
    reviewButton.hidden = true;
    bar.append(draftSection);
    const shortcutTip = document.createElement("p");
    shortcutTip.className = "meta";
    shortcutTip.textContent = "Right-click to comment · S screenshot · R exit";
    shortcutTip.title =
      "Shortcuts pause while typing. M mobile · T tablet · D desktop · W reset. Drag the Feedbacks icon to move it.";
    bar.append(shortcutTip);
    document.documentElement.append(host);
  }
  async function loadPins() {
    if (!active || recordingOnly || document.visibilityState !== "visible") return;
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
    if (!active || recordingOnly) return;
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
  F.listen(
    "pointerdown",
    (event) => {
      if (
        !active ||
        !clickIndicators ||
        recordingState !== "recording" ||
        event.composedPath().includes(host)
      )
        return;
      const ring = document.createElement("span");
      ring.className = "recording-click";
      ring.style.left = `${event.clientX}px`;
      ring.style.top = `${event.clientY}px`;
      root.append(ring);
      setTimeout(() => ring.remove(), 650);
    },
    { capture: true, passive: true },
  );
  // Window capture runs before site handlers on document. Only explicit review
  // mode intercepts right-click; Shift+right-click bypasses the review menu.
  F.listen(
    "pointerdown",
    (event) => {
      if (
        !active ||
        ((recordingOnly || recordingBusy()) && !recordingPointAllowed()) ||
        event.composedPath().includes(host)
      )
        return;
      if (event.button === 2 && !event.shiftKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        openPointMenu(event.target, event.clientX, event.clientY);
      } else if (!chosen?.recordingAnnotation) closePointMenu();
    },
    true,
  );
  F.listen(
    "contextmenu",
    (event) => {
      if (
        !active ||
        ((recordingOnly || recordingBusy()) && !recordingPointAllowed()) ||
        event.shiftKey ||
        event.composedPath().includes(host)
      )
        return;
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
      if (
        !active ||
        recordingOnly ||
        recordingBusy() ||
        event.composedPath().includes(host)
      )
        return;
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
  // Leave menu toggles to the website. Suppress default document navigation,
  // with the Navigation API also covering cancellable scripted SPA changes.
  F.listen(
    "click",
    (event) => {
      if (
        !active ||
        recordingOnly ||
        !navigationLocked ||
        event.composedPath().includes(host)
      )
        return;
      const link = event.target.closest?.("a[href],area[href]");
      if (
        !link ||
        link.getAttribute("href")?.startsWith("#") ||
        link.matches('[aria-expanded],[aria-haspopup],[role="button"]')
      )
        return;
      blockNavigation(event);
    },
    true,
  );
  F.listen("submit", blockNavigation, true);
  globalThis.navigation?.addEventListener("navigate", (event) => {
    if (event.cancelable && event.navigationType !== "reload" && !event.hashChange)
      blockNavigation(event);
  });
  F.listen(
    "keydown",
    (event) => {
      if (!active) return;
      if (
        event.key === "Escape" &&
        chosen?.recordingAnnotation &&
        !event.isComposing &&
        !event.repeat
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        void cancelPoint().catch(() => {});
        return;
      }
      if (recordingOnly || recordingBusy()) return;
      if (event.key === "Escape") {
        if (event.isComposing || event.repeat) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const imageView = root.querySelector(".point-image-view");
        if (imageView) {
          imageView.remove();
          return;
        }
        if (pointMenu.classList.contains("hidden") && !choosing) {
          send({ type: "stopReview" }).catch((error) => {
            notice.textContent = error.message;
            revealDrawer();
          });
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
          !highlightEnabled ||
          recordingOnly ||
          recordingBusy() ||
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
      if (chosen?.scroll && !pointMenu.classList.contains("hidden")) {
        scrollTo({ left: chosen.scroll.x, top: chosen.scroll.y, behavior: "instant" });
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
    if (!chosen?.recordingAnnotation) closePointMenu();
    else {
      const rect = pointMenu.getBoundingClientRect();
      pointMenu.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - rect.width - 8))}px`;
      pointMenu.style.top = `${Math.max(8, Math.min(rect.top, innerHeight - rect.height - 8))}px`;
    }
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
        "preparePointImage",
        "pointImageCaptured",
        "recordingState",
        "prepareRecordingResume",
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
      if (
        recordingOnly &&
        ![
          "activate",
          "deactivate",
          "recordingState",
          "reviewPreferences",
          "popupControls",
          "metrics",
        ].includes(message.type) &&
        !(
          chosen?.recordingAnnotation &&
          [
            "captureContext",
            "captureCheck",
            "preparePointImage",
            "pointImageCaptured",
            "prepareRecordingResume",
          ].includes(message.type)
        )
      )
        throw Error("Only recording controls are available on this redirected page.");
      if (message.type === "prepareRecordingResume") {
        if (chosen?.recordingAnnotation?.annotationId !== message.annotationId)
          throw Error("The recording point changed before resuming.");
        closePointMenu();
        targetBox.classList.add("hidden");
        draftPin.classList.add("hidden");
        root.activeElement?.blur();
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
        return {};
      }
      if (message.type === "recordingState") {
        renderRecording(message.state, message.elapsedMs, message.mode || "video");
        if (message.error) {
          notice.textContent = message.error;
          revealDrawer(true);
        }
        return {};
      }
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
        if (recordingOnly && message.action && message.action !== "show-controls")
          throw Error("Only recording controls are available on this redirected page.");
        if (message.action === "show-controls") revealDrawer(true);
        if (message.action === "navigation") setNavigationLock(!navigationLocked);
        if (message.action === "highlight")
          setHighlight(recordingOnly || recordingBusy() ? false : !highlightEnabled);
        if (message.action === "clicks") setClicks(!clickIndicators);
        if (message.action === "pins") {
          showPins = !showPins;
          renderPins();
        }
        if (message.action === "resolved") {
          showResolved = !showResolved;
          await loadPins();
        }
        syncPinControls();
        return {
          showPins,
          showResolved,
          navigationLocked,
          highlightEnabled,
          clickIndicators,
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
        recordingOptions = message.recordingOptions || {};
        recordingRedirectOrigins = message.recordingRedirectOrigins || [];
        const wasActive = active && host?.isConnected;
        const modeChanged = recordingOnly !== (message.recordingOnly === true);
        recordingOnly = message.recordingOnly === true;
        if (!wasActive || modeChanged || project?.id !== message.project.id) {
          // A retiring recorder belongs to the previous review. Its later idle
          // notification must not restore that review's controls over these defaults.
          beforeRecording = null;
          recordingState = "idle";
          recordingMode = "video";
          defaults = message.reviewDefaults || {};
          setNavigationLock(defaults.navigationLocked !== false);
          setHighlight(defaults.highlightEnabled !== false);
          setClicks(defaults.clickIndicators !== false);
          showPins = defaults.showPins !== false;
          showResolved = defaults.showResolved === true;
          captureMarkerStyle = defaults.captureMarkerStyle || "ring";
          captureMarkerSize = defaults.captureMarkerSize || "small";
          syncPinControls();
        }
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
        if (modeChanged) {
          closePointMenu();
          host?.remove();
        }
        project = message.project;
        if (!host?.isConnected) setup(message.css);
        else if (!recordingBusy()) {
          recordingControls.replaceChildren();
          renderRecording();
        }
        const styleSelect = root?.querySelector(
          '[aria-label="Screenshot marker for this review"]',
        );
        const sizeSelect = root?.querySelector(
          '[aria-label="Screenshot marker size for this review"]',
        );
        if (styleSelect) styleSelect.value = captureMarkerStyle;
        if (sizeSelect) {
          sizeSelect.value = captureMarkerSize;
          sizeSelect.disabled = captureMarkerStyle === "none";
        }
        renderPins();
        if (!wasActive || modeChanged) revealDrawer(false);
        clearInterval(timer);
        if (recordingOnly) return {};
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
        clearInterval(recordingTimer);
        recordingClock = null;
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
      if (message.type === "preparePointImage") {
        assertPoint(message.pointToken);
        // Keep the textarea focused: display:none would interrupt typing.
        host.style.setProperty("opacity", "0", "important");
        clearTimeout(chosen.captureRestoreTimer);
        chosen.captureRestoreTimer = setTimeout(() => {
          if (chosen?.token === message.pointToken) host.style.removeProperty("opacity");
        }, 2000);
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
        assertPoint(message.pointToken);
        return { signature: signature() };
      }
      if (message.type === "pointImageCaptured") {
        if (chosen?.token !== message.pointToken) return {};
        host.style.removeProperty("opacity");
        clearTimeout(chosen.captureRestoreTimer);
        if (message.image && pointSignature === signature()) {
          freezeFrame.src = message.image;
          freezeFrame.classList.remove("hidden");
          chosen.releaseView?.();
          pointThumbnail.src = message.image;
          pointThumbnail.hidden = false;
        }
        return {};
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
