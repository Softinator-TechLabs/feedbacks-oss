import {
  trackerConfiguration,
  trackerDiscoveryResult,
  type TrackerCredential,
  type TrackerDiscoveryResult,
} from "../../../shared/contracts/domains/trackers.js";
import { fail } from "../../errors.js";

const PAGE = 50;
const MAX_PAGES = 10;
const safeId = (value: unknown) => {
  const id = String(value ?? "");
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(id))
    fail("TRACKER_INVALID_RESPONSE", "Jira returned an invalid destination", 502);
  return id;
};
const safeName = (value: unknown) => {
  if (typeof value !== "string" || !value.trim())
    fail("TRACKER_INVALID_RESPONSE", "Jira returned an unnamed destination", 502);
  return (value as string).trim().slice(0, 200);
};
const collection = (value: unknown) => {
  if (!Array.isArray(value) || value.length > PAGE)
    fail("TRACKER_INVALID_RESPONSE", "Jira returned an invalid page", 502);
  return value as any[];
};

/** Read create metadata under the consented site only. No issue is created during setup. */
export async function discoverConsentedJira(
  resource: { id: string; name: string; url: string },
  credential: TrackerCredential,
  selection: { targetId?: string; issueTypeId?: string },
  cursor: string | undefined,
  checkAccess: () => Promise<unknown>,
): Promise<TrackerDiscoveryResult> {
  const prefix = `https://api.atlassian.com/ex/jira/${encodeURIComponent(resource.id)}/rest/api/3`;
  const get = async (path: string) => {
    await checkAccess();
    let response: Response;
    try {
      response = await fetch(prefix + path, {
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${credential.token}`,
        },
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      fail("TRACKER_NETWORK", "Jira could not be reached. Try again.", 502);
    }
    if (!response!.ok) {
      await response!.body?.cancel();
      if (response!.status === 429)
        fail(
          "TRACKER_RATE_LIMIT",
          "Jira is receiving too many requests. Wait a moment and try again.",
          429,
        );
      fail(
        response!.status === 401 || response!.status === 403
          ? "TRACKER_AUTH_REVOKED"
          : "TRACKER_REQUEST_REJECTED",
        "Jira did not allow this destination. Check account permissions.",
        400,
      );
    }
    const reader = response!.body?.getReader();
    if (!reader) fail("TRACKER_INVALID_RESPONSE", "Jira returned an empty response", 502);
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const chunk = await reader!.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 2_000_000) {
          await reader!.cancel();
          fail("TRACKER_RESPONSE_TOO_LARGE", "Jira returned too much metadata", 502);
        }
        chunks.push(chunk.value);
      }
    } catch (error) {
      if ((error as any)?.code === "TRACKER_RESPONSE_TOO_LARGE") throw error;
      fail("TRACKER_NETWORK", "Jira metadata could not be read. Try again.", 502);
    } finally {
      reader!.releaseLock();
    }
    await checkAccess();
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      fail("TRACKER_INVALID_RESPONSE", "Jira returned invalid metadata", 502);
    }
  };
  const readPage = async (path: string, start: number, property: string) => {
    const raw = await get(`${path}?startAt=${start}&maxResults=${PAGE}`);
    const values = collection(raw[property]);
    if (
      !Number.isSafeInteger(raw.startAt) ||
      raw.startAt !== start ||
      !Number.isSafeInteger(raw.total) ||
      raw.total < start + values.length ||
      !Number.isSafeInteger(raw.maxResults) ||
      raw.maxResults < 1 ||
      raw.maxResults < values.length ||
      raw.maxResults > PAGE ||
      (raw.total > start && !values.length)
    )
      fail("TRACKER_INVALID_RESPONSE", "Jira returned inconsistent pagination", 502);
    return {
      values,
      next: start + raw.maxResults < raw.total ? start + raw.maxResults : undefined,
    };
  };
  const choices = (
    step: "targets" | "issueTypes",
    title: string,
    values: any[],
    field: "targetId" | "issueTypeId",
    next?: number,
  ) =>
    trackerDiscoveryResult.parse({
      step,
      title,
      choices: values.map((value) => ({
        id: safeId(value.id),
        name: safeName(value.name),
        selection: { [field]: safeId(value.id) },
      })),
      states: [],
      hasMore: next !== undefined,
      ...(next !== undefined ? { nextCursor: String(next) } : {}),
    });
  const start = cursor === undefined ? 0 : Number(cursor);
  if (!Number.isSafeInteger(start) || start < 0 || start > 999999)
    fail("TRACKER_CURSOR_INVALID", "Choose the destination again", 400);
  if (!selection.targetId) {
    const page = await readPage("/project/search", start, "values");
    return choices("targets", "Project", page.values, "targetId", page.next);
  }
  const projectId = safeId(selection.targetId),
    path = `/issue/createmeta/${encodeURIComponent(projectId)}/issuetypes`;
  if (!selection.issueTypeId) {
    const page = await readPage(path, start, "issueTypes");
    return choices(
      "issueTypes",
      "Issue type",
      page.values.filter((v) => v.subtask === false),
      "issueTypeId",
      page.next,
    );
  }
  const typeId = safeId(selection.issueTypeId);
  let found: any,
    position: number | undefined = 0;
  for (let page = 0; position !== undefined && page < MAX_PAGES; page++) {
    const result = await readPage(path, position, "issueTypes");
    found =
      result.values.find((v) => String(v.id) === typeId && v.subtask === false) ?? found;
    if (found) break;
    position = result.next;
  }
  if (!found) {
    if (position !== undefined)
      fail(
        "JIRA_METADATA_LIMIT",
        "This project has too many issue types to verify. Use a smaller project or manual setup.",
        400,
      );
    fail(
      "JIRA_ISSUE_TYPE_UNAVAILABLE",
      "Choose an issue type that this account can create. Subtasks require a parent and are not supported here.",
      400,
    );
  }
  position = 0;
  const suppliedFields = new Set(["project", "issuetype", "summary", "description"]);
  const allowedFields = new Set<string>();
  for (let page = 0; position !== undefined && page < MAX_PAGES; page++) {
    const result = await readPage(
      `${path}/${encodeURIComponent(typeId)}`,
      position,
      "fields",
    );
    for (const field of result.values) {
      const key = String(field.fieldId ?? field.key ?? "");
      if (typeof field.required !== "boolean" || !key)
        fail(
          "TRACKER_INVALID_RESPONSE",
          "Jira returned invalid required-field metadata",
          502,
        );
      if (suppliedFields.has(key)) {
        if (Array.isArray(field.operations) && !field.operations.includes("set"))
          fail(
            "JIRA_FIELDS_UNAVAILABLE",
            "Allow Project, Issue type, Summary and Description on this issue type's create screen before connecting.",
            400,
          );
        allowedFields.add(key);
      }
      if (field.required && field.hasDefaultValue !== true && !suppliedFields.has(key))
        fail(
          "JIRA_REQUIRED_FIELDS_UNSUPPORTED",
          "This issue type requires extra fields. Choose a type with defaults for those fields, or configure those defaults in Jira.",
          400,
        );
    }
    position = result.next;
  }
  if (position !== undefined)
    fail(
      "JIRA_METADATA_LIMIT",
      "This issue type has too many fields to verify. Choose another issue type.",
      400,
    );
  if ([...suppliedFields].some((field) => !allowedFields.has(field)))
    fail(
      "JIRA_FIELDS_UNAVAILABLE",
      "Allow Project, Issue type, Summary and Description on this issue type's create screen before connecting.",
      400,
    );
  const project = await get(`/project/${encodeURIComponent(projectId)}`);
  if (String(project.id) !== projectId && project.key !== projectId)
    fail("TRACKER_TARGET_MISMATCH", "Jira returned another project", 400);
  const statusTypes = await get(`/project/${encodeURIComponent(projectId)}/statuses`);
  if (!Array.isArray(statusTypes) || statusTypes.length > 1000)
    fail("TRACKER_INVALID_RESPONSE", "Jira returned invalid statuses", 502);
  const type = statusTypes.find((value: any) => String(value.id) === typeId);
  if (!type || !Array.isArray(type.statuses) || type.statuses.length > 1000)
    fail(
      "JIRA_ISSUE_TYPE_UNAVAILABLE",
      "This issue type no longer belongs to the selected project",
      400,
    );
  const states = type.statuses.map((value: any) => ({
    id: safeId(value.id),
    name: safeName(value.name),
  }));
  const configuration = trackerConfiguration.parse({
    targetId: projectId,
    issueTypeId: typeId,
    cloudId: resource.id,
    site: new URL(resource.url).hostname.slice(0, -".atlassian.net".length),
  });
  return trackerDiscoveryResult.parse({
    step: "ready",
    title: "Destination",
    choices: [],
    hasMore: false,
    configuration,
    targetName: safeName(project.name),
    states,
  });
}
