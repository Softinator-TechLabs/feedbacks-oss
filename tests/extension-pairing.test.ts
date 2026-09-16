import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error The extension ships bundled native JavaScript.
import { createPairingCoordinator } from "../extension/pairing.js";
function fixture(granted = false) {
  let state: any = {},
    permitted = granted,
    time = 1000;
  const starts: any[] = [];
  const coordinator = createPairingCoordinator({
    get: async () => state,
    set: async (v: any) => {
      state = { ...state, ...v };
    },
    remove: async (k: string) => {
      delete state[k];
    },
    contains: async () => permitted,
    start: async (v: any) => {
      starts.push(v);
    },
    now: () => time,
  });
  return {
    coordinator,
    starts,
    state: () => state,
    grant: () => {
      permitted = true;
    },
    expire: () => {
      time += 120001;
    },
  };
}
const intent = {
  server: "https://review.example.test",
  allowLocal: false,
  requestId: "00000000-0000-4000-8000-000000000001",
};
test("permission event completes pairing after the popup is gone, exactly once", async () => {
  const f = fixture();
  await f.coordinator.prepare(intent);
  assert.equal(f.starts.length, 0);
  f.grant();
  await Promise.all([f.coordinator.finish(), f.coordinator.finish()]);
  assert.equal(f.starts.length, 1);
  assert.equal(f.starts[0].server, intent.server);
  assert.equal(f.state().pairIntent, undefined);
});
test("an already granted permission or an event arriving before intent persistence still starts once", async () => {
  const f = fixture(true);
  await f.coordinator.finish();
  await f.coordinator.prepare(intent);
  await f.coordinator.finish();
  assert.equal(f.starts.length, 1);
});
test("denied, cancelled and expired intents cannot start a connection later", async () => {
  for (const mode of ["denied", "cancelled", "expired"]) {
    const f = fixture();
    await f.coordinator.prepare(intent);
    if (mode === "cancelled") await f.coordinator.cancel(intent.requestId);
    if (mode === "expired") f.expire();
    if (mode !== "denied") f.grant();
    await f.coordinator.finish();
    assert.equal(f.starts.length, 0, mode);
  }
});
test("an older popup cancellation cannot erase a newer connection choice", async () => {
  const f = fixture();
  await f.coordinator.prepare(intent);
  await f.coordinator.prepare({
    ...intent,
    requestId: "00000000-0000-4000-8000-000000000002",
    server: "https://new.example.test",
  });
  await f.coordinator.cancel(intent.requestId);
  f.grant();
  await f.coordinator.finish();
  assert.equal(f.starts.length, 1);
  assert.equal(f.starts[0].server, "https://new.example.test");
});
