import type { Thread } from "../api.js";

export type ListResult = {
  items: Thread[];
  total: number;
  nextOffset: number | null;
  websiteFilters: { domains: string[]; hostnames: string[] };
  summary?: {
    threads: { open: number; closed: number; total: number };
    points: { open: number; resolved: number; closed: number; total: number };
  };
};
export type ListSnapshot = { query: string; projectId: string; result: ListResult };
const snapshots = new Map<string, ListSnapshot>();
let generation = 0;
export function clearListSnapshots() {
  snapshots.clear();
  generation++;
}
export const listCacheGeneration = () => generation;
export function readListSnapshot(key: string) {
  return snapshots.get(key);
}
export function rememberListSnapshot(
  key: string,
  snapshot: ListSnapshot,
  expectedGeneration: number,
) {
  if (expectedGeneration !== generation) return;
  snapshots.delete(key);
  snapshots.set(key, snapshot);
  if (snapshots.size > 10) snapshots.delete(snapshots.keys().next().value!);
}
if (typeof window !== "undefined")
  window.addEventListener("feedbacks:account-change", clearListSnapshots);
