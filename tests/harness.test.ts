import test from "node:test";
import assert from "node:assert/strict";
import {
  adapterErrors,
  architectureErrors,
  documentationErrors,
} from "../scripts/lib/harness.mjs";

test("architecture guard rejects reverse, dynamic and re-export dependencies", () => {
  for (const code of [
    'import x from "../server/db.js";',
    'export { x } from "../server/db.js";',
    'const x = import("../server/db.js");',
    'const x = require("../server/db.js");',
  ])
    assert.ok(architectureErrors("src/web/page.tsx", code).length, code);
  assert.ok(
    architectureErrors("src/shared/example.ts", 'import fs from "node:fs";').length,
  );
  assert.ok(
    architectureErrors(
      "extension/popup.js",
      'import x from "https://example.test/code.js";',
    ).length,
  );
  assert.equal(
    architectureErrors("src/web/page.tsx", 'import { x } from "../shared/contracts.js";')
      .length,
    0,
  );
  assert.equal(
    architectureErrors(
      "src/cli/bootstrap.ts",
      'import { Auth } from "../server/auth.js";',
    ).length,
    0,
  );
  assert.ok(
    architectureErrors("src/cli/client.ts", 'import { Auth } from "../server/auth.js";')
      .length,
  );
});

test("knowledge guard catches missing links, orphan pages and oversized entry points", () => {
  const documents = new Map([
    ["AGENTS.md", "# Agents\n"],
    ["docs/maintaining-docs.md", "# Docs\n"],
    ["docs/index.md", "[Guidance](maintaining-docs.md)\n[Topic](topic.md)\n"],
    ["docs/topic.md", "[Source](../src/server/app.ts)\n"],
  ]);
  const paths = new Set([...documents.keys(), "src/server/app.ts"]);
  assert.deepEqual(documentationErrors(documents, paths), []);
  documents.set("docs/topic.md", "[Missing](absent.md)\n[Escape](../../secret.md)");
  documents.set("docs/orphan.md", "# Orphan");
  documents.set("AGENTS.md", "line\n".repeat(101));
  const errors = documentationErrors(documents, paths).join("\n");
  assert.match(errors, /missing or nonportable/);
  assert.match(errors, /orphan document/);
  assert.match(errors, /under 100 lines/);
});

test("client adapters must import the canonical policy rather than duplicate it", () => {
  assert.deepEqual(
    adapterErrors(
      new Map([
        ["CLAUDE.md", "@AGENTS.md\n"],
        ["GEMINI.md", "@./AGENTS.md\n"],
      ]),
    ),
    [],
  );
  assert.equal(
    adapterErrors(
      new Map([
        ["CLAUDE.md", "# Separate policy"],
        ["GEMINI.md", "@./other.md"],
      ]),
    ).length,
    2,
  );
});
