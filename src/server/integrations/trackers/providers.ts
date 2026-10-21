import type {
  TrackerProvider,
  TrackerConfiguration,
  TrackerCredential,
} from "../../../shared/contracts/domains/trackers.js";

export type RemoteIssue = {
  id: string;
  url: string;
  title: string;
  state: string;
  body?: string;
};
export type RemoteTarget = { name: string; states: { id: string; name: string }[] };
export class TrackerError extends Error {
  remoteId?: string;
  constructor(
    public readonly code: string,
    public readonly uncertain = false,
    public readonly retryAfter = 0,
  ) {
    super(code);
  }
}
export type TrackerTransport = (url: string, init: RequestInit) => Promise<Response>;
const boundedFetch: TrackerTransport = (url, init) =>
  fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(15000) });
const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
const adf = (text: string) => ({
  type: "doc",
  version: 1,
  content: text.split("\n").map((line) => ({
    type: "paragraph",
    content: line ? [{ type: "text", text: line }] : [],
  })),
});
const encoded = (value: string) => encodeURIComponent(value);
export const trackerNames: Record<TrackerProvider, string> = {
  jira: "Jira Cloud",
  linear: "Linear",
  asana: "Asana",
  clickup: "ClickUp",
  monday: "monday.com",
  trello: "Trello",
  productive: "Productive",
  teamwork: "Teamwork",
};

