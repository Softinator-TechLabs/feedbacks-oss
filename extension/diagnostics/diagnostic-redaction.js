export function redactDiagnosticSelection(message, start, end) {
  if (
    typeof message !== "string" ||
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end > message.length ||
    end <= start ||
    end - start > 400
  )
    throw Error("Select the text to mask in this diagnostic message.");
  return (message.slice(0, start) + "[redacted]" + message.slice(end)).slice(0, 400);
}

export function maskDraftDiagnostic(draft, message) {
  if (!draft || draft.id !== message.id || draft.frozen || !draft.diagnostics)
    throw Error("This diagnostic draft is no longer editable.");
  if (
    !Number.isSafeInteger(message.index) ||
    message.index < 0 ||
    message.index >= draft.diagnostics.console.length
  )
    throw Error("Choose a valid console entry.");
  return {
    ...draft,
    diagnostics: {
      ...draft.diagnostics,
      console: draft.diagnostics.console.map((entry, index) =>
        index === message.index
          ? {
              ...entry,
              message: redactDiagnosticSelection(
                entry.message,
                message.start,
                message.end,
              ),
            }
          : entry,
      ),
    },
  };
}
