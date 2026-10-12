import test from "node:test";
import assert from "node:assert/strict";
import {
  clearListSnapshots,
  listCacheGeneration,
  readListSnapshot,
  rememberListSnapshot,
  type ListSnapshot,
} from "../src/web/threads/list-cache.js";

test("list snapshots are bounded and stale requests cannot repopulate a changed account", () => {
  clearListSnapshots();
  const generation = listCacheGeneration();
  const snapshot: ListSnapshot = {
    query: "",
    projectId: "project",
    result: {
      items: [],
      total: 0,
      nextOffset: null,
      websiteFilters: { domains: [], hostnames: [] },
    },
  };
  for (let index = 0; index < 11; index++)
    rememberListSnapshot(`member:project:${index}`, snapshot, generation);
  assert.equal(readListSnapshot("member:project:0"), undefined);
  assert.equal(readListSnapshot("other-member:project:10"), undefined);
  assert.equal(readListSnapshot("member:project:10"), snapshot);
  clearListSnapshots();
  rememberListSnapshot("member:project:10", snapshot, generation);
  assert.equal(readListSnapshot("member:project:10"), undefined);
  rememberListSnapshot("member:project:10", snapshot, listCacheGeneration());
  assert.equal(readListSnapshot("member:project:10"), snapshot);
  clearListSnapshots();
});
