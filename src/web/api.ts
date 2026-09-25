import type { z } from "zod";
import type { inputSchemas, OperationName } from "../shared/contracts.js";
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 0,
  ) {
    super(message);
  }
}
let csrf = "";
const sessionChannel =
  typeof window !== "undefined" && typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel("feedbacks-session")
    : undefined;
sessionChannel?.addEventListener("message", (event) => {
  if (event.data?.kind === "csrf" && typeof event.data.value === "string")
    csrf = event.data.value;
  if (event.data?.kind === "account-change")
    window.dispatchEvent(
      new CustomEvent("feedbacks:account-change", {
        detail: { userId: event.data.userId },
      }),
    );
});
let renewal: Promise<unknown> | undefined;
const publicOperations = new Set([
  "auth.login",
  "auth.acceptInvite",
  "auth.resetPassword",
  "auth.consumeLoginLink",
  "auth.me",
  "guest.inspect",
  "guest.reply",
  "guestProject.inspect",
  "guestProject.submit",
  "survey.inspect",
  "survey.submit",
]);
async function request<T>(operation: OperationName, input: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/${operation}`, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        ...(csrf ? { "X-CSRF-Token": csrf } : {}),
      },
      body: JSON.stringify(input),
    });
  } catch {
    throw new ApiError(
      "NETWORK",
      "Connection failed. Your draft is still here; try again.",
    );
  }
  let payload: any;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError(
      "INVALID_RESPONSE",
      "The server returned an unexpected response. Try again.",
      response.status,
    );
  }
  if (!response.ok || payload.ok !== true)
    throw new ApiError(
      payload.error?.code ?? "REQUEST_FAILED",
      payload.error?.message ?? "Request failed",
      response.status,
    );
  if (payload.data?.csrf) {
    csrf = payload.data.csrf;
    sessionChannel?.postMessage({ kind: "csrf", value: csrf });
  }
  if (
    [
      "auth.login",
      "auth.consumeLoginLink",
      "auth.logout",
      "auth.changePassword",
      "auth.resetPassword",
    ].includes(operation)
  )
    sessionChannel?.postMessage({
      kind: "account-change",
      userId: ["auth.login", "auth.consumeLoginLink"].includes(operation)
        ? payload.data.actor.userId
        : null,
    });
  return payload.data as T;
}
export async function api<T = any, N extends OperationName = OperationName>(
  operation: N,
  input: z.input<(typeof inputSchemas)[N]> = {} as z.input<(typeof inputSchemas)[N]>,
): Promise<T> {
  // Serialize cookie operations across tabs so auth.me cannot rotate another
  // tab's CSRF between its renewal and retry. Browsers without Web Locks still
  // recover a stale token once via the rejection-before-execution path.
  const execute = () => authenticatedRequest<T>(operation, input);
  return typeof navigator !== "undefined" && navigator.locks
    ? navigator.locks.request("feedbacks-session-request", execute)
    : execute();
}
async function authenticatedRequest<T>(
  operation: OperationName,
  input: unknown,
): Promise<T> {
  try {
    return await request<T>(operation, input);
  } catch (error) {
    // CSRF rejection happens before execution. Retry the identical operation once after renewal.
    if (
      error instanceof ApiError &&
      error.code === "CSRF" &&
      !publicOperations.has(operation)
    ) {
      renewal ??= request("auth.me", {}).finally(() => {
        renewal = undefined;
      });
      await renewal;
      return request<T>(operation, input);
    }
    throw error;
  }
}
export function errorText(error: unknown) {
  return error instanceof ApiError
    ? `${error.message} (${error.code})`
    : error instanceof Error
      ? error.message
      : "Request failed. Try again.";
}
export const uid = () => crypto.randomUUID();
export type Actor = {
  id: string;
  userId: string;
  name: string;
  kind: string;
  owner?: boolean;
  primaryOwner?: boolean;
  mustChangePassword?: boolean;
};
export type Project = {
  id: string;
  name: string;
  origins: string[];
  captureMode?: "origins" | "any";
  repositoryUrl: string | null;
  githubConnected?: boolean;
  githubStatusSync?: boolean;
  reviewEnabled?: boolean;
  revision: number;
  permissions: {
    role: string;
    canWrite: boolean;
    canMaintain: boolean;
    canResolve: boolean;
  };
};
export type Context = {
  url: string;
  origin?: string;
  hostname?: string;
  domain?: string;
  subdomain?: string | null;
  port?: string | null;
  title?: string;
  viewport: { width: number; height: number };
  deviceClass?: string;
  devicePixelRatio?: number;
  preset?: string;
  requestedSize?: { width: number; height: number };
  captureDimensions?: { width: number; height: number };
  scroll?: { x: number; y: number };
  capturedAt?: string;
  document?: {
    id: string;
    name: string;
    kind: "pdf" | "image";
    page: number;
    x: number;
    y: number;
  };
  anchor?: {
    selector?: string;
    confidence?: string;
    recordIdentity?: string;
    fingerprint?: string;
    styles?: Record<string, string>;
  };
};
export type ReviewDocument = {
  id: string;
  projectId: string;
  name: string;
  kind: "pdf" | "image";
  contentType: "application/pdf" | "image/webp";
  pageCount: number;
  pages?: Array<{ width: number; height: number }>;
  width?: number;
  height?: number;
  bytes: number;
  createdAt: string;
  url: string;
};
export type Thread = {
  id: string;
  projectId: string;
  body: string;
  likes: { uniqueLikes: number; liked: boolean };
  category: string;
  tags?: string[];
  diagnostics?: import("../shared/diagnostics.js").Diagnostics;
  revision: number;
  context: Context;
  author: Actor;
  response: { state: string };
  work: {
    state: string;
    duplicateOf?: string | null;
    history: Array<{
      state?: string;
      note?: string;
      actor?: Actor;
      at?: string;
    }>;
  };
  review: {
    round: number;
    state: "open" | "approved" | "changes_requested";
    history: Array<{
      round: number;
      decision: string;
      note: string;
      actor: Actor;
      at: string;
    }>;
  };
  externalIssues: Array<{
    url: string;
    verification: string;
    state?: "open" | "closed";
    linkedBy?: Actor;
    linkedAt?: string;
  }>;
  fixEvidence: Array<{
    url: string;
    note: string;
    kind: string;
    actor?: Actor;
    createdAt?: string;
  }>;
  replies: Array<{
    likes: { uniqueLikes: number; liked: boolean };
    intent?: "request" | "response";
    id: string;
    body: string;
    author: Actor;
    createdAt: string;
  }>;
  assets: Array<{
    id: string;
    url: string;
    width?: number;
    height?: number;
    rendition: string;
    contentType: "image/webp" | "video/webm";
    durationMs?: number;
  }>;
  view: {
    uniqueLikes: number;
    liked: boolean;
    discussionCount: number;
    weightedPreference?: number;
  };
  archived: boolean;
  lastActor: Actor;
  createdAt: string;
  updatedAt: string;
};
export const labels: Record<string, string> = {
  open: "Open",
  in_progress: "In progress",
  ready_for_review: "Ready for review",
  resolved: "Resolved",
  declined: "Declined",
  unanswered: "Unanswered",
  responded: "Responded",
  "needs-follow-up": "Needs follow-up",
  general: "General",
  visualDesign: "Visual design",
  productWorkflow: "Product workflow",
  usabilityAccessibility: "Usability & accessibility",
};
const fullTimeFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});
const shortDateFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "short",
});
const ordinal = (day: number) =>
  day % 100 >= 11 && day % 100 <= 13
    ? "th"
    : (["th", "st", "nd", "rd"][day % 10] ?? "th");

export const date = (s: string) => {
  const value = new Date(s);
  if (Number.isNaN(value.getTime())) return "Invalid date";
  const parts = Object.fromEntries(
    fullTimeFormat.formatToParts(value).map((part) => [part.type, part.value]),
  );
  const day = Number(parts.day);
  return `${day}${ordinal(day)} ${parts.month} ${parts.year}, ${parts.hour}:${parts.minute} ${parts.dayPeriod} IST`;
};

export const relativeDate = (s: string, now = Date.now()) => {
  const value = new Date(s);
  if (Number.isNaN(value.getTime())) return "Invalid date";
  const future = value.getTime() > now;
  const elapsed = Math.abs(value.getTime() - now);
  if (elapsed < 60_000) return future ? "in a moment" : "just now";
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60)
    return future
      ? `in ${minutes} ${minutes === 1 ? "min" : "mins"}`
      : `${minutes} ${minutes === 1 ? "min" : "mins"} ago`;
  const hours = Math.floor(elapsed / 3_600_000);
  if (hours < 24)
    return future
      ? `in ${hours} ${hours === 1 ? "hour" : "hours"}`
      : `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(elapsed / 86_400_000);
  if (days < 7)
    return future
      ? `in ${days} ${days === 1 ? "day" : "days"}`
      : `${days} ${days === 1 ? "day" : "days"} ago`;
  if (days < 365) {
    const parts = Object.fromEntries(
      shortDateFormat.formatToParts(value).map((part) => [part.type, part.value]),
    );
    const day = Number(parts.day);
    return `${day}${ordinal(day)} ${parts.month === "Sep" ? "Sept" : parts.month}`;
  }
  if (days < 730) return future ? "next year" : "last year";
  const years = Math.floor(days / 365);
  return future ? `in ${years} years` : `${years} years ago`;
};
