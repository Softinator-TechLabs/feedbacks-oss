import assert from "node:assert/strict";
import { test } from "node:test";
import { createDebuggerLease } from "../extension/diagnostics/debugger-lease.js";

function harness() {
  const calls: string[] = [];
  let onDetach: (source: { tabId: number }) => void = () => {};
  const chrome = {
    debugger: {
      onDetach: {
        addListener: (listener: typeof onDetach) => {
          onDetach = listener;
        },
      },
      attach: async ({ tabId }: { tabId: number }) => {
        calls.push(`attach:${tabId}`);
      },
      detach: async ({ tabId }: { tabId: number }) => {
        calls.push(`detach:${tabId}`);
        onDetach({ tabId });
      },
    },
  };
  return { lease: createDebuggerLease(chrome), calls, onDetach: () => onDetach };
}

for (const order of [
  ["screenshot-diagnostics", "recording"],
  ["recording", "screenshot-diagnostics"],
]) {
  test(`debugger lease shares one attachment when ${order[0]} starts first`, async () => {
    const h = harness();
    await h.lease.acquire(5, order[0]);
    await h.lease.acquire(5, order[1]);
    assert.deepEqual(h.calls, ["attach:5"]);
    assert.equal(h.lease.hasOwner(5, "screenshot-diagnostics"), true);
    assert.equal(h.lease.hasOwner(5, "recording"), true);
    await h.lease.release(5, order[0]);
    assert.deepEqual(h.calls, ["attach:5"]);
    await h.lease.release(5, order[1]);
    assert.deepEqual(h.calls, ["attach:5", "detach:5"]);
  });
}

test("external debugger detach clears leases before the next attachment", async () => {
  const h = harness();
  await h.lease.acquire(5, "recording");
  h.onDetach()({ tabId: 5 });
  assert.equal(h.lease.hasOwner(5, "recording"), false);
  await h.lease.acquire(5, "screenshot-diagnostics");
  assert.deepEqual(h.calls, ["attach:5", "attach:5"]);
  await h.lease.release(5, "screenshot-diagnostics");
});
