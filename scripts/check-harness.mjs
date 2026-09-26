import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { sourceFiles } from "./source-files.mjs";
import {
  adapterErrors,
  architectureErrors,
  documentationErrors,
} from "./lib/harness.mjs";

const root = resolve(import.meta.dirname, "..");
const files = await sourceFiles(root);
const documents = new Map();
const errors = [];
for (const file of files) {
  if (!/\.(?:md|[cm]?[jt]sx?)$/.test(file)) continue;
  const text = await readFile(join(root, file), "utf8");
  if (file.endsWith(".md")) {
    // VitePress links are rooted at /docs/ and its build validates them separately.
    if (!file.startsWith("site-docs/")) documents.set(file, text);
  } else errors.push(...architectureErrors(file, text));
}
errors.push(
  ...documentationErrors(documents, new Set(files)),
  ...adapterErrors(documents),
);
if (errors.length) throw new Error(errors.join("\n"));
console.log(
  `Harness checks passed: ${documents.size} documents and runtime import boundaries.`,
);
