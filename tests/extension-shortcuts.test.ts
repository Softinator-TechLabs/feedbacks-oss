import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../extension/utils.js", import.meta.url), "utf8");
const context = vm.createContext({ URL });
vm.runInContext(source, context);
const shortcut = (context as any).FeedbacksUtil.shortcut;

test("single letters switch viewport outside editors", () => {
  for (const [key, mode] of Object.entries({
    m: "mobile",
    t: "tablet",
    d: "desktop",
    w: "wide",
    s: "capture",
    p: "capture-full",
    r: "stop",
  }))
    assert.equal(shortcut({ key, target: {}, composedPath: () => [{}] }), mode);
});

test("single-letter shortcuts skip editors, nested targets and modifiers", () => {
  const editor = { matches: () => true, closest: () => null };
  const event = {
    key: "t",
    altKey: false,
    shiftKey: false,
    target: editor,
    composedPath: () => [editor],
  };
  assert.equal(shortcut(event), null);
  assert.equal(shortcut({ ...event, target: {}, composedPath: () => [{}] }), "tablet");
});

test("typing in nested and shadow editors, composition and modifiers stays untouched", () => {
  const ordinary = { key: "t", target: {}, composedPath: () => [{}] };
  for (const change of [
    { altKey: true },
    { shiftKey: true },
    { ctrlKey: true },
    { metaKey: true },
    { repeat: true },
    { isComposing: true },
    { composedPath: () => [{}, { isContentEditable: true }] },
    { target: { closest: () => ({}) }, composedPath: undefined },
  ])
    assert.equal(shortcut({ ...ordinary, ...change }), null);
});
