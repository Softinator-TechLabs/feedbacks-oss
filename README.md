# Feedbacks

**Your team's slate for the web.**

Take a screenshot of a web page, draw what you mean with a pencil, and discuss it with your team or coding agent. Keep the original context together before deciding what belongs in Figma, GitHub Issues or Projects. Feedbacks includes the web application, Chrome extension, HTTP API, MCP server and JSON CLI.

[Website](https://feedbacks.softinator.ai) · [Why Feedbacks](docs/why-feedbacks.md) · [Self-hosting](docs/self-hosting.md) · [Extension](docs/extension.md) · [Coding assistants & Codex plugin](docs/agents.md) · [API & MCP](docs/api.md) · [Roadmap](https://github.com/orgs/Softinator-TechLabs/projects/4) · [Contributing](CONTRIBUTING.md)

## What it does

- Capture and annotate website screenshots, redact sensitive areas, and attach page and viewport context.
- Organize feedback by project with explicit member access and allowed website origins.
- Discuss changes, mention teammates, and track response obligations separately from work status.
- Move between filtered threads with arrow keys, add optional tags and reuse personal saved views.
- Compare screenshot attachments and deliberately share selected console/network context.
- Give tools and agents project-scoped access through the same authorization layer as the web app.
- Keep screenshot objects private; the application checks access before serving them.

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

## Browser extension

Build with `npm run build:extension`. Load the `extension/` directory from Chrome's **Load unpacked**, or use the ZIP in `dist/extension/`. Enter your own Feedbacks server address and approve pairing in the web application. Website-wide permission is a separate optional action. Existing saved server connections remain available.

## Repository map

| Path          | Responsibility                                                                    |
| ------------- | --------------------------------------------------------------------------------- |
| `src/server/` | Authentication, project access, business operations, persistence and transports   |
| `src/shared/` | Typed operation inputs, outputs and descriptions                                  |
| `src/web/`    | Authenticated React application                                                   |
| `src/cli/`    | Bootstrap, JSON CLI and stdio MCP adapter                                         |
| `plugins/`    | Codex plugin manifests and review skill; standalone MCP bundle generated at build |
| `extension/`  | Chrome Manifest V3 capture and review extension                                   |
| `site/`       | Independently deployable public website                                           |
| `tests/`      | Isolated authorization, transport and database tests                              |
| `ops/`        | Generic deployment configuration                                                  |
| `docs/`       | Public contributor and operator documentation                                     |

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
