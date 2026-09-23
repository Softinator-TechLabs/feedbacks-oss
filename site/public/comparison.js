for (const matrix of document.querySelectorAll(".compare-matrix")) {
  const scroller = matrix.querySelector(".matrix-scroll");
  const firstFeature = matrix.querySelector("thead th:nth-child(2)");
  const previous = matrix.querySelector(".matrix-prev");
  const next = matrix.querySelector(".matrix-next");
  const position = matrix.querySelector(".matrix-position");
  const controls = matrix.querySelector(".matrix-controls");
  const count = matrix.querySelectorAll("thead th").length - 1;
  if (!scroller || !firstFeature || !previous || !next || !position || !controls)
    continue;

  function update() {
    controls.hidden = scroller.scrollWidth <= scroller.clientWidth + 1;
    const step = firstFeature.getBoundingClientRect().width;
    const index = Math.min(
      count,
      Math.max(1, Math.round(scroller.scrollLeft / step) + 1),
    );
    position.textContent = `Feature ${index} of ${count}`;
    previous.disabled = scroller.scrollLeft <= 1;
    next.disabled =
      scroller.scrollLeft >= scroller.scrollWidth - scroller.clientWidth - 1;
  }

  function move(direction) {
    const step = firstFeature.getBoundingClientRect().width;
    const visible = Math.max(1, Math.floor((scroller.clientWidth - 148) / step));
    scroller.scrollBy({ left: direction * step * visible, behavior: "smooth" });
  }

  previous.addEventListener("click", () => move(-1));
  next.addEventListener("click", () => move(1));
  scroller.addEventListener("scroll", update, { passive: true });
  window.addEventListener("resize", update);
  update();
}
