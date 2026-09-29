import type { z } from "zod";
import type { Delegation, inputSchemas } from "../../shared/contracts.js";

export type DelegationPage = {
  items: Delegation[];
  total: number;
  nextOffset: number | null;
};
export type HistoryPage = {
  items: Array<{
    id: string;
    delegationId: string;
    action: "assigned" | "reassigned" | "cancelled";
    revision: number;
    actor: Delegation["updatedBy"];
    reason: string;
    assignment: Delegation;
    createdAt: string;
  }>;
  total: number;
  nextOffset: number | null;
};
export type ClaimPage = {
  items: Array<{
    id: string;
    memberName: string;
    agentName: string;
    annotationIds: string[];
    expiresAt: string;
  }>;
  total: number;
  nextOffset: number | null;
};
export type AssignInput = Omit<
  z.input<(typeof inputSchemas)["assignments.assign"]>,
  "idempotencyKey"
>;
export const decisions = {
  undecided: "Undecided",
  create_issue: "Create GitHub issue",
  not_needed: "GitHub issue not needed",
  already_linked: "GitHub issue already linked",
} as const;
