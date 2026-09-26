(() => {
  if (globalThis.feedbacksInstantInstalled) return;
  globalThis.feedbacksInstantInstalled = true;
  const F = globalThis.FeedbacksFrames;
  let enabled = false,
    host,
    shadow,
    point,
    busy = false,
    enabledRevision = 0;
  const ownedRoots = (globalThis.feedbacksOwnedRoots ||= new WeakSet());
  const signature = () =>
    `${location.href}|${innerWidth}|${innerHeight}|${scrollX}|${scrollY}|${devicePixelRatio}`;
  const close = (keepGuard = false) => {
    if (keepGuard !== true) point?.dispose();
    host?.remove();
    host = null;
    point = null;
  };
  const send = async (message) => {
    const r = await chrome.runtime.sendMessage(message);
    if (!r.ok) throw Error(r.error);
    return r.data;
  };
  const initialRevision = enabledRevision;
  send({ type: "instantStatus" })
    .then((s) => {
      if (enabledRevision === initialRevision) enabled = s.enabled;
    })
    .catch(() => {});
  chrome.runtime.onMessage.addListener((m, sender, reply) => {
    if (sender.id === chrome.runtime.id && m.type === "instantEnabled") {
      enabledRevision++;
      enabled = m.enabled;
      if (!enabled) close();
      reply({ ok: true });
    }
  });
  function guardPoint(element) {
    const lineage = [];
    for (let node = element; node; node = node.parentNode) lineage.push(node);
    let changed = false,
      disposed = false;
    const owned = (node) => {
      for (; node; node = node.parentNode) if (ownedRoots.has(node)) return true;
      return false;
    };
    const inspect = (records) => {
      for (const record of records) {
        if (owned(record.target)) continue;
        const nodes = [...record.addedNodes, ...record.removedNodes];
        if (record.type === "childList" && nodes.length && nodes.every(owned)) continue;
        if (
          record.target === element ||
          element.contains(record.target) ||
          (lineage.includes(record.target) &&
            (record.type === "attributes" ||
              nodes.some((node) =>
                lineage.some((ancestor) => node === ancestor || node.contains(ancestor)),
              )))
        )
          changed = true;
      }
    };
    const observer = new MutationObserver(inspect);
    observer.observe(element, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    });
    for (const ancestor of lineage.slice(1))
      observer.observe(ancestor, { attributes: true, childList: true });
    return {
      valid() {
        inspect(observer.takeRecords());
        return (
          !disposed &&
          !changed &&
          element.isConnected &&
          lineage.every((node, index) => node.parentNode === (lineage[index + 1] || null))
        );
      },
      dispose() {
        disposed = true;
        observer.disconnect();
      },
    };
  }
  function open(event) {
    if (
      !enabled ||
      globalThis.feedbacksReviewActive ||
      busy ||
      event.shiftKey ||
      event.composedPath().includes(host)
    )
      return;
    const el = event.target;
    if (el?.nodeType !== 1) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (host) return;
    const r = F.rect(el);
    point = {
      element: el,
      x: event.clientX || r.x + r.width / 2,
      y: event.clientY || r.y + r.height / 2,
      signature: signature(),
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      ...guardPoint(el),
    };
    host = document.createElement("div");
    ownedRoots.add(host);
    host.style.cssText =
      "all:initial!important;position:fixed!important;z-index:2147483647!important;pointer-events:auto!important";
    shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `:host{color-scheme:light}*{box-sizing:border-box}.target{position:fixed;pointer-events:none;border:3px solid #347dbc;border-radius:6px;background:rgba(52,125,188,.13);box-shadow:0 5px 20px rgba(14,52,80,.22)}.menu{width:260px;padding:12px;background:#fff;color:#202c37;border:1px solid #bdc5cc;border-radius:10px;font:14px/1.5 system-ui}button{font:inherit;min-height:40px;border:1px solid #bdc5cc;border-radius:6px;padding:7px 12px;background:white;color:#17324d;cursor:pointer}button:first-of-type{background:#17324d;color:white}button:hover{filter:brightness(.92)}button:focus-visible{outline:2px solid #3875a9;outline-offset:2px}p{margin:8px 0 0;color:#596672}p:empty{display:none}@media(prefers-color-scheme:dark){:host{color-scheme:dark}.menu{background:#171e25;color:#e5ebf0;border-color:#40515e}button{background:#171e25;color:#e5ebf0;border-color:#52616d}button:first-of-type{background:#c3d8e8;color:#142b3f}p{color:#b0bec9}}`;
    const target = document.createElement("div");
    target.className = "target";
    Object.assign(target.style, {
      left: `${r.x}px`,
      top: `${r.y}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
    });
    const menu = document.createElement("div");
    menu.className = "menu";
    menu.setAttribute("role", "dialog");
    menu.setAttribute("aria-label", "Add website feedback");
    const add = document.createElement("button"),
      cancel = document.createElement("button"),
      message = document.createElement("p");
    add.textContent = "Add feedback here";
    cancel.textContent = "Cancel";
    cancel.style.marginLeft = "6px";
    message.setAttribute("role", "status");
    cancel.onclick = close;
    add.onclick = async () => {
      if (busy) return;
      if (!point || point.signature !== signature() || !point.valid()) {
        message.textContent = "The page changed. Right-click again.";
        return;
      }
      busy = true;
      add.disabled = true;
      add.textContent = "Opening…";
      globalThis.feedbacksInstantPoint = point;
      host.style.visibility = "hidden";
      try {
        const result = await send({ type: "instantStart" });
        // A saved context-only draft can retry; the chosen point owns its guard.
        close(
          result?.inline === true ||
            (result?.captured === false && result.contextSaved === true),
        );
      } catch (e) {
        if (host) host.style.visibility = "visible";
        message.textContent = e.message;
        add.textContent = "Try again";
      } finally {
        busy = false;
        add.disabled = false;
        delete globalThis.feedbacksInstantPoint;
      }
    };
    menu.append(add, cancel, message);
    shadow.append(style, target, menu);
    document.documentElement.append(host);
    host.style.left = `${Math.max(8, Math.min(point.x + 12, innerWidth - 268))}px`;
    host.style.top = `${Math.max(8, Math.min(point.y + 12, innerHeight - 110))}px`;
    add.focus({ preventScroll: true });
  }
  F.listen(
    "pointerdown",
    (e) => {
      if (e.button === 2) open(e);
      else if (!e.composedPath().includes(host) && !busy) close();
    },
    true,
  );
  F.listen("contextmenu", open, true);
  F.listen(
    "click",
    (e) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey) open(e);
    },
    true,
  );
  F.listen(
    "keydown",
    (e) => {
      if (e.key === "Escape" && host && !busy) {
        close();
        e.stopImmediatePropagation();
      }
    },
    true,
  );
  F.listen(
    "scroll",
    () => {
      if (!busy) close();
    },
    { passive: true, capture: true },
  );
})();
