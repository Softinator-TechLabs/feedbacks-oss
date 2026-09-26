# GitHub workflow and public documentation

Status: merged and verified in production. Owner: Feedbacks maintainers. Date: 2026-09-26.

## Outcome

Project members find GitHub setup in a dedicated project tab with explicit App,
installation and repository states. A maintainer can create and link an Issue
from the thread header in one click. The Issue includes bounded feedback and
image/video links. The public website serves searchable, versioned documentation
at `/docs/`; Help offers short setup paths and links to those guides.

## Decisions and boundaries

- Move GitHub controls out of general Settings, including the repository URL.
  Keep general project fields in Settings and secondary status sync controls in
  the GitHub tab.
- Distinguish server App configuration, installation on the selected repository,
  project connection and degraded access. No cached `connected` flag is proof
  of current GitHub access.
- One-click creation is a deliberate signed-in maintainer action. Continue to
  reserve an Issue request before the external write and require reconciliation
  after uncertain results. Never create an Issue from incoming feedback alone.
- Private Wasabi objects need temporary signed URLs. Include a seven-day direct
  link only when the connected repository is private; include the durable,
  authenticated Feedbacks asset URL as well. Public repositories receive only
  authenticated Feedbacks links. Never publish raw object keys or credentials.
- Use VitePress: its first-party local search and Markdown source fit the
  existing Vite static site and allow a `/docs/` subpath without a search
  service. Export an `llms.txt` index and plain Markdown alongside HTML.

## Work

- [x] Add focused server tests for connection state and one-click Issue body,
      authorization, idempotence and attachment visibility.
- [x] Implement the server operations and signed media links.
- [x] Add the GitHub project tab and compact thread Issue control; remove the
      buried duplicate control. Verify desktop, narrow layout and keyboard use.
- [x] Build VitePress docs for getting started, self-hosting, extension,
      MCP/agent setup, GitHub Issues and usage. Link them from Help and ship
      machine-readable Markdown and `llms.txt`.
- [x] Run focused tests, full `npm run check`, source diff review and public
      site build/route checks.
- [x] Merge through required CI, deploy and verify live app and public `/docs/` routes.

Local evidence: `npm run check` passed on 2026-09-26, including the full PGlite
suite, TypeScript, site/app/extension builds, synthetic sandbox and release
source checks. `npm audit --audit-level=high` reported zero vulnerabilities.
The disposable signed-in app captured desktop/mobile, light/dark GitHub and
thread views with no blocked requests. Local docs preview served the home,
GitHub guide, MCP Markdown and `llms.txt`; built-in search returned GitHub
results. PR [#65](https://github.com/Softinator-TechLabs/feedbacks-oss/pull/65)
merged as `33f21e5`; Node 22/24, secrets and container checks passed. The signed-in
production project displayed App configured, App installed and Project connected;
its linked synthetic thread displayed the GitHub Issue control. The public site
returned 200 for `/docs/`, `/docs/guide/github`, `/docs/guide/mcp.md` and
`/docs/llms.txt`; Docs and Help were inspected in Chrome. A later
[alignment fix](https://github.com/Softinator-TechLabs/feedbacks-oss/pull/66)
merged as `de197f7`; main CI passed and the live stylesheet matched its build.
This inspection did not create a new customer Issue or download a private
attachment. The synthetic Issue and focused server tests cover those paths.

## Research

Checked 2026-09-26: [VitePress local search](https://vitepress.dev/reference/default-theme-search)
and [routing](https://vitepress.dev/guide/routing) support local index and
subpath hosting. [Starlight search](https://starlight.astro.build/guides/site-search/)
is also built in, but would add a second site framework here. [Docusaurus
search](https://docusaurus.io/docs/search) treats local search as a community
plugin. [Wasabi presigned URLs](https://docs.wasabi.com/v1/docs/how-do-i-generate-pre-signed-urls-for-temporary-access-with-wasabi)
expire after at most seven days, so a stable authenticated fallback is needed.
