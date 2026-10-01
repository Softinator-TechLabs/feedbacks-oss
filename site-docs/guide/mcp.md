---
description: Connect your personal coding agent, verify project access and choose one task to fix.
---

# Connect your agent. Pick a fix.

Sign in to your team's Feedbacks server as yourself. Each developer connects their own agent with their own key.

<DocPath :steps="['Copy prompt', 'Keep key local', 'Verify access', 'Choose a task']" />

## Connect in Setup

1. Under **Keep key local**, choose **Create & copy prompt**. Check the displayed permissions.
2. Paste the key-free prompt into Codex, Claude Code or Antigravity. Let the agent prepare the local command for your client and OS.
3. Return to **Copy key**, then run that command locally. Keep the key out of chat and Git.
4. Reconnect the client. Verify tool discovery and permitted project reads.

**An owner's default key has full administration access.** Choose **Advanced permissions** for narrower access. Easy Setup includes recording and diagnostic reads for permitted projects; existing keys keep their original scopes.

**Quick setup** copies prompt and key together. Pasting shares the key with the chat provider and anyone with conversation access. Disabling training does not guarantee no storage or access. Both paths may leave the key in clipboard history/sync; a local agent can still read its private configuration.

<Demo step="agent" />

## Start one agreed task

Open a thread → **Copy task for agent** → paste with your request. The agent checks fresh evidence, proposes the change and verifies agreed work. A broad backlog request offers assigned tasks for you to choose. Connection alone starts no fixes or external writes.

| Need                                   | Reference                                                                                           |
| -------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Client settings, stdio or remote setup | [Connection and local import](/reference/manual/agent-setup)                                        |
| Reusable skills and discovery          | [Client installation](/reference/manual/plugin/feedbacks/skills/review-feedback/references/install) |
| Scopes, limits and exact operations    | [MCP contract](/reference/manual/mcp-contract)                                                      |
| Evidence, assignments and planning     | [Agent workflow](/reference/manual/agents)                                                          |

## Native plugins

Install Node.js 22.12+ or 24 and Git on the client machine, then choose your client. These commands use the [public Feedbacks marketplace](https://github.com/Softinator-TechLabs/feedbacks-plugins); no server checkout or `npm ci` is needed.

**Claude Code**

```sh
claude plugin marketplace add Softinator-TechLabs/feedbacks-plugins
claude plugin install feedbacks@feedbacks
```

**Codex**

```sh
codex plugin marketplace add Softinator-TechLabs/feedbacks-plugins
codex plugin add feedbacks@feedbacks
```

Continue with your personal URL/key configuration above, restart the client and verify the plugin inventory. Both packages include `review-feedback`, `manage-feedbacks-context` and the bundled MCP adapter. The install commands were verified with Claude Code 2.1.286 and Codex CLI 0.159.3. The publisher's own marketplace is separate from reviewed official directories.

For source builds, standalone ZIPs and private configuration, use the [native client reference](/reference/manual/agents#codex-plugin).
