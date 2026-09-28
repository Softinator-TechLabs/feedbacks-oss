import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(
  new URL("../extension/content.js", import.meta.url),
  "utf8",
);
const start = source.indexOf(
  '  F.listen(\n    "keydown",',
  source.indexOf('globalThis.navigation?.addEventListener("navigate"'),
);
const handlerSource = source.slice(
  start,
  source.indexOf("  let scheduled = false;", start),
);
const recordingBusySource = source.slice(
  source.indexOf("  const recordingBusy ="),
  source.indexOf("  function revealDrawer("),
);
function fixture({
  menu = false,
  image = false,
  active = true,
  recordingState = "idle",
} = {}) {
  const sent: unknown[] = [];
  const state: any = {
    active,
    recordingState,
    choosing: false,
    chosen: null,
    reviewShortcuts: false,
    root: {
      querySelector: () =>
        image
          ? {
              remove: () => {
                image = false;
              },
            }
          : null,
    },
    pointMenu: { classList: { contains: () => !menu } },
    pointText: { value: "draft" },
    notice: { textContent: "" },
    releasePointImage() {},
    closePointMenu() {
      menu = false;
    },
    clearChosenPoint() {},
    renderPins() {},
    revealDrawer() {},
    send: async (message: unknown) => {
      sent.push(message);
    },
    F: {
      listen: (_: string, handler: unknown) => {
        state.handler = handler;
      },
    },
  };
  vm.runInNewContext(recordingBusySource + handlerSource, state);
  const press = (extra = {}) =>
    state.handler({
      key: "Escape",
      preventDefault() {},
      stopImmediatePropagation() {},
      ...extra,
    });
  return { sent, press, state };
}
test("Escape stops review even when letter shortcuts are disabled", () => {
  const f = fixture();
  f.press();
  assert.equal(JSON.stringify(f.sent), JSON.stringify([{ type: "stopReview" }]));
});
test("Escape closes point editor or image first, then stops review", () => {
  for (const option of [{ menu: true }, { image: true }]) {
    const f = fixture(option);
    f.press();
    assert.equal(f.sent.length, 0);
    f.press();
    assert.equal(f.sent.length, 1);
  }
});
test("Escape ignores inactive review, composition and held-key repeats", () => {
  const inactive = fixture({ active: false });
  inactive.press();
  assert.equal(inactive.sent.length, 0);
  const f = fixture();
  f.press({ isComposing: true });
  f.press({ repeat: true });
  assert.equal(f.sent.length, 0);
});

test("Escape stays with the website while video is starting, recording, paused or stopping", () => {
  for (const recordingState of ["starting", "recording", "paused", "stopping"]) {
    const f = fixture({ recordingState });
    let intercepted = false;
    f.press({
      preventDefault() {
        intercepted = true;
      },
      stopImmediatePropagation() {
        intercepted = true;
      },
    });
    assert.equal(f.sent.length, 0, `${recordingState} must not end the review`);
    assert.equal(
      intercepted,
      false,
      `${recordingState} must leave Escape available to the website`,
    );
  }
  const ready = fixture({ recordingState: "ready" });
  ready.press();
  assert.deepEqual(
    ready.sent.map((entry: any) => entry.type),
    ["stopReview"],
  );
});
