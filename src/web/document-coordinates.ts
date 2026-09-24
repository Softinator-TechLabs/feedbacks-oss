export function pointFromClient(
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
) {
  return {
    x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
  };
}

export function percentPoint(x: string, y: string) {
  const values = [x, y].map((value) => value.trim());
  if (
    values.some(
      (value) =>
        value === "" ||
        !Number.isFinite(Number(value)) ||
        Number(value) < 0 ||
        Number(value) > 100,
    )
  )
    throw new Error("Position must be between 0 and 100 percent");
  return { x: Number(values[0]) / 100, y: Number(values[1]) / 100 };
}
