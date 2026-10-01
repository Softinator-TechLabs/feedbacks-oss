# Feedbacks

**Free, Apache-2.0 visual feedback, session replay and debugging context.**

Show the problem with a screenshot, exact text suggestion or video + session recording. Keep the discussion, event timeline, browser diagnostics and approved project context together. Your team and coding agent can investigate the evidence, make the agreed change and record verification. The complete product is free to self-host; you provide the infrastructure and any AI tools you use.

**Set up a team server first.** The order is: server → install and connect the Chrome extension → project context, optional GitHub App and members → each developer's personal MCP setup. One installation serves your team; the extension does not host a server. Follow the [complete setup flow](site-docs/guide/getting-started.md), or the separate [DevOps installation guide](site-docs/guide/self-host.md).

[Website](https://feedbacks.softinator.ai) · [Why Feedbacks](docs/why-feedbacks.md) · [Self-hosting](docs/self-hosting.md) · [Extension](docs/extension.md) · [Coding assistants & plugins](docs/agents.md) · [API & MCP](docs/api.md) · [Roadmap](https://github.com/orgs/Softinator-TechLabs/projects/4) · [Contributing](CONTRIBUTING.md)

## What it does

- **Show exactly what changed:** screenshot pins, annotation, full-page capture and selected-text replacement suggestions.
- **Replay the bug:** video or session-only recording with one timeline for activity, console, network and performance. Save and annotate frames.
- **Take the evidence:** complete thread bundles with discussion, media, recordings, diagnostics and checksums; scoped agent reads and recording exports.
- **Give agents context:** approved project instructions, reviewer guidance and responsibilities through MCP, API and CLI.
- **Move the work forward:** assignments, categories, tags, saved views and point progress; optional GitHub Issues across repositories and installations, with multiple configured Apps and one owner-selected App per project.
- **Review beyond the extension:** scoped guest links, PDF/image review, an optional text widget, surveys/NPS, scheduled public-page QA, native mobile clients and signed webhooks.
- **Own the whole service:** Apache-2.0 server and clients, PostgreSQL and private S3-compatible storage. One installation serves one organization.

[Recording guide](site-docs/guide/session-replay.md) · [Debug bundles](site-docs/guide/debug-bundles.md) · [Text suggestions](site-docs/guide/text-suggestions.md) · [More review workflows](site-docs/guide/more-ways-to-review.md)

Feedbacks is an early 0.x release. Each application deployment serves one organization. Public registration, billing, SSO and shared-database customer tenancy are not implemented. See [architecture and deployment boundaries](docs/architecture.md).

## Run locally

Requirements: Node.js 22 or 24, npm, and Docker Compose for PostgreSQL.

```sh
git clone https://github.com/Softinator-TechLabs/feedbacks-oss.git
cd feedbacks-oss
npm ci
cp .env.example .env
docker compose -f compose.dev.yaml up -d --wait
npm run bootstrap
npm run build
npm run dev:server
```

Before bootstrap, add `BOOTSTRAP_EMAIL`, `BOOTSTRAP_NAME` and a unique `BOOTSTRAP_PASSWORD` to your local `.env`. Bootstrap creates the first owner once. Remove the bootstrap password afterward. Open [localhost:3000](http://localhost:3000). The example database password is for the loopback-only development database.

For live client edits, run `npm run dev:web` in another terminal and set `APP_ORIGIN=http://localhost:5173` in `.env` before restarting the server. Use that origin in the browser. For the standalone public website, use `npm run dev:site`.

Production requires HTTPS, PostgreSQL and private S3-compatible storage. Follow the [deployment guide](docs/self-hosting.md) for configuration, first-owner setup and recovery.

For a registry deployment, use the [public Docker Hub image](https://hub.docker.com/r/softinator/feedbacks) and [registry Compose](compose.registry.yaml). The [illustrated storage guide](site-docs/guide/storage.md) maps the five prerequisites to their environment fields. Developers can install the bundled [Claude Code and Codex plugins](https://github.com/Softinator-TechLabs/feedbacks-plugins) in two commands, then connect their own scoped key.

## Browser extension

Build with `npm run build:extension`. Load the `dist/extension/unpacked/` directory from Chrome's **Load unpacked**, or use the ZIP in `dist/extension/`. Enter your own Feedbacks server address and approve pairing in the web application. Website-wide permission is a separate optional action. Existing saved server connections remain available.

## Repository map

| Path          | Responsibility                                                                          |
| ------------- | --------------------------------------------------------------------------------------- |
| `src/server/` | Authentication, project access, business operations, persistence and transports         |
| `src/shared/` | Typed operation inputs, outputs and descriptions                                        |
| `src/web/`    | Authenticated React application                                                         |
| `src/cli/`    | Bootstrap, JSON CLI and stdio MCP adapter                                               |
| `plugins/`    | Codex and Claude Code plugin packages and review skills; MCP bundles generated at build |
| `extension/`  | Chrome Manifest V3 capture and review extension                                         |
| `site/`       | Independently deployable public website                                                 |
| `tests/`      | Isolated authorization, transport and database tests                                    |
| `ops/`        | Generic deployment configuration                                                        |
| `docs/`       | Public contributor and operator documentation                                           |

## Agent development

Start with [AGENTS.md](AGENTS.md) and the [documentation map](docs/index.md). Claude Code and Gemini CLI have thin adapters to the same instructions. See [supported skills and client setup](docs/agent-tools.md). For an isolated app with synthetic data and no deployment credentials:

```sh
npm ci
npm run harness:dev
```

The command builds the app and prints its loopback URL and private local access-file path. Each run has a disposable database and independent port.

## Development

```sh
npm run check
# Optional native PostgreSQL concurrency tests (initdb and pg_ctl on PATH):
npm run test:postgres
```

`check` runs formatting, architecture/docs checks, type checking, tests, all builds, an isolated app smoke check and release-content checks. CI also runs the native PostgreSQL tests, dependency audit and secret scanning. A passing build is not evidence of production deployment or capacity.

## License and community

The application, extension and website source are [Apache-2.0 licensed](LICENSE). Dependencies retain their licenses. Read [contribution guidelines](CONTRIBUTING.md), [community standards](CODE_OF_CONDUCT.md), [security reporting](SECURITY.md) and [trademark guidance](TRADEMARKS.md).
