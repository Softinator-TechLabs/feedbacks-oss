export function queueObsoleteEvidence(draft, evidenceId) {
  if (!evidenceId) return;
  draft.obsoleteDiagnosticEvidenceIds = [
    ...new Set([...(draft.obsoleteDiagnosticEvidenceIds || []), evidenceId]),
  ];
}

export async function retireObsoleteEvidence(draft, remove, persist) {
  for (const evidenceId of draft.obsoleteDiagnosticEvidenceIds || []) {
    if (evidenceId === draft.diagnosticEvidence?.evidenceId) continue;
    await remove(evidenceId);
    draft.obsoleteDiagnosticEvidenceIds = draft.obsoleteDiagnosticEvidenceIds.filter(
      (id) => id !== evidenceId,
    );
    await persist(draft);
  }
}
