import assert from "node:assert/strict";
import test from "node:test";
import { writeTaskClipboard } from "../src/web/threads/task-copy.js";

test("task copy returns when the browser leaves clipboard permission pending", async () => {
  await assert.rejects(
    writeTaskClipboard("Synthetic task", () => new Promise<void>(() => {}), 10),
    /Clipboard unavailable/,
  );
});

test("task copy preserves native success and rejection for the manual fallback", async () => {
  let copied = "";
  await writeTaskClipboard(
    "Synthetic task",
    async (text) => {
      copied = text;
    },
    100,
  );
  assert.equal(copied, "Synthetic task");
  await assert.rejects(
    writeTaskClipboard(
      "Synthetic task",
      async () => {
        throw new Error("Permission denied");
      },
      100,
    ),
    /Permission denied/,
  );
});
