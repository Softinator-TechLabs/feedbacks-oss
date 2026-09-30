export function evidenceLayer(shape) {
  return shape.tool === "point"
    ? "points"
    : shape.origin === "element"
      ? "element"
      : shape.origin === "text-selection"
        ? "text"
        : null;
}
export function visibleShapes(shapes, hidden = new Set(["element"])) {
  return shapes.filter((shape) => !hidden.has(evidenceLayer(shape)));
}
export function withoutEvidenceLayers(shapes) {
  return shapes.filter((shape) => !evidenceLayer(shape));
}
