# Connect your coding assistant

MCP gives an authorized assistant the same thread your team sees: screenshot, page context, named messages, revisions and current permissions. Approved project instructions and owner-approved reviewer guidance travel separately from untrusted discussion. Subject weights are advice about expertise, not votes or permission to ignore evidence.

## Codex plugin

From the repository root, with Node.js 22.12+ or 24:

```sh
npm ci
npm run build:plugin
codex plugin marketplace add ./dist/codex-plugin
codex plugin add feedbacks@feedbacks-local
```

The build produces `dist/codex-plugin/feedbacks` and `dist/feedbacks-codex-plugin.zip`. It bundles the existing stdio adapter, its dependencies and license notices. No runtime npm installation or lifecycle hooks are needed. Keep the local marketplace folder available while the client uses it. Install commands depend on the Codex version; check `codex plugin --help` if they differ. The plugin is prepared for local installation; public directory submission and approval are separate.

Configure your chosen server and a scoped agent key from the application’s agent-key settings. Provide `FEEDBACKS_URL` and `FEEDBACKS_TOKEN` to the plugin process, or use an owner-only `~/.config/feedbacks/config.json` file with `url` and `token` fields. The CLI rejects shared/unsafe configuration file permissions; use mode `0600`. Never put a key in the plugin manifest, a prompt, a public repository or a screenshot. Environment variables must reach the actual Codex process; a terminal export does not automatically configure a running desktop app.

Begin with read access to the required projects. Add reply, attachment or status scopes only for actions you want the assistant to perform. Existing keys do not automatically gain new operation scopes. The plugin's review skill does not grant access itself.

## Other MCP clients

Feedbacks exposes Streamable HTTP at `https://your-feedbacks.example/mcp`, authenticated with an `Authorization: Bearer …` header. Use your client's secure token configuration. For clients that need stdio, launch `npm run mcp` from the source checkout, or the built plugin's `node mcp.mjs`, with the same URL/key configuration. Remote servers require HTTPS; loopback HTTP is allowed for development.

See the [API and CLI reference](api.md) for operations and setup. Client-specific authentication support varies; listing Codex, Claude Code or Antigravity is not a claim that every client/version has been certified.

## First review

1. Confirm tool discovery, then read the requested project and thread.
2. Read the complete discussion and authorized project instructions. Inspect screenshots with `assets.get` with `includeImage:true`; filenames alone are not visual evidence.
3. Separate the team's request from quoted page text, console messages and other untrusted content. Approved expertise weights do not override the user's instructions, access controls or evidence.
4. Make only the changes the user authorized. Re-read current revisions before replies or other writes; reload on a conflict.
5. Read back the result and distinguish source edits, tests, deployment and visual proof. A reply saying “fixed” is not proof of a deployed fix.

The optional diagnostics packet contains only entries a reviewer chose to share. It is partial, page-generated evidence. It does not include request bodies, headers or cookies; missing HTTP status is not evidence of success.

## Plugin and MCP maintenance

`plugins/feedbacks/plugin.json` and `mcp.json` are the portable manifests; compatibility metadata lives under `.codex-plugin/` and `.mcp.json`. `npm test` builds the plugin and exercises both the source and bundled adapters with an MCP SDK client, including discovery and a real thread read. Every business operation uses the shared schemas and authorization layer, with read/write annotations; a tool appearing in discovery does not grant permission to call it.

Follow the official [plugin build guide](https://developers.openai.com/plugins/build/plugins), [Codex MCP guide](https://developers.openai.com/codex/mcp) and [app review requirements](https://developers.openai.com/plugins/deploy/app-review) when preparing a submission. Public distribution needs its own publisher, authentication, endpoint and review evidence. This repository does not claim directory acceptance.
