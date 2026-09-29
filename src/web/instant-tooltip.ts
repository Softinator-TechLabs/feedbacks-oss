// Native title tooltips wait before appearing. Show concise control help at once
// for pointer and keyboard users, including icon buttons with only an aria-label.
export function installInstantTooltips() {
  const tip = document.createElement("div");
  tip.className = "instant-tooltip";
  tip.setAttribute("role", "tooltip");
  tip.hidden = true;
  document.body.append(tip);
  let active: Element | null = null;
  let originalTitle: string | null = null;

  function owner(target: EventTarget | null): Element | null {
    const element = target instanceof Element ? target : null;
    const found = element?.closest("[title], [data-tooltip], [aria-label]");
    if (!found || found === tip || found.matches(":disabled")) return null;
    if (found.getAttribute("data-tooltip")?.trim() || found.getAttribute("title")?.trim())
      return found;
    if (found.matches("button, a, summary, [role='button']"))
      return found.getAttribute("aria-label")?.trim() ? found : null;
    return null;
  }

  function hide() {
    tip.hidden = true;
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
    tip.style.left = `${Math.max(8, Math.min(rect.left + rect.width / 2 - width / 2, innerWidth - width - 8))}px`;
    const below = rect.bottom + 6;
    tip.style.top = `${below + height <= innerHeight - 8 ? below : Math.max(8, rect.top - height - 6)}px`;
  }

  function show(target: EventTarget | null) {
    if (active?.contains(target as Node)) return;
    const next = owner(target);
    if (next === active) return;
    hide();
    if (!next) return;
    active = next;
    tip.textContent =
      next.getAttribute("data-tooltip") ||
      next.getAttribute("title") ||
      next.getAttribute("aria-label");
    originalTitle = next.getAttribute("title");
    if (originalTitle !== null) next.removeAttribute("title");
    next.classList.add("instant-tooltip-active");
    tip.hidden = false;
    place();
  }

  document.addEventListener(
    "pointerover",
    (event) => {
      if (event.pointerType === "mouse") show(event.target);
    },
    true,
  );
  document.addEventListener(
    "pointerout",
    (event) => {
      if (
        event.pointerType === "mouse" &&
        active &&
        !active.contains(event.relatedTarget as Node)
      )
        hide();
    },
    true,
  );
  document.addEventListener("focusin", (event) => show(event.target), true);
  document.addEventListener(
    "focusout",
    (event) => {
      if (active && !active.contains(event.relatedTarget as Node)) hide();
    },
    true,
  );
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape") hide();
    },
    true,
  );
  window.addEventListener("resize", place);
  window.addEventListener("scroll", place, true);
}
