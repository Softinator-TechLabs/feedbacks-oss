import {
  trackerConfiguration,
  trackerCredential,
  trackerDiscoveryResult,
  trackerDiscoverySelection,
  type TrackerCredential,
  type TrackerProvider,
  type TrackerDiscoverySelection,
  type TrackerDiscoveryResult,
} from "../../../shared/contracts/domains/trackers.js";
import { TrackerClient, TrackerError, type TrackerTransport } from "./providers.js";

const e = encodeURIComponent;
const PAGE = 50;
const rows = (value: unknown, max = 1000): any[] => {
  if (!Array.isArray(value) || value.length > max)
    throw new TrackerError("TRACKER_INVALID_RESPONSE");
  return value;
};
const identity = (value: unknown) => {
  const id = String(value ?? "");
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(id))
    throw new TrackerError("TRACKER_INVALID_RESPONSE");
  return id;
};
const name = (value: unknown) => {
  if (typeof value !== "string" || !value.trim())
    throw new TrackerError("TRACKER_INVALID_RESPONSE");
  return value.trim().slice(0, 280);
};

/** Read-only discovery. Never follow provider links, cursors as URLs, redirects or HAL URLs. */
export async function discoverTracker(
  provider: TrackerProvider,
  selection: TrackerDiscoverySelection,
  credential: TrackerCredential,
  cursor?: string,
  transport: TrackerTransport = (url, init) => fetch(url, init),
  allowedOrigins: readonly string[] = [],
): Promise<TrackerDiscoveryResult> {
  selection = trackerDiscoverySelection.parse(selection);
  credential = trackerCredential.parse(credential);
  if (provider !== "firmao" && credential.auth === "basic")
    throw new TrackerError("TRACKER_AUTH_INVALID");
  if (provider === "jira" && credential.auth !== "oauth")
    throw new TrackerError("JIRA_OAUTH_REQUIRED");
  if (provider === "trello" && !credential.key)
    throw new TrackerError("TRACKER_API_KEY_AND_BOARD_REQUIRED");
  if (
    provider === "openproject" &&
    (!selection.instanceOrigin || !allowedOrigins.includes(selection.instanceOrigin))
  )
    throw new TrackerError("OPENPROJECT_ORIGIN_NOT_ALLOWED");
  if (provider === "openproject" && credential.auth !== "token")
    throw new TrackerError("OPENPROJECT_API_TOKEN_REQUIRED");
  if (provider === "teamwork" && !selection.site)
    throw new TrackerError("TRACKER_SITE_REQUIRED");
  if (provider === "productive" && !selection.workspaceId)
    throw new TrackerError("TRACKER_WORKSPACE_REQUIRED");
  if (provider === "firmao" && (credential.auth !== "basic" || !credential.username))
    throw new TrackerError("FIRMAO_API_LOGIN_REQUIRED");
  if (provider === "firmao" && !selection.workspaceId)
    throw new TrackerError("FIRMAO_ORGANIZATION_REQUIRED");
  const origins: Record<TrackerProvider, string> = {
    jira: "https://api.atlassian.com",
    linear: "https://api.linear.app",
    asana: "https://app.asana.com",
    clickup: "https://api.clickup.com",
    monday: "https://api.monday.com",
    trello: "https://api.trello.com",
    productive: "https://api.productive.io",
    teamwork: `https://${selection.site}.teamwork.com`,
    firmao: "https://system.firmao.pl",
    openproject: selection.instanceOrigin ?? "",
  };
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
  };
  if (provider === "openproject")
    headers.authorization =
      "Basic " + Buffer.from(`apikey:${credential.token}`).toString("base64");
  else if (provider === "firmao")
    headers.authorization =
      "Basic " +
      Buffer.from(`${credential.username}:${credential.token}`).toString("base64");
  else if (provider === "trello")
    headers.authorization = `OAuth oauth_consumer_key="${e(credential.key!)}", oauth_token="${e(credential.token)}"`;
  else if (provider === "teamwork" && credential.auth === "token")
    headers.authorization =
      "Basic " + Buffer.from(`${credential.token}:x`).toString("base64");
  else if (provider === "productive")
    Object.assign(headers, {
      "content-type": "application/vnd.api+json",
      "X-Auth-Token": credential.token,
      "X-Organization-Id": selection.workspaceId!,
    });
  else
    headers.authorization =
      ["linear", "clickup", "monday"].includes(provider) && credential.auth === "token"
        ? credential.token
        : `Bearer ${credential.token}`;
  if (provider === "monday") headers["API-Version"] = "2026-07";
  const request = async (path: string, body?: unknown): Promise<any> => {
    let response: Response;
    try {
      response = await transport(origins[provider] + path, {
        method: body ? "POST" : "GET",
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new TrackerError("TRACKER_NETWORK");
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new TrackerError(
        response.status === 401 || response.status === 403
          ? "TRACKER_AUTH_REVOKED"
          : response.status === 429
            ? "TRACKER_RATE_LIMIT"
            : "TRACKER_REQUEST_REJECTED",
      );
    }
    // Stop reading as soon as the response limit is crossed rather than buffering an unbounded response.
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (!reader) throw new TrackerError("TRACKER_INVALID_RESPONSE");
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 2_000_000) {
          await reader.cancel();
          throw new TrackerError("TRACKER_RESPONSE_TOO_LARGE");
        }
        chunks.push(chunk.value);
      }
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch (error) {
      if (error instanceof TrackerError) throw error;
      throw new TrackerError("TRACKER_INVALID_RESPONSE");
    } finally {
      reader.releaseLock();
    }
  };
  const graphql = async (query: string, variables: Record<string, unknown> = {}) => {
    const raw = await request(provider === "linear" ? "/graphql" : "/v2", {
      query,
      variables,
    });
    if (raw.errors?.length || !raw.data)
      throw new TrackerError("TRACKER_GRAPHQL_REJECTED");
    return raw.data;
  };
  const page = () => {
    if (cursor !== undefined && !/^[1-9]\d{0,3}$/.test(cursor))
      throw new TrackerError("TRACKER_CURSOR_INVALID");
    return Number(cursor ?? "1");
  };
  const choice = (id: unknown, label: unknown, fragment: TrackerDiscoverySelection) => ({
    id: identity(id),
    name: name(label),
    selection: trackerDiscoverySelection.parse(fragment),
  });
  const result = (
    step: TrackerDiscoveryResult["step"],
    title: string,
    choices: TrackerDiscoveryResult["choices"],
    nextCursor?: string,
  ): TrackerDiscoveryResult =>
    trackerDiscoveryResult.parse({
      step,
      title,
      choices: choices.slice(0, 100),
      states: [],
      hasMore: !!nextCursor || choices.length > 100,
      ...(nextCursor ? { nextCursor } : {}),
    });
  const localResult = (
    step: TrackerDiscoveryResult["step"],
    title: string,
    choices: TrackerDiscoveryResult["choices"],
  ) => {
    const p = page();
    const start = (p - 1) * 100;
    return result(
      step,
      title,
      choices.slice(start, start + 100),
      choices.length > start + 100 ? String(p + 1) : undefined,
    );
  };
  const paged = (
    step: TrackerDiscoveryResult["step"],
    title: string,
    values: any[],
    field: keyof TrackerDiscoverySelection,
    labels = (v: any) => v.name,
  ) =>
    result(
      step,
      title,
      values.map((v) =>
        choice(v.id ?? v.gid, labels(v), { [field]: String(v.id ?? v.gid) }),
      ),
      values.length >= PAGE ? String(page() + 1) : undefined,
    );
  const s = selection;
  let selectedTargetName: string | undefined;
  let descriptionColumnType: "text" | "long_text" | undefined;
  if (provider === "clickup") {
    if (!s.targetId) {
      if (!s.workspaceId)
        return localResult(
          "workspaces",
          "Workspace",
          rows((await request("/api/v2/team")).teams).map((v) =>
            choice(v.id, v.name, { workspaceId: identity(v.id) }),
          ),
        );
      if (!s.spaceId)
        return localResult(
          "spaces",
          "Space",
          rows(
            (await request(`/api/v2/team/${e(s.workspaceId)}/space?archived=false`))
              .spaces,
          ).map((v) => choice(v.id, v.name, { spaceId: identity(v.id) })),
        );
      if (s.folderId)
        return localResult(
          "targets",
          "List",
          rows(
            (await request(`/api/v2/folder/${e(s.folderId)}/list?archived=false`)).lists,
          ).map((v) => choice(v.id, v.name, { targetId: identity(v.id) })),
        );
      const folders = rows(
        (await request(`/api/v2/space/${e(s.spaceId)}/folder?archived=false`)).folders,
      );
      const lists = rows(
        (await request(`/api/v2/space/${e(s.spaceId)}/list?archived=false`)).lists,
      );
      return localResult("folders", "Folder or list", [
        ...folders.map((v) =>
          choice(`folder_${v.id}`, `Folder · ${name(v.name)}`, {
            folderId: identity(v.id),
          }),
        ),
        ...lists.map((v) =>
          choice(`list_${v.id}`, `List · ${name(v.name)}`, { targetId: identity(v.id) }),
        ),
      ]);
    }
  } else if (provider === "monday") {
    if (!s.targetId) {
      const p = page();
      const raw = await graphql(
        "query($page:Int!){boards(limit:50,page:$page,state:active){id name}}",
        { page: p },
      );
      return paged("targets", "Board", rows(raw.boards, PAGE), "targetId");
    }
    const raw = await graphql(
      "query($ids:[ID!]!){boards(ids:$ids){id name columns{id title type settings}}}",
      { ids: [s.targetId] },
    );
    const board = rows(raw.boards, 1)[0];
    if (!board || String(board.id) !== s.targetId)
      throw new TrackerError("TRACKER_TARGET_MISMATCH");
    selectedTargetName = name(board.name);
    const columns = rows(board.columns, 1000);
    if (!s.secondaryId)
      return localResult(
        "columns",
        "Description column",
        columns
          .filter((v) => ["text", "long_text"].includes(v.type))
          .map((v) => choice(v.id, v.title, { secondaryId: identity(v.id) })),
      );
    if (
      !columns.some(
        (v) => String(v.id) === s.secondaryId && ["text", "long_text"].includes(v.type),
      )
    )
      throw new TrackerError("TRACKER_DESCRIPTION_COLUMN_REQUIRED");
    descriptionColumnType = columns.find((v) => String(v.id) === s.secondaryId).type;
    if (!s.statusColumn)
      return localResult(
        "columns",
        "Status column",
        columns
          .filter((v) => v.type === "status")
          .map((v) => choice(v.id, v.title, { statusColumn: identity(v.id) })),
      );
    if (!columns.some((v) => String(v.id) === s.statusColumn && v.type === "status"))
      throw new TrackerError("TRACKER_MAPPING_INVALID");
  } else if (provider === "asana" && !s.targetId) {
    const suffix = cursor ? `&offset=${e(cursor)}` : "";
    const raw = await request(
      s.workspaceId
        ? `/api/1.0/projects?workspace=${e(s.workspaceId)}&archived=false&limit=50&opt_fields=gid,name${suffix}`
        : `/api/1.0/workspaces?limit=50&opt_fields=gid,name${suffix}`,
    );
    const next = raw.next_page?.offset;
    return result(
      s.workspaceId ? "targets" : "workspaces",
      s.workspaceId ? "Project" : "Workspace",
      rows(raw.data, PAGE).map((v) =>
        choice(
          v.gid,
          v.name,
          s.workspaceId
            ? { targetId: identity(v.gid) }
            : { workspaceId: identity(v.gid) },
        ),
      ),
      typeof next === "string" ? next : undefined,
    );
  } else if (provider === "linear" && !s.targetId) {
    const raw = await graphql(
      "query($after:String){teams(first:50,after:$after){nodes{id name} pageInfo{hasNextPage endCursor}}}",
      { after: cursor ?? null },
    );
    return result(
      "targets",
      "Team",
      rows(raw.teams?.nodes, PAGE).map((v) =>
        choice(v.id, v.name, { targetId: identity(v.id) }),
      ),
      raw.teams?.pageInfo?.hasNextPage ? raw.teams.pageInfo.endCursor : undefined,
    );
  } else if (provider === "trello" && !s.targetId) {
    const raw = rows(
      await request(
        s.workspaceId
          ? `/1/boards/${e(s.workspaceId)}/lists?filter=open&fields=id,name`
          : "/1/members/me/boards?filter=open&fields=id,name",
      ),
    );
    return localResult(
      s.workspaceId ? "targets" : "workspaces",
      s.workspaceId ? "List" : "Board",
      raw.map((v) =>
        choice(
          v.id,
          v.name,
          s.workspaceId ? { targetId: identity(v.id) } : { workspaceId: identity(v.id) },
        ),
      ),
    );
  } else if (provider === "teamwork" && !s.targetId) {
    const p = page();
    const raw = await request(
      `/tasklists.json?page=${p}&pageSize=50&status=active&showDeleted=false&includeArchivedProjects=false`,
    );
    return paged("targets", "Task list", rows(raw.tasklists, PAGE), "targetId", (v) =>
      v.projectName ? `${v.projectName} · ${v.name}` : v.name,
    );
  } else if (provider === "firmao" && !s.targetId) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(s.workspaceId!))
      throw new TrackerError("FIRMAO_ORGANIZATION_REQUIRED");
    const p = page();
    const raw = await request(
      `/${e(s.workspaceId!)}/svc/v1/projects?start=${(p - 1) * PAGE}&limit=50&dataFormat=MEDIUM`,
    );
    const projects = rows(raw.data, PAGE);
    return result(
      "targets",
      "Project",
      projects
        .filter(
          (v) =>
            Array.isArray(v.permissions?.task) &&
            v.permissions.task.includes("create") &&
            v.permissions.task.includes("read"),
        )
        .map((v) => choice(v.id, v.name, { targetId: identity(v.id) })),
      projects.length === PAGE ? String(p + 1) : undefined,
    );
  } else if (provider === "openproject") {
    if (!s.targetId) {
      const p = page();
      const raw = await request(`/api/v3/projects?offset=${p}&pageSize=50`);
      const values = rows(raw._embedded?.elements, PAGE);
      return result(
        "targets",
        "Project",
        values.map((v) => choice(v.id, v.name, { targetId: identity(v.id) })),
        Number(raw.total) > p * PAGE ? String(p + 1) : undefined,
      );
    }
    if (!s.issueTypeId) {
      const raw = await request(`/api/v3/projects/${e(s.targetId)}/types`);
      return localResult(
        "issueTypes",
        "Task type",
        rows(raw._embedded?.elements).map((v) =>
          choice(v.id, v.name, { issueTypeId: identity(v.id) }),
        ),
      );
    }
  } else if (provider === "jira") {
    if (!s.cloudId || !s.site) throw new TrackerError("JIRA_OAUTH_REQUIRED");
    const prefix = `/ex/jira/${e(s.cloudId)}/rest/api/3`;
    if (!s.targetId) {
      const p = page();
      const raw = await request(
        `${prefix}/project/search?startAt=${(p - 1) * PAGE}&maxResults=50`,
      );
      return result(
        "targets",
        "Project",
        rows(raw.values, PAGE).map((v) =>
          choice(v.id, v.name, { targetId: identity(v.id) }),
        ),
        raw.isLast === false ? String(p + 1) : undefined,
      );
    }
    if (!s.issueTypeId) {
      const raw = await request(`${prefix}/project/${e(s.targetId)}`);
      return localResult(
        "issueTypes",
        "Issue type",
        rows(raw.issueTypes)
          .filter((v) => !v.subtask)
          .map((v) => choice(v.id, v.name, { issueTypeId: identity(v.id) })),
      );
    }
  } else if (provider === "productive" && !s.targetId) {
    // Organization comes from the account URL; list names are fetched through the documented JSON:API collection.
    const p = page();
    const raw = await request(
      `/api/v2/task_lists?page%5Bsize%5D=50&page%5Bnumber%5D=${p}`,
    );
    return paged(
      "targets",
      "Task list",
      rows(raw.data, PAGE),
      "targetId",
      (v) => v.attributes?.title ?? v.attributes?.name,
    );
  }
  if (!s.targetId) throw new TrackerError("TRACKER_TARGET_REQUIRED");
  const configuration = trackerConfiguration.parse({
    ...s,
    descriptionColumnType,
    states: [],
    poll: false,
  });
  const target = await new TrackerClient(
    provider,
    configuration,
    credential,
    transport,
    allowedOrigins,
  ).target();
  return trackerDiscoveryResult.parse({
    step: "ready",
    title: "Destination",
    choices: [],
    hasMore: false,
    configuration,
    targetName: selectedTargetName ?? name(target.name),
    states: target.states,
  });
}
