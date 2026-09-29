// A single, immediate tooltip for extension pages and the injected review dock.
// Keep this browser-only helper free of extension permissions and page content.
(() => {
  const installed = new WeakSet();

  function install(root) {
    if (installed.has(root)) return;
    installed.add(root);
    const doc = root.ownerDocument || root;
    const tip = doc.createElement("div");
    tip.setAttribute("role", "tooltip");
    tip.hidden = true;
    Object.assign(tip.style, {
      all: "initial",
      position: "fixed",
      zIndex: "2147483647",
      pointerEvents: "none",
      boxSizing: "border-box",
      maxWidth: "min(280px, calc(100vw - 16px))",
      padding: "6px 9px",
      borderRadius: "6px",
      background: "#17324d",
      color: "#fff",
      boxShadow: "0 3px 12px #0003",
      font: "500 12px/1.35 system-ui, sans-serif",
      whiteSpace: "normal",
      overflowWrap: "anywhere",
    });
    tip.style.display = "none";
    (root.body || root).append(tip);
    let active = null;
    let originalTitle = null;

    function owner(target) {
      const element = target instanceof Element ? target : target?.parentElement;
      if (element?.closest("[data-no-tooltip]")) return null;
      const found = element?.closest("[title], [data-tooltip], [aria-label]");
      if (!found || found === tip || found.disabled || !root.contains(found)) return null;
      const label = found.getAttribute("data-tooltip") || found.getAttribute("title");
      if (label?.trim()) return found;
      // An accessible control name also covers icons with visually hidden text.
      if (found.matches("button, a, summary, [role='button']"))
        return found.getAttribute("aria-label")?.trim() ? found : null;
      return null;
    }

    function hide() {
      tip.hidden = true;
      tip.style.display = "none";
      if (active) {
        if (originalTitle !== null && !active.hasAttribute("title"))
          active.setAttribute("title", originalTitle);
        active.classList.remove("instant-tooltip-active");
      }
      active = null;
      originalTitle = null;
    }

    function place() {
      if (!active || !active.isConnected) return hide();
      const rect = active.getBoundingClientRect();
      const width = tip.offsetWidth;
      const height = tip.offsetHeight;
      const view = doc.defaultView;
      const left = Math.max(
        8,
        Math.min(rect.left + rect.width / 2 - width / 2, view.innerWidth - width - 8),
      );
      const below = rect.bottom + 6;
      const top =
        below + height <= view.innerHeight - 8
          ? below
          : Math.max(8, rect.top - height - 6);
      tip.style.left = `${left}px`;
      tip.style.top = `${top}px`;
    }

    function show(target) {
      if (active?.contains(target)) return;
      const next = owner(target);
      if (next === active) return;
      hide();
      if (!next) return;
      active = next;
      const label =
        next.getAttribute("data-tooltip") ||
        next.getAttribute("title") ||
        next.getAttribute("aria-label");
      originalTitle = next.getAttribute("title");
      if (originalTitle !== null) next.removeAttribute("title");
      next.classList.add("instant-tooltip-active");
      tip.textContent = label;
      tip.hidden = false;
      tip.style.display = "block";
      place();
    }

    root.addEventListener(
      "pointerover",
      (event) => {
        if (event.pointerType === "mouse") show(event.target);
      },
      true,
    );
    root.addEventListener(
      "pointerout",
      (event) => {
        if (
          event.pointerType === "mouse" &&
          active &&
          !active.contains(event.relatedTarget)
        )
          hide();
      },
      true,
    );
    root.addEventListener("focusin", (event) => show(event.target), true);
    root.addEventListener(
      "focusout",
      (event) => {
        if (active && !active.contains(event.relatedTarget)) hide();
      },
      true,
    );
    root.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Escape") hide();
      },
      true,
    );
    doc.defaultView.addEventListener("resize", place);
    doc.defaultView.addEventListener("scroll", place, true);
  }

  globalThis.FeedbacksTooltips = { install };
  if (location.protocol === "chrome-extension:") {
    if (document.readyState === "loading")
      document.addEventListener("DOMContentLoaded", () => install(document), {
        once: true,
      });
    else install(document);
  }
})();
