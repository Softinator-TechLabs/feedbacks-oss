(() => {
  const indicator = document.getElementById("site-thinking");
  if (!indicator || window.__feedbacksPageReadiness) return;
  window.__feedbacksPageReadiness = true;
  let active;
  const visible = (node) => {
    const box = node.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && box.top < innerHeight && box.bottom > 0;
  };
  const paint = () =>
    document.hidden
      ? Promise.resolve()
      : new Promise((resolve) => requestAnimationFrame(resolve));
  function finish(cycle, outcome = "ready") {
    if (cycle !== active) return;
    clearTimeout(cycle.deadline);
    cycle.abort.abort();
    active = undefined;
    indicator.hidden = true;
    indicator.dataset.state = outcome;
  }
  function begin() {
    if (active) finish(active, "cancelled");
    const cycle = { abort: new AbortController(), deadline: 0 };
    active = cycle;
    indicator.dataset.state = "preparing";
    indicator.hidden = false;
    cycle.deadline = setTimeout(() => finish(cycle, "degraded"), 20_000);
    return cycle;
  }
  function imageReady(image, cycle) {
    if (image.complete) return image.decode?.().catch(() => {}) ?? Promise.resolve();
    return new Promise((resolve) => {
      const settle = () => resolve();
      const options = { once: true, signal: cycle.abort.signal };
      image.addEventListener("load", settle, options);
      image.addEventListener("error", settle, options);
      cycle.abort.signal.addEventListener("abort", settle, { once: true });
    }).then(() => image.decode?.().catch(() => {}));
  }
  function demoReady(demo, cycle) {
    const box = demo.getBoundingClientRect();
    const overlap = Math.min(box.bottom, innerHeight) - Math.max(box.top, 0);
    if (overlap / box.height < 0.25 || typeof customElements === "undefined")
      return Promise.resolve();
    return new Promise((resolve) => {
      let observer;
      const settle = () => {
        observer?.disconnect();
        resolve();
      };
      let waitingForFrame = false;
      const check = () => {
        if (demo.hasAttribute("data-load-failed")) return settle();
        const stage = demo.shadowRoot?.querySelector(".depth-stage");
        const frame = stage?.querySelector(".frame");
        if (
          !stage ||
          stage.hidden ||
          (frame && !frame.childElementCount) ||
          waitingForFrame
        )
          return;
        waitingForFrame = true;
        // Screenshot walkthroughs use SVG images inside the shadow root.
        // Their first frame must decode too; later playback stays independent.
        const images = [...demo.shadowRoot.querySelectorAll("img[src]")];
        if (typeof Image !== "undefined") {
          for (const node of demo.shadowRoot.querySelectorAll("image[href]")) {
            const image = new Image();
            image.src = node.getAttribute("href");
            images.push(image);
          }
        }
        Promise.all(images.map((image) => imageReady(image, cycle))).then(settle, settle);
      };
      const observe = () => {
        if (cycle.abort.signal.aborted) return settle();
        observer = new MutationObserver(check);
        observer.observe(demo, { attributes: true });
        if (demo.shadowRoot)
          observer.observe(demo.shadowRoot, {
            subtree: true,
            childList: true,
            attributes: true,
          });
        check();
      };
      cycle.abort.signal.addEventListener("abort", settle, { once: true });
      if (customElements.get("feedbacks-demo")) observe();
      else customElements.whenDefined("feedbacks-demo").then(observe);
    });
  }
  async function prepare(cycle) {
    try {
      await paint();
      if (cycle !== active) return;
      await Promise.all([
        document.fonts?.ready,
        ...[...document.querySelectorAll("img[src]")]
          .filter(visible)
          .map((image) => imageReady(image, cycle)),
        ...[...document.querySelectorAll("feedbacks-demo")]
          .filter(visible)
          .map((demo) => demoReady(demo, cycle)),
      ]);
      if (cycle !== active) return;
      const animations = document.getAnimations().filter((animation) => {
        const target = animation.effect?.target;
        return (
          target instanceof Element &&
          !indicator.contains(target) &&
          visible(target) &&
          Number.isFinite(animation.effect.getComputedTiming().endTime)
        );
      });
      await Promise.allSettled(animations.map((animation) => animation.finished));
      await paint();
      await paint();
      finish(cycle);
    } catch {
      finish(cycle, "degraded");
    }
  }
  const initial = begin();
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", () => prepare(initial), { once: true });
  else prepare(initial);
  window.addEventListener("feedbacks:route-start", () => begin());
  window.addEventListener("feedbacks:route-ready", () => prepare(active ?? begin()));
  window.addEventListener(
    "feedbacks:route-cancel",
    () => active && finish(active, "cancelled"),
  );
  window.addEventListener("pagehide", () => active && finish(active, "cancelled"));
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) prepare(begin());
  });
  document.addEventListener("click", (event) => {
    if (
      (location.pathname.startsWith("/docs/") && !event.target.closest?.(".vp-raw")) ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const link = event.target.closest?.("a[href]");
    if (
      !link ||
      link.hasAttribute("download") ||
      (link.target && link.target !== "_self")
    )
      return;
    const next = new URL(link.href, location.href);
    if (
      next.origin === location.origin &&
      next.pathname + next.search !== location.pathname + location.search
    )
      begin();
  });
})();
