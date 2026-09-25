import type { ReviewFilters } from "../shared/contracts.js";
export const categories = [
  "general",
  "visualDesign",
  "productWorkflow",
  "usabilityAccessibility",
] as const;
export function readFilters(query: string): ReviewFilters {
  const p = new URLSearchParams(query);
  const sort = p.get("sort");
  const filters: ReviewFilters = {
    search: (p.get("search") ?? "").slice(0, 200),
    sort:
      sort === "newest" || sort === "likes" || sort === "priority" ? sort : "activity",
    showResolved: p.get("showResolved") === "true",
  };
  for (const key of ["url", "domain", "hostname", "tag"] as const) {
    const value = p.get(key)?.trim();
    if (value)
      filters[key] = value.slice(0, key === "url" ? 4096 : key === "tag" ? 32 : 253);
  }
  if (["mobile", "tablet", "desktop"].includes(p.get("deviceClass") ?? ""))
    filters.deviceClass = p.get("deviceClass") as ReviewFilters["deviceClass"];
  if (categories.includes(p.get("category") as any))
    filters.category = p.get("category") as ReviewFilters["category"];
  return filters;
}
export function filterQuery(filters: ReviewFilters, offset = 0) {
  const p = new URLSearchParams();
  for (const [key, value] of Object.entries(filters))
    if (value && !(key === "sort" && value === "activity")) p.set(key, String(value));
  if (offset > 0) p.set("offset", String(offset));
  return p.size ? `?${p}` : "";
}
export function readOffset(query: string) {
  const value = Number(new URLSearchParams(query).get("offset"));
  return Number.isInteger(value) && value >= 0 && value <= 100000 ? value : 0;
}
export const splitTags = (value: string) =>
  value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
