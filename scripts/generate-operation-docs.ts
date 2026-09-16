import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { format } from "prettier";
import { operationRegistry, agentTokenScopes } from "../src/shared/contracts.js";

const destination = resolve(import.meta.dirname, "../docs/generated/operations.md");
const scoped = new Set<string>(agentTokenScopes);
const content = await format(
  [
    "# Operation catalog",
    "",
    "Generated from [shared contracts](../../src/shared/contracts.ts). Do not edit by hand.",
    "",
    "Regenerate with `npm run docs:generate`; CI checks for drift with `npm run docs:check`.",
    "",
    "Read-only is a transport annotation, not an authorization grant. Scope availability does not grant project access. See the [MCP contract](../mcp-contract.md) and [API](../api.md).",
    "",
    "| Operation | Read-only annotation | Available in scoped agent keys |",
    "| --- | --- | --- |",
    ...Object.entries(operationRegistry)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([name, entry]) =>
          `| \`${name}\` | ${entry.readOnly ? "Yes" : "No"} | ${scoped.has(name) ? "Yes" : "No"} |`,
      ),
    "",
  ].join("\n"),
  { parser: "markdown", printWidth: 88 },
);
if (process.argv.includes("--check")) {
  if ((await readFile(destination, "utf8")) !== content)
    throw new Error(
      "Operation docs are stale. Run npm run docs:generate and review the diff.",
    );
  console.log("Operation catalog matches the shared registry.");
} else {
  await mkdir(resolve(destination, ".."), { recursive: true });
  await writeFile(destination, content);
  console.log("Updated docs/generated/operations.md");
}
