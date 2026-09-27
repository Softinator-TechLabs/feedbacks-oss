import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../extension/utils.js", import.meta.url), "utf8");
const context = vm.createContext({ URL });
vm.runInContext(source, context);
const shortcut = (context as any).FeedbacksUtil.shortcut;

test("bare letters never switch review viewport while typing", () => {
  for (const key of ["m", "t", "d", "w"])
    assert.equal(shortcut({ key, target: {}, composedPath: () => [{}] }), null);
});

test("modified viewport shortcuts skip editors and nested editable targets", () => {
  const editor = { matches: () => true, closest: () => null };
  const event = {
    key: "t",
    altKey: true,
    shiftKey: true,
    target: editor,
    composedPath: () => [editor],
  };
  assert.equal(shortcut(event), null);
  assert.equal(shortcut({ ...event, target: {}, composedPath: () => [{}] }), "tablet");
});
