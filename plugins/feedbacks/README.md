# Feedbacks plugin for Codex

This directory contains the source manifest and review skill. Build a complete, standalone plugin with `npm run build:plugin` at the repository root. The installable folder is `dist/codex-plugin/feedbacks`; the release ZIP is `dist/feedbacks-codex-plugin.zip`.

The build bundles the existing MCP adapter and its pinned dependencies into `mcp.mjs`. It needs Node.js 22.12+ or 24 on the client machine, but no runtime npm install. No lifecycle hooks run and no credentials are bundled. The portable `plugin.json` / `mcp.json` are canonical; `.codex-plugin/plugin.json` and `.mcp.json` provide compatibility metadata.

Before using the plugin, supply `FEEDBACKS_URL` and `FEEDBACKS_TOKEN` to its process, or create an owned mode-0600 `~/.config/feedbacks/config.json` containing `url` and `token`. Use a scoped key from your chosen Feedbacks server. See the repository's agent setup guide for detailed permission and secret handling.

Install the built folder through a supported local Codex marketplace. Run `codex plugin --help` and `codex plugin marketplace --help` for the installed client's current commands. Public directory submission is a separate process; this package has not been submitted or approved by OpenAI.

From the repository root, install the local build using:

```sh
npm run build:plugin
codex plugin marketplace add ./dist/codex-plugin
codex plugin add feedbacks@feedbacks-local
```

See the [agent setup guide](https://github.com/Softinator-TechLabs/feedbacks-oss/blob/HEAD/docs/agents.md) for credentials, least-privilege scopes, first-use verification and public submission boundaries. Building and validating this package does not install it into an existing Codex client.
