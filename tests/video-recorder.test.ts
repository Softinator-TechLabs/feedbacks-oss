import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

test("lost create acknowledgement retries the original comment and review target", async () => {
  const html = await readFile(
    new URL("../extension/video.html", import.meta.url),
    "utf8",
  );
  const nodes: Record<string, any> = Object.fromEntries(
    [...html.matchAll(/id="([^"]+)"/g)].map((match) => [
      match[1],
      { value: "", textContent: "", hidden: false, disabled: false, readOnly: false },
    ]),
  );
  const sent: any[] = [];
  const target = {
    project: { id: "project-a", name: "Project A" },
    projectId: "project-a",
    reviewId: "review-a",
    server: "https://feedback.example.test",
    url: "https://site.example.test/a",
    viewport: { width: 1280, height: 800 },
    routeFingerprint: "route-a",
  };
  const context = vm.createContext({
    Blob,
    URL,
    crypto,
    console,
    location: { href: "chrome-extension://test/video.html?sourceTabId=10" },
    document: { getElementById: (id: string) => nodes[id] },
    window: { addEventListener() {} },
    chrome: {
      runtime: {
        sendMessage: async (message: any) => {
          if (message.type === "videoContext") return { ok: true, data: target };
          if (message.type === "videoCreate") {
            sent.push(structuredClone(message));
            return { ok: false, error: "Response lost", code: "NETWORK" };
          }
          throw Error(`Unexpected ${message.type}`);
        },
      },
    },
  });
  vm.runInContext(
    await readFile(new URL("../extension/video.js", import.meta.url), "utf8"),
    context,
  );
  await new Promise((resolve) => setImmediate(resolve));
  vm.runInContext("blob = new Blob(['recording']); durationMs = 1000", context);
  nodes.comment.value = "Original comment";
  await nodes.send.onclick();
  nodes.comment.value = "Edited after lost response";
  await nodes.send.onclick();
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1], sent[0]);
  assert.equal(nodes.comment.readOnly, true);
});
