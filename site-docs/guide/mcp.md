# AI agents and MCP

MCP (Model Context Protocol) is a standard way for an assistant to discover tools from a service. Feedbacks exposes project lists, threads, approved instructions and other authorized operations through one remote MCP endpoint. It does **not** make a discussion comment an instruction for the agent: comments and screenshots remain untrusted evidence.

## Quick setup from Help

1. Sign in to your Feedbacks server and open **Help → Connect a coding agent**.
2. For ordinary project work choose **limited access** in **Account → Connect internal agents** and select project IDs, scopes and expiry. The Help page's **Advanced: owner-level agent access** disclosure can create a full owner-administration key; use that only when the agent truly needs it.
3. Paste the copied setup prompt into the coding agent you trust. It contains a one-time secret; never paste it into a repository, public chat or screenshot.
4. The agent should configure its actual MCP client, reconnect it, list available tools and perform only an allowed read as verification.

Help also shows a non-secret Codex command. Replace the example origin below with your server's exact origin, and supply `FEEDBACKS_TOKEN` privately to the **Codex process**:

```sh
codex mcp add feedbacks \
  --url https://feedback.example.com/mcp \
  --bearer-token-env-var FEEDBACKS_TOKEN
```

`FEEDBACKS_TOKEN` is the scoped key from Account. Do not put its value in this command or shell history. A desktop app launched outside your terminal does not inherit an export from that terminal; use the client's supported secret-backed settings or private launcher. Check your installed client's `codex mcp add --help` before using the command.

Other clients can use authenticated Streamable HTTP at `https://feedback.example.com/mcp` when supported. For a stdio-only client, build the repository's Node adapter and follow the [agent setup guide](https://github.com/Softinator-TechLabs/feedbacks-oss/blob/main/docs/agent-setup.md) for the process environment. Do not assume one client's configuration syntax works in another.

## Why connect an agent?

An agent can inspect the exact page URL, screenshot context, comments, status and approved project guidance before changing code. It can then report a real commit, PR or deployed view back to the thread. A successful MCP connection grants only the scopes on its key; it does not authorize a source change, Issue creation or resolution on its own. Keep external writes separately authorized.

For website reviews, `threads.get` returns ordered `context.annotations`: each note has its own element selector and page position. Each asset includes an ordered filename, the captured page range and normalized `markings` for point pins, pencil strokes, arrows, rectangles and text. Point marks link back to an annotation ID. If there is a `full-page-combined.webp`, its `captureSections` maps retained source page ranges into the merged image, including gaps from removed screenshots. Use `assets.get` on numbered images for readable visual detail; the combined image is a convenient overview and may be scaled down.

For exact operation names, limits and recovery behavior, see the [MCP contract](https://github.com/Softinator-TechLabs/feedbacks-oss/blob/main/docs/mcp-contract.md) and [operation catalog](https://github.com/Softinator-TechLabs/feedbacks-oss/blob/main/docs/generated/operations.md).
