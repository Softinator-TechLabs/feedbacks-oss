// Category tables use normal page flow; only mobile product details collapse.
for (const row of document.querySelectorAll(".compare-matrix tr[data-tool]")) {
  const toggle = row.querySelector(".matrix-product-toggle");
  if (!toggle) continue;
  row.classList.add("matrix-collapsible");
  toggle.hidden = false;
  row.classList.toggle("is-expanded", toggle.getAttribute("aria-expanded") === "true");
  toggle.addEventListener("click", () => {
    const expanded = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", String(expanded));
    row.classList.toggle("is-expanded", expanded);
    toggle.querySelector(".matrix-product-sign").textContent = expanded ? "−" : "+";
  });
}
const popover = document.querySelector(".evidence-popover");
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
  for (const details of document.querySelectorAll(".matrix-evidence")) {
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
