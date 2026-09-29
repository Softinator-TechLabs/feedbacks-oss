import assert from "node:assert/strict";
import { test } from "node:test";
import {
  queueObsoleteEvidence,
  retireObsoleteEvidence,
} from "../extension/diagnostics/cleanup.js";

test("failed replacement cleanup retains a durable ID until deletion succeeds", async () => {
  const draft = {
    diagnosticEvidence: { evidenceId: "new" },
    obsoleteDiagnosticEvidenceIds: [] as string[],
  };
  const saved: string[][] = [];
  queueObsoleteEvidence(draft, "old");
  queueObsoleteEvidence(draft, "old");
  saved.push([...draft.obsoleteDiagnosticEvidenceIds]);
  await assert.rejects(
    retireObsoleteEvidence(
      draft,
      async () => {
        throw Error("IndexedDB transaction aborted");
      },
      async () => saved.push([...draft.obsoleteDiagnosticEvidenceIds]),
    ),
    /aborted/,
  );
  assert.deepEqual(saved.at(-1), ["old"]);
  await retireObsoleteEvidence(
    draft,
    async (id) => assert.equal(id, "old"),
    async () => saved.push([...draft.obsoleteDiagnosticEvidenceIds]),
  );
  assert.deepEqual(saved.at(-1), []);
});

test("unattached failed capture queues its ID without replacing the previous artifact", async () => {
  const draft = { diagnosticEvidence: { evidenceId: "previous" } } as {
    diagnosticEvidence: { evidenceId: string };
    obsoleteDiagnosticEvidenceIds?: string[];
  };
  queueObsoleteEvidence(draft, "unattached");
  await retireObsoleteEvidence(
    draft,
    async (id) => assert.equal(id, "unattached"),
    async () => {},
  );
  assert.equal(draft.diagnosticEvidence.evidenceId, "previous");
  assert.deepEqual(draft.obsoleteDiagnosticEvidenceIds, []);
});
