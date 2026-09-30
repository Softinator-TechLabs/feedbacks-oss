for (const matrix of document.querySelectorAll(".compare-matrix")) {
  const scroller = matrix.querySelector(".matrix-scroll");
  const feature = matrix.querySelector("thead th:first-child");
  const ours = matrix.querySelector("thead .matrix-ours");
  const tools = [...matrix.querySelectorAll("thead th[data-tool]")].slice(1);
  const previous = matrix.querySelector(".matrix-prev");
  const next = matrix.querySelector(".matrix-next");
  const position = matrix.querySelector(".matrix-position");
  const controls = matrix.querySelector(".matrix-controls");
  if (
    !scroller ||
    !feature ||
    !ours ||
    !tools.length ||
    !previous ||
    !next ||
    !position ||
    !controls
  )
    continue;
  const behavior = () =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  function update() {
    controls.hidden = scroller.scrollWidth <= scroller.clientWidth + 1;
    const step = tools[0].getBoundingClientRect().width;
    const index = Math.min(
      tools.length,
      Math.max(1, Math.floor(scroller.scrollLeft / step) + 1),
    );
    position.textContent = `Tool ${index} of ${tools.length}`;
    previous.disabled = scroller.scrollLeft <= 1;
    next.disabled =
      scroller.scrollLeft >= scroller.scrollWidth - scroller.clientWidth - 1;
  }
  function move(direction) {
    const fixed =
      feature.getBoundingClientRect().width + ours.getBoundingClientRect().width;
    const step = tools[0].getBoundingClientRect().width;
    const visible = Math.max(1, Math.floor((scroller.clientWidth - fixed) / step));
    scroller.scrollBy({ left: direction * step * visible, behavior: behavior() });
  }
  previous.addEventListener("click", () => move(-1));
  next.addEventListener("click", () => move(1));
  scroller.addEventListener("scroll", update, { passive: true });
  window.addEventListener("resize", update);
  for (const link of matrix.querySelectorAll(".matrix-jump a")) {
    link.addEventListener("click", (event) => {
      const id = link.getAttribute("href").slice(1);
      const row = document.getElementById(id);
      if (!row) return;
      event.preventDefault();
      const top =
        row.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top +
        scroller.scrollTop -
        68;
      scroller.scrollTo({ top: Math.max(0, top), behavior: behavior() });
      history.replaceState(null, "", `#${id}`);
      scroller.focus({ preventScroll: true });
    });
  }
  scroller.addEventListener("focusin", (event) => {
    const target = event.target;
    if (
      !(target instanceof HTMLElement) ||
      target.closest(".matrix-ours") ||
      target.closest('th[scope="row"]')
    )
      return;
    requestAnimationFrame(() => {
      if (target !== document.activeElement) return;
      const viewport = scroller.getBoundingClientRect();
      const box = target.getBoundingClientRect();
      const left =
        viewport.left +
        feature.getBoundingClientRect().width +
        ours.getBoundingClientRect().width +
        1;
      const right = viewport.right - 1;
      const top = matrix.querySelector("thead").getBoundingClientRect().bottom;
      const deltaX =
        box.left < left ? box.left - left : box.right > right ? box.right - right : 0;
      const deltaY =
        box.top < top
          ? box.top - top
          : box.bottom > viewport.bottom
            ? box.bottom - viewport.bottom
            : 0;
      if (deltaX || deltaY)
        scroller.scrollBy({ left: deltaX, top: deltaY, behavior: "instant" });
    });
  });
  const popover = matrix.querySelector(".evidence-popover");
  if (popover && typeof popover.showPopover === "function") {
    let trigger;
    const close = popover.querySelector(".evidence-close");
    close.addEventListener("click", () => popover.hidePopover());
    popover.addEventListener("toggle", (event) => {
      if (event.newState === "closed" && trigger) {
        trigger.setAttribute("aria-expanded", "false");
        trigger.focus({ preventScroll: true });
      }
    });
    for (const details of matrix.querySelectorAll(".matrix-evidence")) {
      const summary = details.querySelector("summary");
      summary.setAttribute("aria-expanded", "false");
      summary.setAttribute("aria-controls", popover.id);
      summary.setAttribute("aria-haspopup", "dialog");
      summary.addEventListener("click", (event) => {
        event.preventDefault();
        if (trigger) trigger.setAttribute("aria-expanded", "false");
        trigger = summary;
        trigger.setAttribute("aria-expanded", "true");
        popover.querySelector("h3").textContent = summary.dataset.evidenceTitle;
        popover
          .querySelector(".evidence-content")
          .replaceChildren(
            ...[...details.querySelector(".matrix-evidence-body").children].map((node) =>
              node.cloneNode(true),
            ),
          );
        popover.showPopover();
        close.focus({ preventScroll: true });
      });
    }
  }
  update();
}
