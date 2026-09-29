import type { Thread } from "../api.js";

export type Assignee = {
  id: string;
  name: string;
  active: boolean;
  owner: boolean;
  role?: string | null;
  removedAt?: string | null;
};
export function writableAssignees(members: Assignee[]) {
  return members.filter(
    (member) =>
      member.active &&
      !member.removedAt &&
      (member.owner || member.role === "maintainer" || member.role === "reviewer"),
  );
}
export function assignmentPoints(thread: Thread) {
  if (thread.archived || ["resolved", "declined"].includes(thread.work.state)) return [];
  return (thread.context.annotations ?? []).flatMap((point, index) =>
    (thread.annotationStates?.[point.id]?.state ?? "open") === "open"
      ? [{ id: point.id, body: point.body, number: index + 1 }]
      : [],
  );
}
export function canAssignThread(thread: Thread) {
  return (
    !thread.archived &&
    !["resolved", "declined"].includes(thread.work.state) &&
    (!thread.context.annotations?.length || assignmentPoints(thread).length > 0)
  );
}

export function assignmentScope(ids: string[], thread: Thread) {
  if (!ids.length) return "Whole thread";
  const numbers = ids.map((id) => {
    const index = thread.context.annotations?.findIndex((point) => point.id === id) ?? -1;
    return index < 0 ? "Unavailable point" : String(index + 1);
  });
  if (numbers.length === 1 && numbers[0] === "Unavailable point") return numbers[0];
  return `${numbers.length === 1 ? "Point" : "Points"} ${numbers.join(", ")}`;
}
export function assignmentActor(actor: { memberName: string; agentName: string | null }) {
  return `${actor.memberName}${actor.agentName ? ` via ${actor.agentName}` : ""}`;
}
export function assignmentRetry<T extends object>(
  previous: { signature: string; input: T & { idempotencyKey: string } } | undefined,
  input: T,
  key: () => string,
) {
  const signature = JSON.stringify(input);
  return previous?.signature === signature
    ? previous
    : { signature, input: { ...input, idempotencyKey: key() } };
}
