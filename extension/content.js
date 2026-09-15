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
    pointMenu,
    draftPin,
    pointRequest = false,
    pointSignature,
    active = false,
    choosing = false,
    chosen = null,
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
    drawerTimer,
    loadingPins,
    activationGeneration = 0,
    reviewId;
  function revealDrawer(open = true) {
    if (!bar) return;
    bar.classList.add("hidden");
    drawerHandle.setAttribute("aria-expanded", String(open));
    clearTimeout(drawerTimer);
    if (open) foldLater();
  }
  function foldLater() {
    clearTimeout(drawerTimer);
    drawerTimer = setTimeout(() => {
      if (
        !active ||
        choosing ||
        pointRequest ||
        captureActive ||
        bar.matches(":hover") ||
        bar.matches(":focus-within")
      )
        return;
      revealDrawer(false);
    }, 1000);
  }
  const invalidateCapture = () => {
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
    return {
      url: U.safeUrl(location.href),
      viewport: { width: innerWidth, height: innerHeight },
      devicePixelRatio,
      scroll: { x: scrollX, y: scrollY },
      preset: mode,
      ...(requested ? { requestedSize: { width: requested, height: innerHeight } } : {}),
      capturedAt: new Date().toISOString(),
      anchor,
    };
  }
  function targetEvidence(el, point, evidenceFingerprint) {
    const r = F.rect(el),
      style = el.ownerDocument.defaultView.getComputedStyle(el),
      record = recordKey(el);
    return {
      selector: selector(el),
      fingerprint: evidenceFingerprint,
      ...(record ? { recordIdentity: record } : {}),
      point,
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      screenshotPoint: {
        x: r.x + point.x * r.width,
        y: r.y + point.y * r.height,
      },
      styles: {
        fontFamily: style.fontFamily.slice(0, 200),
        fontSize: style.fontSize.slice(0, 50),
        color: style.color.slice(0, 100),
        backgroundColor: style.backgroundColor.slice(0, 100),
      },
    };
  }
  const signature = () =>
    `${location.href}|${innerWidth}|${innerHeight}|${scrollX}|${scrollY}|${devicePixelRatio}`;
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
    if (restoreFocus && chosen?.element?.isConnected)
      chosen.element.focus({ preventScroll: true });
  }
  function clearChosenPoint(token) {
    if (token && chosen?.token !== token) return;
    chosen?.instantDispose?.();
    chosen = null;
  }
  function choosePoint(el, x, y) {
    if (el?.nodeType !== 1 || !el.isConnected) return false;
    const r = F.rect(el);
    if (!r.width || !r.height) return false;
    choosing = false;
    clearChosenPoint();
    chosen = {
      token: crypto.randomUUID(),
      element: el,
      record: identity(),
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
    targetBox.classList.add("hidden");
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
  async function capturePoint() {
    if (pointRequest || !chosen) return;
    const token = chosen.token;
    assertPoint(token);
    pointRequest = true;
    closePointMenu();
    notice.textContent = "Capturing this point…";
    try {
      await send({ type: "capture", pointToken: token });
      notice.textContent = "Add your comment in the capture window, then Send.";
    } catch (error) {
      pointMenu.classList.remove("hidden");
      pointMenu.querySelector(".point-tip").textContent = error.message;
      throw error;
    } finally {
      pointRequest = false;
    }
  }
  function openPointMenu(el, x, y) {
    if (pointRequest || captureActive || !choosePoint(el, x, y)) return;
    pointMenu.classList.remove("hidden");
    const r = pointMenu.getBoundingClientRect();
    pointMenu.style.left = `${Math.max(8, Math.min(x + 16, innerWidth - r.width - 8))}px`;
    pointMenu.style.top = `${Math.max(8, Math.min(y + 16, innerHeight - r.height - 8))}px`;
    pointMenu.querySelector("button").focus({ preventScroll: true });
  }
  function renderChosenPoint() {
    draftPin.classList.add("hidden");
    if (!chosen || chosen.record !== identity() || !chosen.element.isConnected) return;
    const r = F.rect(chosen.element);
    const x = r.x + r.width * chosen.point.x,
      y = r.y + r.height * chosen.point.y;
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return;
    draftPin.style.left = `${x}px`;
    draftPin.style.top = `${y}px`;
    draftPin.classList.remove("hidden");
  }
  function setup(css) {
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
    drawerHandle = document.createElement("button");
    drawerHandle.className = "drawer-handle";
    drawerHandle.textContent = "Feedbacks";
    drawerHandle.setAttribute("aria-expanded", "true");
    drawerHandle.setAttribute("aria-controls", "feedbacks-drawer");
    drawerHandle.onclick = () => revealDrawer(bar.classList.contains("hidden"));
    drawerHandle.hidden = true;
    bar.id = "feedbacks-drawer";
    bar.addEventListener("pointerenter", () => clearTimeout(drawerTimer));
    bar.addEventListener("pointerleave", foldLater);
    bar.addEventListener("focusin", () => clearTimeout(drawerTimer));
    bar.addEventListener("focusout", foldLater);
    const heading = document.createElement("strong");
    heading.textContent = `Feedbacks · ${project.name}`;
    bar.append(heading);
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
        await send({ type: "capture" });
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
    button(
      "Exit review",
      async () => {
        active = false;
        activationGeneration++;
        globalThis.feedbacksReviewActive = false;
        clearInterval(timer);
        clearTimeout(drawerTimer);
        host.remove();
        clearChosenPoint();
        choosing = false;
        await send({ type: "stopReview" });
      },
      sizes,
    );
    notice = document.createElement("p");
    notice.className = "notice";
    notice.setAttribute("role", "status");
    bar.append(notice);
    categoryLists = document.createElement("div");
    categoryLists.className = "category-lists";
    bar.append(categoryLists);
    pinLayer = document.createElement("div");
    root.append(pinLayer);
    targetBox = document.createElement("div");
    targetBox.className = "target hidden";
    root.append(targetBox);
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
    button("Add feedback here", capturePoint, pointMenu).className = "primary";
    button(
      "Cancel",
      () => {
        closePointMenu(true);
        clearChosenPoint();
        renderPins();
      },
      pointMenu,
    );
    const tip = document.createElement("p");
    tip.className = "point-tip";
    tip.textContent = "Screenshot included. Review before sending.";
    pointMenu.append(tip);
    const shortcutTip = document.createElement("p");
    shortcutTip.className = "meta";
    shortcutTip.textContent = "Right-click a point to comment · Alt+click also works";
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
    pinLayer.replaceChildren();
    targetBox.classList.add("hidden");
    const current = context();
    renderChosenPoint();
    const unmatched = [],
      other = [];
    let matched = 0;
    for (const thread of threads) {
      if (!U.pinVisible(thread, showResolved)) continue;
      if (U.device(thread.context.viewport.width) !== U.device(innerWidth)) {
        other.push(thread);
        continue;
      }
      const a = thread.context.anchor;
      let element;
      if (
        U.sameContext(thread.context, current) &&
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
      if (!element) {
        unmatched.push(thread);
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
      pin.className = "pin";
      pin.style.pointerEvents = "auto";
      pin.style.left = `${x}px`;
      pin.style.top = `${y}px`;
      pin.setAttribute(
        "aria-label",
        `${thread.author.name}: ${thread.body.slice(0, 160)}`,
      );
      let preview;
      const hide = () => {
        preview?.remove();
        preview = null;
      };
      const show = () => {
        hide();
        preview = document.createElement("div");
        preview.className = "preview";
        preview.textContent = `${thread.author.name}\n${thread.body.slice(0, 300)}`;
        preview.style.left = `${Math.max(8, Math.min(x + 18, innerWidth - 290))}px`;
        preview.style.top = `${Math.max(8, Math.min(y + 18, innerHeight - 150))}px`;
        pinLayer.append(preview);
      };
      pin.onmouseenter = show;
      pin.onfocus = show;
      pin.onmouseleave = hide;
      pin.onblur = hide;
    }
    renderCategories(unmatched, other);
    meta.textContent = `${matched + unmatched.length} comments on this view · ${innerWidth} × ${innerHeight}`;
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
      if (pointMenu.classList.contains("hidden")) {
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
      notice.textContent = "Point selected. Add your comment in the capture window.";
      const r = F.rect(chosen.element);
      Object.assign(targetBox.style, {
        left: `${r.x}px`,
        top: `${r.y}px`,
        width: `${r.width}px`,
        height: `${r.height}px`,
      });
      targetBox.classList.remove("hidden");
      capturePoint().catch((e) => {
        notice.textContent = e.message;
        revealDrawer();
      });
    },
    true,
  );
  F.listen(
    "keydown",
    (event) => {
      if (!active) return;
      if (event.key === "Escape") {
        closePointMenu(true);
        choosing = false;
        clearChosenPoint();
        renderPins();
        notice.textContent = "";
        revealDrawer(false);
        return;
      }
      if (event.composedPath().includes(host)) return;
      const value = U.shortcut(event);
      if (value) {
        event.preventDefault();
        changeMode(value).catch((e) => (notice.textContent = e.message));
      }
    },
    true,
  );
  let scheduled = false;
  let hoverTarget, hoverFrame;
  F.listen(
    "pointermove",
    (event) => {
      if (!active || !choosing || event.composedPath().includes(host)) return;
      hoverTarget = event.target;
      if (hoverFrame) return;
      hoverFrame = requestAnimationFrame(() => {
        hoverFrame = null;
        if (!choosing || hoverTarget?.nodeType !== 1) return;
        const r = F.rect(hoverTarget);
        Object.assign(targetBox.style, {
          left: `${r.x}px`,
          top: `${r.y}px`,
          width: `${r.width}px`,
          height: `${r.height}px`,
        });
        targetBox.classList.remove("hidden");
      });
    },
    { passive: true, capture: true },
  );
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
    () => {
      closePointMenu();
      repaint();
    },
    { passive: true, capture: true },
  );
  F.listen("resize", () => {
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
        "instantCapturePoint",
        "choosePoint",
        "deactivate",
        "metrics",
        "feedbackSaved",
        "captureContext",
        "prepareCapture",
        "captureCheck",
        "restore",
        "discardPoint",
        "popupControls",
      ].includes(message.type)
    )
      return;
    (async () => {
      if (message.type === "popupControls") {
        if (!active) throw Error("Open Feedbacks to connect this page.");
        if (message.action === "pins") {
          showPins = !showPins;
          renderPins();
        }
        if (message.action === "resolved") {
          showResolved = !showResolved;
          await loadPins();
        }
        return { showPins, showResolved, comments: threads.length };
      }
      if (message.type === "activate") {
        const wasActive = active && host?.isConnected;
        activationGeneration++;
        reviewId = message.reviewId;
        threads = [];
        active = true;
        globalThis.feedbacksReviewActive = true;
        if (project?.id !== message.project.id) {
          threads = [];
          clearChosenPoint();
          host?.remove();
        }
        project = message.project;
        if (!host?.isConnected) setup(message.css);
        renderPins();
        if (!wasActive) revealDrawer();
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
        if (!active || !p || p.signature !== signature() || !p.valid?.())
          throw Error("The page moved. Right-click again.");
        const r = F.rect(p.element);
        if (
          ["x", "y", "width", "height"].some((k) => Math.abs(r[k] - p.rect[k]) > 1) ||
          !choosePoint(p.element, p.x, p.y)
        )
          throw Error("The element moved. Right-click again.");
        chosen.instantValid = p.valid;
        chosen.instantDispose = p.dispose;
        return { pointToken: chosen.token };
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
        if (chosen?.evidence.fingerprint === message.fingerprint) clearChosenPoint();
        if (active) {
          renderPins();
          loadPins().catch((e) => {
            if (active) notice.textContent = e.message;
          });
        }
        return {};
      }
      if (message.type === "captureContext") {
        if (!active) throw Error("Review is not active.");
        assertPoint(message.pointToken);
        return context();
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
      if (message.type === "restore") {
        captureActive = false;
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
