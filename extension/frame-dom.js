// Same-origin embedded previews share the top-level review UI and capture URL.
// No page-world bridge, extra permissions, or duplicated review toolbars.
(() => {
  if (globalThis.FeedbacksFrames) return;
  const listeners = [],
    documents = new WeakSet();
  const frameUrl = (url) =>
    /^about:(blank|srcdoc)$/.test(url) ? url : globalThis.FeedbacksUtil.safeUrl(url);
  function mapPoint(win, point) {
    let x = point.x,
      y = point.y;
    while (win !== window) {
      const frame = win.frameElement;
      if (!frame?.isConnected)
        throw Error("The embedded page changed. Right-click again.");
      const r = frame.getBoundingClientRect();
      if (!frame.offsetWidth || !frame.offsetHeight)
        throw Error("The embedded page is hidden. Right-click again.");
      const sx = r.width / frame.offsetWidth,
        sy = r.height / frame.offsetHeight;
      x = r.x + (frame.clientLeft + x) * sx;
      y = r.y + (frame.clientTop + y) * sy;
      win = frame.ownerDocument.defaultView;
    }
    return { x, y };
  }
  function rect(el) {
    const r = el.getBoundingClientRect(),
      win = el.ownerDocument.defaultView;
    const a = mapPoint(win, r),
      b = mapPoint(win, { x: r.right, y: r.bottom });
    return {
      x: a.x,
      y: a.y,
      width: b.x - a.x,
      height: b.y - a.y,
      left: a.x,
      top: a.y,
      right: b.x,
      bottom: b.y,
    };
  }
  function path(el, localSelector) {
    const parts = [localSelector(el)];
    for (let win = el.ownerDocument.defaultView; win !== window; ) {
      const frame = win.frameElement;
      if (!frame) throw Error("Embedded page is no longer available.");
      parts.unshift({ selector: localSelector(frame), url: frameUrl(win.location.href) });
      win = frame.ownerDocument.defaultView;
    }
    return parts.length === 1 ? parts[0] : "frame-v1:" + JSON.stringify(parts);
  }
  function find(value) {
    if (!value.startsWith("frame-v1:")) return document.querySelectorAll(value);
    const parts = JSON.parse(value.slice(9));
    if (!Array.isArray(parts) || parts.length > 16) return [];
    let doc = document;
    for (const part of parts.slice(0, -1)) {
      const frames = doc.querySelectorAll(part.selector);
      if (frames.length !== 1 || frames[0].tagName !== "IFRAME") return [];
      doc = frames[0].contentDocument;
      if (!doc || frameUrl(doc.location.href) !== part.url) return [];
    }
    return doc.querySelectorAll(parts.at(-1));
  }
  function attach(doc, spec) {
    doc.defaultView.addEventListener(
      spec.type,
      (event) => {
        if (doc.defaultView === window) return spec.handler(event);
        let point;
        try {
          point = mapPoint(doc.defaultView, {
            x: event.clientX || 0,
            y: event.clientY || 0,
          });
        } catch {
          return;
        }
        spec.handler(
          new Proxy(event, {
            get(target, key) {
              if (key === "clientX") return point.x;
              if (key === "clientY") return point.y;
              const value = Reflect.get(target, key, target);
              return typeof value === "function" ? value.bind(target) : value;
            },
          }),
        );
      },
      spec.options,
    );
  }
  function scan(node) {
    for (const frame of node.querySelectorAll?.("iframe") || []) {
      try {
        if (frame.contentDocument) watch(frame.contentDocument);
      } catch {}
    }
    if (node.tagName === "IFRAME") {
      try {
        if (node.contentDocument) watch(node.contentDocument);
      } catch {}
    }
  }
  const liveDocs = new Set();
  function watch(doc) {
    if (documents.has(doc)) return;
    documents.add(doc);
    liveDocs.add(doc);
    for (const spec of listeners) attach(doc, spec);
    const observer = new MutationObserver((records) => {
      for (const r of records) for (const node of r.addedNodes) scan(node);
    });
    observer.observe(doc, { childList: true, subtree: true });
    doc.addEventListener("load", (event) => scan(event.target), true);
    doc.defaultView.addEventListener(
      "pagehide",
      () => {
        observer.disconnect();
        liveDocs.delete(doc);
      },
      { once: true },
    );
    scan(doc);
  }
  globalThis.FeedbacksFrames = {
    rect,
    path,
    find,
    listen(type, handler, options) {
      const spec = { type, handler, options };
      listeners.push(spec);
      for (const doc of liveDocs) attach(doc, spec);
    },
  };
  watch(document);
})();
