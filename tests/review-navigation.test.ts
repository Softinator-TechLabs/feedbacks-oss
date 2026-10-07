import test from "node:test";
import assert from "node:assert/strict";
import { createReviewNavigation } from "../extension/submission/review-navigation.js";

function fixture({ closed = false, leaveFails = false } = {}) {
  const events: unknown[] = [];
  const navigation = createReviewNavigation({
    sourceTabId: () => 10,
    leaveReview: async () => {
      if (leaveFails) throw Error("Review could not end");
      events.push(["review-off", 10]);
    },
    navigate: (url: string) => events.push(["navigate", url]),
    chromeApi: {
      windows: { update: async (id: number) => events.push(["window", id]) },
      tabs: {
        getCurrent: async () => ({ id: 20, windowId: 2 }),
        get: async () => {
          if (closed) throw Error("No tab");
          return { id: 10, windowId: 1 };
        },
        update: async (id: number) => events.push(["focus", id]),
        remove: async (id: number) => events.push(["close", id]),
      },
    },
  });
  return { events, navigation };
}

test("background sending returns across windows and closes only the capture tab on completion", async () => {
  const { navigation, events } = fixture();
  await navigation.begin("background");
  assert.deepEqual(events, [
    ["review-off", 10],
    ["window", 1],
    ["focus", 10],
  ]);
  await navigation.complete("https://feedback.test/threads/one");
  assert.deepEqual(events.at(-1), ["close", 20]);
});

test("failed background sending returns to the review for retry without closing it", async () => {
  const { navigation, events } = fixture();
  await navigation.begin("background");
  await navigation.recover();
  assert.deepEqual(events.slice(-2), [
    ["window", 2],
    ["focus", 20],
  ]);
  assert.equal(
    events.some((event: any) => event[0] === "close"),
    false,
  );
  await navigation.begin("thread");
  await navigation.complete("https://feedback.test/threads/same");
  assert.deepEqual(events.at(-1), ["navigate", "https://feedback.test/threads/same"]);
});

test("a closed source tab keeps the draft available for foreground sending", async () => {
  const { navigation, events } = fixture({ closed: true });
  await assert.rejects(navigation.begin("background"), /website tab is closed/);
  assert.deepEqual(events, []);
  await navigation.begin("thread");
  await navigation.complete("https://feedback.test/threads/one");
  assert.equal(events.length, 1);
});

test("a failed review handoff keeps the website unfocused and permits foreground retry", async () => {
  const { navigation, events } = fixture({ leaveFails: true });
  await assert.rejects(navigation.begin("background"), /Review could not end/);
  assert.deepEqual(events, []);
  await navigation.begin("thread");
  await navigation.complete("https://feedback.test/threads/one");
  assert.deepEqual(events, [["navigate", "https://feedback.test/threads/one"]]);
});
