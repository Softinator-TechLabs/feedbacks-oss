export const builtInCategories = [
  { id: "general", name: "General", archived: false },
  { id: "visualDesign", name: "Visual design", archived: false },
  { id: "productWorkflow", name: "Product workflow", archived: false },
  { id: "usabilityAccessibility", name: "Usability & accessibility", archived: false },
] as const;

export const tagColors = [
  "slate",
  "blue",
  "teal",
  "mint",
  "amber",
  "rose",
  "violet",
] as const;
export type TagColor = (typeof tagColors)[number];

export function defaultTagColor(name: string): TagColor {
  let hash = 2166136261;
  for (const char of name.toLowerCase()) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 16777619);
  }
  return tagColors[(hash >>> 0) % tagColors.length];
}

export type ProjectCategory = { id: string; name: string; archived: boolean };
export type ProjectTag = { name: string; color: TagColor; managed?: boolean };
export type ProjectTaxonomy = {
  revision: number;
  categories: ProjectCategory[];
  tags: ProjectTag[];
};

export function categoryName(categories: readonly ProjectCategory[], id: string): string {
  return categories.find((category) => category.id === id)?.name ?? id;
}

export function colorForTag(tags: readonly ProjectTag[], name: string): TagColor {
  return tags.find((tag) => tag.name === name)?.color ?? defaultTagColor(name);
}
