# Feedbacks plugin for Codex

The [review skill](skills/review-feedback/SKILL.md) supports new-project discovery, today's feedback counts, prioritized discussion and sequential point/thread completion. Use `FEEDBACKS_MCP_PROFILE=compact` for seven-tool discovery. To install only the portable skill for Codex, Claude Code or Antigravity, run the built package's `node install-skill.mjs --help`, inspect with `--client <client> --check`, then install without `--check`. This writes no credentials or hooks; verify client discovery separately. Full-profile discovery remains the default for existing stdio connections.

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

### Project and member context on request

The package/setup prompt installs two focused skills: `review-feedback` for requested backlog work and `manage-feedbacks-context` for requested profile, project-background and responsibility edits. Their short descriptions enable natural-language discovery; bodies and references load progressively. No startup hooks or unsolicited polling are installed. Developers retain task choice.

Use `members.profile.get/save`, `members.responsibility.get/save`, and `projects.context.get/save` through exact schema discovery. Reads/writes return bounded text, revision, author/time and advisory provenance. Members edit their own profile; project writers edit collaborative context and their own responsibilities; owner administrators edit profiles and project maintainers edit other existing members' responsibilities. These operations never change grants, priority policy or approved instructions. Read current text, preserve relevant context, write its revision, then read back. New scopes require a newly issued key; existing keys do not expand.