/** Credentials only go to fixed provider origins. Account sites are a single validated DNS label. */
export class TrackerClient {
  constructor(
    public provider: TrackerProvider,
    public configuration: TrackerConfiguration,
    private credential: TrackerCredential,
    private transport: TrackerTransport = boundedFetch,
  ) {
    if (
      provider === "jira" &&
      (credential.auth !== "oauth" ||
        !configuration.cloudId ||
        !configuration.site ||
        !configuration.issueTypeId)
    )
      throw new TrackerError("JIRA_OAUTH_REQUIRED");
    if (provider === "teamwork" && !configuration.site)
      throw new TrackerError("TRACKER_SITE_REQUIRED");
    if (provider === "productive" && !configuration.workspaceId)
      throw new TrackerError("TRACKER_WORKSPACE_REQUIRED");
    if (provider === "trello" && (!credential.key || !configuration.workspaceId))
      throw new TrackerError("TRACKER_API_KEY_AND_BOARD_REQUIRED");
    if (provider === "monday" && !configuration.secondaryId)
      throw new TrackerError("TRACKER_DESCRIPTION_COLUMN_REQUIRED");
    if (
      configuration.site &&
      !/^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/.test(configuration.site)
    )
      throw new TrackerError("TRACKER_SITE_INVALID");
  }
  private origin() {
    return {
      jira: "https://api.atlassian.com",
      linear: "https://api.linear.app",
      asana: "https://app.asana.com",
      clickup: "https://api.clickup.com",
      monday: "https://api.monday.com",
      trello: "https://api.trello.com",
      productive: "https://api.productive.io",
      teamwork: `https://${this.configuration.site}.teamwork.com`,
    }[this.provider];
  }
  private async request(path: string, method = "GET", body?: unknown) {
    const url = this.origin() + path;
    const headers: Record<string, string> = {
      accept: "application/json",
      "content-type": "application/json",
    };
    if (this.provider === "productive")
      Object.assign(headers, {
        "content-type": "application/vnd.api+json",
        "X-Auth-Token": this.credential.token,
        "X-Organization-Id": this.configuration.workspaceId!,
      });
    else if (this.provider === "trello")
      headers.authorization = `OAuth oauth_consumer_key="${encoded(this.credential.key!)}", oauth_token="${encoded(this.credential.token)}"`;
    else if (this.provider === "teamwork" && this.credential.auth === "token")
      headers.authorization =
        "Basic " + Buffer.from(this.credential.token + ":x").toString("base64");
    else
      headers.authorization =
        ["linear", "clickup", "monday"].includes(this.provider) &&
        this.credential.auth === "token"
          ? this.credential.token
          : `Bearer ${this.credential.token}`;
    if (this.provider === "monday") headers["API-Version"] = "2026-07";
    let response: Response;
    try {
      response = await this.transport(url, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new TrackerError("TRACKER_NETWORK", method !== "GET");
    }
    if (!response.ok) {
      await response.body?.cancel();
      const code =
        response.status === 401 || response.status === 403
          ? "TRACKER_AUTH_REVOKED"
          : response.status === 429
            ? "TRACKER_RATE_LIMIT"
            : response.status === 404
              ? "TRACKER_NOT_FOUND"
              : response.status >= 500
                ? "TRACKER_UNAVAILABLE"
                : "TRACKER_REQUEST_REJECTED";
      throw new TrackerError(
        code,
        method !== "GET" && response.status >= 500,
        Math.min(3600, Math.max(1, Number(response.headers.get("retry-after")) || 60)),
      );
    }
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > 2_000_000)
      throw new TrackerError("TRACKER_RESPONSE_TOO_LARGE", method !== "GET");
    if (!bytes.byteLength) return {};
    try {
      return JSON.parse(Buffer.from(bytes).toString("utf8"));
    } catch {
      throw new TrackerError("TRACKER_INVALID_RESPONSE", method !== "GET");
    }
  }
  private async graphql(
    query: string,
    variables: Record<string, unknown> = {},
    mutation = false,
  ) {
    const result = await this.request(
      this.provider === "linear" ? "/graphql" : "/v2",
      "POST",
      { query, variables },
    );
    if (result.errors?.length || !result.data)
      throw new TrackerError("TRACKER_GRAPHQL_REJECTED", mutation);
    return result.data;
  }
  private jira(path: string) {
    return `/ex/jira/${encoded(this.configuration.cloudId!)}/rest/api/3${path}`;
  }
  private normalize(raw: any): RemoteIssue {
    const c = this.configuration;
    let result: RemoteIssue;
    switch (this.provider) {
      case "jira":
        result = {
          id: String(raw.id),
          url: `https://${c.site}.atlassian.net/browse/${encoded(raw.key)}`,
          title: raw.fields?.summary ?? raw.key,
          state: String(raw.fields?.status?.id ?? "unknown"),
        };
        break;
      case "linear":
        result = { id: raw.id, url: raw.url, title: raw.title, state: raw.state.id };
        break;
      case "asana":
        result = {
          id: raw.gid,
          url:
            raw.permalink_url ??
            `https://app.asana.com/0/${encoded(c.targetId)}/${encoded(raw.gid)}`,
          title: raw.name,
          state: raw.completed ? "completed" : "open",
        };
        break;
      case "clickup":
        result = {
          id: raw.id,
          url: raw.url ?? `https://app.clickup.com/t/${encoded(raw.id)}`,
          title: raw.name,
          state: raw.status.status,
        };
        break;
      case "monday":
        result = {
          id: raw.id,
          url: raw.url,
          title: raw.name,
          state: String(
            raw.column_values?.find((v: any) => v.id === c.statusColumn)?.text ??
              "unknown",
          ),
        };
        break;
      case "trello":
        result = { id: raw.id, url: raw.url, title: raw.name, state: raw.idList };
        break;
      case "productive":
        result = {
          id: raw.id,
          url: `https://app.productive.io/${encoded(c.workspaceId!)}/tasks/${encoded(raw.id)}`,
          title: raw.attributes.title,
          state: String(raw.relationships?.workflow_status?.data?.id ?? "unknown"),
        };
        break;
      case "teamwork":
        result = {
          id: String(raw.id),
          url: `https://${c.site}.teamwork.com/app/tasks/${encoded(String(raw.id))}`,
          title: raw.content,
          state: raw.completed ? "completed" : "open",
        };
        break;
    }
    if (
      !result.id ||
      !result.url ||
      !result.title ||
      !result.state ||
      result.id === "undefined"
    )
      throw new TrackerError("TRACKER_INVALID_RESPONSE");
    const url = new URL(result.url);
    const hosts = {
      jira: `${c.site}.atlassian.net`,
      linear: "linear.app",
      asana: "app.asana.com",
      clickup: "app.clickup.com",
      monday: "monday.com",
      trello: "trello.com",
      productive: "app.productive.io",
      teamwork: `${c.site}.teamwork.com`,
    };
    const expected = hosts[this.provider];
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !(
        url.hostname === expected ||
        (this.provider === "monday" && url.hostname.endsWith(".monday.com"))
      )
    )
      throw new TrackerError("TRACKER_INVALID_RESPONSE");
    return result;
  }
  async read(id: string): Promise<RemoteIssue> {
    let raw: any;
    const e = encoded(id);
    switch (this.provider) {
      case "jira":
        raw = await this.request(this.jira(`/issue/${e}?fields=summary,status,project`));
        if (
          String(raw.fields?.project?.id) !== this.configuration.targetId &&
          raw.fields?.project?.key !== this.configuration.targetId
        )
          throw new TrackerError("TRACKER_TARGET_MISMATCH");
        break;
      case "linear":
        raw = (
          await this.graphql(
            "query($id:String!){issue(id:$id){id title url state{id} team{id}}}",
            { id },
          )
        ).issue;
        if (raw?.team?.id !== this.configuration.targetId)
          throw new TrackerError("TRACKER_TARGET_MISMATCH");
        break;
      case "asana":
        raw = (
          await this.request(
            `/api/1.0/tasks/${e}?opt_fields=gid,name,completed,permalink_url,projects.gid`,
          )
        ).data;
        if (!raw.projects?.some((p: any) => p.gid === this.configuration.targetId))
          throw new TrackerError("TRACKER_TARGET_MISMATCH");
        break;
      case "clickup":
        raw = await this.request(`/api/v2/task/${e}`);
        if (raw.list?.id !== this.configuration.targetId)
          throw new TrackerError("TRACKER_TARGET_MISMATCH");
        break;
      case "monday":
        raw = (
          await this.graphql(
            "query($ids:[ID!]!){items(ids:$ids){id name url board{id} column_values{ id text }}}",
            { ids: [id] },
          )
        ).items?.[0];
        if (raw?.board?.id !== this.configuration.targetId)
          throw new TrackerError("TRACKER_TARGET_MISMATCH");
        break;
      case "trello":
        raw = await this.request(`/1/cards/${e}?fields=id,name,url,idList,idBoard`);
        if (
          this.configuration.workspaceId &&
          raw.idBoard !== this.configuration.workspaceId
        )
          throw new TrackerError("TRACKER_TARGET_MISMATCH");
        break;
      case "productive":
        raw = (await this.request(`/api/v2/tasks/${e}`)).data;
        if (
          String(raw.relationships?.task_list?.data?.id) !== this.configuration.targetId
        )
          throw new TrackerError("TRACKER_TARGET_MISMATCH");
        break;
      case "teamwork":
        raw = (await this.request(`/tasks/${e}.json`))["todo-item"];
        if (String(raw?.["todo-list-id"]) !== this.configuration.targetId)
          throw new TrackerError("TRACKER_TARGET_MISMATCH");
        break;
    }
    return this.normalize(raw);
  }
  async target(): Promise<RemoteTarget> {
    const c = this.configuration,
      e = encoded(c.targetId);
    switch (this.provider) {
      case "jira": {
        const raw = await this.request(this.jira(`/project/${e}`));
        const types = await this.request(this.jira(`/project/${e}/statuses`));
        return {
          name: raw.name,
          states: (types.find((t: any) => t.id === c.issueTypeId)?.statuses ?? []).map(
            (s: any) => ({ id: s.id, name: s.name }),
          ),
        };
      }
      case "linear": {
        const raw = (
          await this.graphql(
            "query($id:String!){team(id:$id){name states{nodes{id name}}}}",
            { id: c.targetId },
          )
        ).team;
        return { name: raw.name, states: raw.states.nodes };
      }
      case "asana": {
        const raw = (await this.request(`/api/1.0/projects/${e}`)).data;
        return {
          name: raw.name,
          states: [
            { id: "open", name: "Open" },
            { id: "completed", name: "Completed" },
          ],
        };
      }
      case "clickup": {
        const raw = await this.request(`/api/v2/list/${e}`);
        return {
          name: raw.name,
          states: raw.statuses.map((s: any) => ({ id: s.status, name: s.status })),
        };
      }
      case "monday": {
        const raw = (
          await this.graphql(
            "query($ids:[ID!]!){boards(ids:$ids){name columns{id title settings_str}}}",
            { ids: [c.targetId] },
          )
        ).boards[0];
        const column = raw.columns.find((v: any) => v.id === c.statusColumn);
        const labels = JSON.parse(column?.settings_str ?? "{}").labels ?? {};
        return {
          name: raw.name,
          states: Object.values(labels).map((name) => ({
            id: String(name),
            name: String(name),
          })),
        };
      }
      case "trello": {
        const raw = await this.request(`/1/lists/${e}?fields=name,idBoard`);
        if (c.workspaceId && raw.idBoard !== c.workspaceId)
          throw new TrackerError("TRACKER_TARGET_MISMATCH");
        const lists = await this.request(
          `/1/boards/${encoded(raw.idBoard)}/lists?fields=id,name`,
        );
        return { name: raw.name, states: lists };
      }
      case "productive": {
        const raw = (await this.request(`/api/v2/task_lists/${e}`)).data;
        const states = (await this.request("/api/v2/workflow_statuses?page[size]=100"))
          .data;
        return {
          name: raw.attributes.title ?? raw.attributes.name ?? c.targetId,
          states: states.map((v: any) => ({ id: v.id, name: v.attributes.name })),
        };
      }
      case "teamwork": {
        const raw = (await this.request(`/tasklists/${e}.json`))["todo-list"];
        return {
          name: raw.name,
          states: [
            { id: "open", name: "Open" },
            { id: "completed", name: "Completed" },
          ],
        };
      }
    }
  }
  async create(title: string, body: string): Promise<RemoteIssue> {
    const c = this.configuration;
    let id: string;
    switch (this.provider) {
      case "jira":
        id = (
          await this.request(this.jira("/issue"), "POST", {
            fields: {
              project: /^\d+$/.test(c.targetId)
                ? { id: c.targetId }
                : { key: c.targetId },
              issuetype: { id: c.issueTypeId },
              summary: title,
              description: adf(body),
            },
          })
        ).id;
        break;
      case "linear": {
        const raw = (
          await this.graphql(
            "mutation($input:IssueCreateInput!){issueCreate(input:$input){success issue{id}}}",
            { input: { teamId: c.targetId, title, description: body } },
            true,
          )
        ).issueCreate;
        if (!raw.success) throw new TrackerError("TRACKER_REQUEST_REJECTED");
        id = raw.issue.id;
        break;
      }
      case "asana":
        id = (
          await this.request("/api/1.0/tasks", "POST", {
            data: { name: title, notes: body, projects: [c.targetId] },
          })
        ).data.gid;
        break;
      case "clickup":
        id = (
          await this.request(`/api/v2/list/${encoded(c.targetId)}/task`, "POST", {
            name: title,
            markdown_description: body,
          })
        ).id;
        break;
      case "monday": {
        const data = (
          await this.graphql(
            "mutation($board:ID!,$name:String!,$values:JSON){create_item(board_id:$board,item_name:$name,column_values:$values){id}}",
            {
              board: c.targetId,
              name: title,
              values: c.secondaryId ? JSON.stringify({ [c.secondaryId]: body }) : "{}",
            },
            true,
          )
        ).create_item;
        id = data.id;
        break;
      }
      case "trello":
        id = (
          await this.request("/1/cards", "POST", {
            idList: c.targetId,
            name: title,
            desc: body,
          })
        ).id;
        break;
      case "productive":
        id = (
          await this.request("/api/v2/tasks", "POST", {
            data: {
              type: "tasks",
              attributes: { title, description: escapeHtml(body).replace(/\n/g, "<br>") },
              relationships: {
                task_list: { data: { type: "task_lists", id: c.targetId } },
              },
            },
          })
        ).data.id;
        break;
      case "teamwork":
        id = String(
          (
            await this.request(`/tasklists/${encoded(c.targetId)}/tasks.json`, "POST", {
              "todo-item": { content: title, description: body },
            })
          ).id,
        );
        break;
    }
    try {
      return await this.read(id);
    } catch {
      const error = new TrackerError("TRACKER_CREATED_READBACK_FAILED", true);
      error.remoteId = id;
      throw error;
    }
  }
  async comment(id: string, body: string) {
    const e = encoded(id);
    switch (this.provider) {
      case "jira":
        await this.request(this.jira(`/issue/${e}/comment`), "POST", { body: adf(body) });
        break;
      case "linear": {
        const r = (
          await this.graphql(
            "mutation($input:CommentCreateInput!){commentCreate(input:$input){success}}",
            { input: { issueId: id, body } },
            true,
          )
        ).commentCreate;
        if (!r.success) throw new TrackerError("TRACKER_REQUEST_REJECTED");
        break;
      }
      case "asana":
        await this.request(`/api/1.0/tasks/${e}/stories`, "POST", {
          data: { text: body },
        });
        break;
      case "clickup":
        await this.request(`/api/v2/task/${e}/comment`, "POST", {
          comment_text: body,
          notify_all: false,
        });
        break;
      case "monday":
        await this.graphql(
          "mutation($id:ID!,$body:String!){create_update(item_id:$id,body:$body){id}}",
          { id, body: escapeHtml(body).replace(/\n/g, "<br>") },
          true,
        );
        break;
      case "trello":
        await this.request(`/1/cards/${e}/actions/comments`, "POST", { text: body });
        break;
      case "productive":
        await this.request("/api/v2/comments", "POST", {
          data: {
            type: "comments",
            attributes: { body: escapeHtml(body).replace(/\n/g, "<br>") },
            relationships: { task: { data: { type: "tasks", id } } },
          },
        });
        break;
      case "teamwork":
        await this.request(`/tasks/${e}/comments.json`, "POST", {
          comment: { body, notify: "" },
        });
        break;
    }
  }
  async comments(id: string) {
    const e = encoded(id);
    let rows: any[],
      hasMore = false;
    const adfText = (node: any, depth = 0): string =>
      depth > 10
        ? ""
        : typeof node?.text === "string"
          ? node.text
          : Array.isArray(node?.content)
            ? node.content
                .slice(0, 500)
                .map((n: any) => adfText(n, depth + 1))
                .join(node.type === "doc" ? "\n" : "")
            : "";
    switch (this.provider) {
      case "jira": {
        const result = await this.request(
          this.jira(`/issue/${e}/comment?maxResults=50&orderBy=-created`),
        );
        rows = result.comments.map((r: any) => ({
          id: r.id,
          body: adfText(r.body),
          author: r.author?.displayName ?? null,
          createdAt: r.created ?? null,
        }));
        hasMore = result.total > result.comments.length;
        break;
      }
      case "linear": {
        const result = (
          await this.graphql(
            "query($id:String!){issue(id:$id){comments(first:50){nodes{id body createdAt user{name}} pageInfo{hasNextPage}}}}",
            { id },
          )
        ).issue.comments;
        rows = result.nodes.map((r: any) => ({
          id: r.id,
          body: r.body,
          author: r.user?.name ?? null,
          createdAt: r.createdAt ?? null,
        }));
        hasMore = !!result.pageInfo.hasNextPage;
        break;
      }
      case "asana": {
        const result = await this.request(
          `/api/1.0/tasks/${e}/stories?limit=50&opt_fields=gid,text,created_at,resource_subtype,created_by.name`,
        );
        rows = result.data
          .filter((r: any) => r.resource_subtype === "comment_added")
          .map((r: any) => ({
            id: r.gid,
            body: r.text,
            author: r.created_by?.name ?? null,
            createdAt: r.created_at ?? null,
          }));
        hasMore = !!result.next_page;
        break;
      }
      case "clickup": {
        const result = await this.request(`/api/v2/task/${e}/comment`);
        rows = result.comments.map((r: any) => ({
          id: String(r.id),
          body: r.comment_text ?? "",
          author: r.user?.username ?? null,
          createdAt: r.date ? new Date(Number(r.date)).toISOString() : null,
        }));
        hasMore = rows.length >= 25;
        break;
      }
      case "monday": {
        const result = (
          await this.graphql(
            "query($ids:[ID!]!){items(ids:$ids){updates(limit:50){id text_body created_at creator{name}}}}",
            { ids: [id] },
          )
        ).items[0].updates;
        rows = result.map((r: any) => ({
          id: r.id,
          body: r.text_body,
          author: r.creator?.name ?? null,
          createdAt: r.created_at ?? null,
        }));
        hasMore = rows.length >= 50;
        break;
      }
      case "trello": {
        const result = await this.request(
          `/1/cards/${e}/actions?filter=commentCard&limit=50`,
        );
        rows = result.map((r: any) => ({
          id: r.id,
          body: r.data.text,
          author: r.memberCreator?.fullName ?? null,
          createdAt: r.date ?? null,
        }));
        hasMore = rows.length >= 50;
        break;
      }
      case "productive": {
        const result = await this.request(
          `/api/v2/comments?filter[task_id]=${e}&page[size]=50`,
        );
        rows = result.data.map((r: any) => ({
          id: r.id,
          body: r.attributes.body,
          author: null,
          createdAt: r.attributes.created_at ?? null,
        }));
        hasMore = !!result.links?.next;
        break;
      }
      case "teamwork": {
        const result = await this.request(`/tasks/${e}/comments.json?pageSize=50`);
        rows = result.comments.map((r: any) => ({
          id: String(r.id),
          body: r.body,
          author: r["author-fullname"] ?? null,
          createdAt: r.datetime ?? null,
        }));
        hasMore = rows.length >= 50;
        break;
      }
    }
    return {
      items: rows.slice(0, 50).map((row) => ({
        ...row,
        body: String(row.body ?? "").slice(0, 12000),
        author: row.author ? String(row.author).slice(0, 120) : null,
      })),
      hasMore,
    };
  }
  async setState(id: string, state: string, transition?: string) {
    const c = this.configuration,
      e = encoded(id);
    switch (this.provider) {
      case "jira":
        if (!transition) throw new TrackerError("JIRA_TRANSITION_REQUIRED");
        await this.request(this.jira(`/issue/${e}/transitions`), "POST", {
          transition: { id: transition },
        });
        break;
      case "linear": {
        const r = (
          await this.graphql(
            "mutation($id:String!,$input:IssueUpdateInput!){issueUpdate(id:$id,input:$input){success}}",
            { id, input: { stateId: state } },
            true,
          )
        ).issueUpdate;
        if (!r.success) throw new TrackerError("TRACKER_REQUEST_REJECTED");
        break;
      }
      case "asana":
        if (!["open", "completed"].includes(state))
          throw new TrackerError("TRACKER_STATE_INVALID");
        await this.request(`/api/1.0/tasks/${e}`, "PUT", {
          data: { completed: state === "completed" },
        });
        break;
      case "clickup":
        await this.request(`/api/v2/task/${e}`, "PUT", { status: state });
        break;
      case "monday":
        await this.graphql(
          "mutation($board:ID!,$id:ID!,$column:String!,$value:JSON!){change_column_value(board_id:$board,item_id:$id,column_id:$column,value:$value){id}}",
          {
            board: c.targetId,
            id,
            column: c.statusColumn,
            value: JSON.stringify({ label: state }),
          },
          true,
        );
        break;
      case "trello":
        await this.request(`/1/cards/${e}`, "PUT", { idList: state });
        break;
      case "productive":
        await this.request(`/api/v2/tasks/${e}`, "PATCH", {
          data: {
            id,
            type: "tasks",
            relationships: {
              workflow_status: { data: { type: "workflow_statuses", id: state } },
            },
          },
        });
        break;
      case "teamwork":
        if (!["open", "completed"].includes(state))
          throw new TrackerError("TRACKER_STATE_INVALID");
        await this.request(
          `/tasks/${e}/${state === "completed" ? "complete" : "uncomplete"}.json`,
          "PUT",
        );
        break;
    }
  }
}
