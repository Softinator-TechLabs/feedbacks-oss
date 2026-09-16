import { buildSync } from "esbuild";
import { posix } from "node:path";

const roots = ["src/shared", "src/server", "src/web", "src/cli", "extension", "site"];
const layer = (file) => roots.find((root) => file.startsWith(`${root}/`));
const allowed = {
  "src/shared": ["src/shared"],
  "src/server": ["src/server", "src/shared"],
  "src/web": ["src/web", "src/shared"],
  "src/cli": ["src/cli", "src/shared"],
  extension: ["extension"],
  site: ["site"],
};

export function architectureErrors(file, text) {
  const from = layer(file);
  if (!from) return [];
  const result = buildSync({
    stdin: {
      contents: text,
      sourcefile: file,
      loader: file.endsWith("tsx") ? "tsx" : file.endsWith("ts") ? "ts" : "js",
    },
    bundle: false,
    write: false,
    metafile: true,
    format: "esm",
    logLevel: "silent",
    tsconfigRaw: { compilerOptions: { verbatimModuleSyntax: true } },
  });
  const errors = [];
  const imports = Object.values(result.metafile.outputs).flatMap(
    (output) => output.imports,
  );
  for (const { path: value } of imports) {
    const target = posix.normalize(posix.join(posix.dirname(file), value));
    const compatibilityEdges = {
      "src/cli/bootstrap.ts": [
        "../server/config.js",
        "../server/db.js",
        "../server/migrations.js",
        "../server/auth.js",
      ],
      "src/cli/client.ts": ["../server/errors.js"],
      "src/cli/feedbacks.ts": ["../server/errors.js"],
      "src/cli/mcp.ts": ["../server/mcp.js"],
    };
    const compatibilityEdge = compatibilityEdges[file]?.includes(value);
    if (value.startsWith(".")) {
      if (!allowed[from].includes(layer(target)) && !compatibilityEdge)
        errors.push(
          `${file}: ${value} crosses the ${from} boundary; use shared contracts or an HTTP operation`,
        );
    } else if (from === "src/shared" && value !== "zod") {
      errors.push(
        `${file}: shared contracts may import only zod or other shared modules`,
      );
    } else if (from === "extension" || from === "site") {
      errors.push(`${file}: ${from} must use bundled relative imports, not ${value}`);
    }
  }
  return errors;
}

export function markdownLinks(text) {
  const prose = text.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, "");
  return [...prose.matchAll(/\[[^\]]*\]\(([^\s)]+)\)/g)].map((m) => m[1]);
}

export function documentationErrors(documents, paths) {
  const errors = [];
  const edges = new Map();
  for (const [file, text] of documents) {
    const targets = [];
    for (const href of markdownLinks(text)) {
      if (/^[a-z][a-z\d+.-]*:/i.test(href)) continue;
      const [rawPath] = href.split("#");
      let decoded;
      try {
        decoded = decodeURIComponent(rawPath);
      } catch {
        errors.push(`${file}: malformed link ${href}`);
        continue;
      }
      const target = decoded
        ? posix.normalize(posix.join(posix.dirname(file), decoded))
        : file;
      if (
        decoded.startsWith("/") ||
        target.startsWith("../") ||
        (!paths.has(target) && ![...paths].some((p) => p.startsWith(`${target}/`)))
      )
        errors.push(`${file}: missing or nonportable link ${href}`);
      if (documents.has(target)) targets.push(target);
    }
    edges.set(file, targets);
  }
  const visited = new Set();
  function visit(file) {
    if (visited.has(file)) return;
    visited.add(file);
    for (const target of edges.get(file) ?? []) visit(target);
  }
  visit("docs/index.md");
  for (const file of documents.keys())
    if (file.startsWith("docs/") && !visited.has(file))
      errors.push(
        `${file}: orphan document; link it from docs/index.md or a reachable guide`,
      );
  for (const file of ["AGENTS.md", "docs/maintaining-docs.md"])
    if (!documents.has(file))
      errors.push(`${file}: required agent entry point is missing`);
    else if (documents.get(file).split("\n").length > 100)
      errors.push(`${file}: keep the entry point under 100 lines; link deeper guidance`);
  return errors;
}

export function adapterErrors(documents) {
  const expected = { "CLAUDE.md": "@AGENTS.md", "GEMINI.md": "@./AGENTS.md" };
  return Object.entries(expected).flatMap(([file, directive]) => {
    const text = documents.get(file) ?? "";
    if (text.split("\n")[0] !== directive || text.split("\n").length > 20)
      return [
        `${file}: keep a thin adapter starting with ${directive}; edit AGENTS.md for shared policy`,
      ];
    return [];
  });
}
