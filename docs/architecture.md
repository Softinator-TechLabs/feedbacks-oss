# Architecture

Feedbacks is a modular monolith with independently built clients. The domain service owns authorization and transactions. HTTP, MCP and the CLI use the same operation registry rather than implementing parallel business rules.

```mermaid
flowchart LR
  Browser[Web application] --> HTTP[HTTP transport]
  Extension[Chrome extension] --> HTTP
  Agent[MCP client] --> MCP[MCP transport]
  CLI[JSON CLI] --> HTTP
  HTTP --> Operations[Typed domain operations]
  MCP --> Operations
  Operations --> Access[Current identity and project grants]
  Operations --> PG[(PostgreSQL)]
  Operations --> S3[(Private object storage)]
  Website[Public website] --> Docs[GitHub and documentation]
```

## Modules

- `config.ts`, `index.ts`, `db.ts`, `migrations.ts`: validated environment, process lifecycle, connection pool and serialized migrations.
- `auth.ts`, `accounts.ts`, `access.ts`: account lifecycle, credential boundaries and project access.
- `projects.ts`, `feedback.ts`, `views.ts`, `discussion-likes.ts`: review workflow and optimistic concurrency.
- `assets.ts`, `documents.ts`: image normalization, bounded WebM intake, private storage, project document review and authorized readback.
- `scheduled-qa.ts`: opt-in daily public-page checks, bounded private image comparison and reviewable run history.
- `context.ts`, `export-limits.ts`: versioned instructions, stable bounded exports and change cursors.
- `operations.ts`: transactional operation dispatch. `app.ts` and `mcp.ts` handle transport concerns.
- `github-operations.ts`: stable GitHub operation dispatch. `src/server/github/` groups connection changes, Issue requests, and status sync while retaining each authorization check and transaction around the external GitHub call.
- `src/shared/contracts.ts`: stable public import path for operation schemas and scopes. `src/shared/contracts/domains/` owns schemas by domain, and `src/shared/contracts/registry.ts` composes the typed input/output registries.
- `sdk/ios`, `sdk/android`: optional native app clients using existing paired-device HTTP operations; neither owns authorization or embeds server credentials.

Client state is not authoritative. Database revisions detect stale writes; idempotency keys protect retries. Credentials are checked against current account state. Agents cannot become humans by selecting an input field.

The web application groups thread, project, member, account, document, and survey views under `src/web/threads/`, `src/web/projects/`, `src/web/members/`, `src/web/account/`, `src/web/documents/`, and `src/web/surveys/`. Member credential handoff and administration live with the member views; password replacement lives with the account view. `src/web/styles.css` imports ordered feature styles so the cascade stays explicit. The extension keeps `background.js`, `content.js`, and `editor.js` as stable Chrome entrypoints; internal capture, submission, session, recording, video, review, connection, and diagnostics code lives in corresponding `extension/` folders. The ZIP allowlist and isolated Chromium checks cover these internal paths. `scripts/qa/extension/setup/`, `capture/`, and `review/` group browser fixtures and acceptance workflows; `scripts/extension-browser-qa.mjs` owns the disposable browser and final sequence.

## Deployment model

Use one codebase and separate runtime installations. A deployment represents one organization. Its owners can administer that organization's projects and members. Separate origins or object prefixes do not turn a shared database into a tenant boundary.

| Surface                   | Deployable artifact                    | Data boundary                                                         |
| ------------------------- | -------------------------------------- | --------------------------------------------------------------------- |
| Public website            | `dist/site` or `Dockerfile.site`       | Static content; no application database or credentials                |
| Team application          | `Dockerfile` + PostgreSQL + private S3 | One organization per database                                         |
| Hosted customer workspace | The same application image             | Separate database, object-store credentials and runtime configuration |
| Browser extension         | Versioned extension ZIP                | User-selected server and local connection state                       |
| Native app integration    | Host-built Swift or Android module     | Host app pairs a reviewer device and stores its scoped token locally  |

Organization-specific deployment inventory and secrets should live in a separate private infrastructure repository. A separate enterprise code fork is unnecessary for the current feature set and creates duplicated fixes. If commercial-only services are introduced later, keep their interfaces explicit and their licensing separate.

## Scaling boundaries

The public website can be cached independently. The application stores sessions, grants, feedback and cursors in PostgreSQL, with screenshot bytes in object storage. Database connection count is bounded by `DATABASE_POOL_MAX`; budget it across all replicas and operational clients. Transaction advisory locks serialize migrations and conflicting account/project operations.

Three failed password sign-ins from one client IP within five minutes start a five-minute block. PostgreSQL stores this lock across restarts and replicas; the separate 30-request/minute account ingress ceiling remains process-local. Start with one application replica. Before adding replicas, enforce a shared ingress throttle with verified client-IP handling, tune the total connection budget, exercise concurrent writes on real PostgreSQL, and measure latency, error rate, memory and image-processing capacity under representative traffic. Adding replicas alone does not establish high availability.

The account lock serializes domain database operations, including export construction. Image upload performs an initial authorization and revision check under the lock, decodes the image and writes to private object storage outside the lock, then rechecks current authorization and revision before committing metadata. A rejected upload removes its uncommitted object where the transaction outcome is known. An uncertain database commit preserves the private object rather than risk deleting a committed image; operators should monitor and reconcile orphaned private objects. S3 requests have a 15-second abort deadline; PostgreSQL statements have a 30-second timeout and lock waits a 10-second timeout. Export creation has persistent per-user/project/deployment attempt and active-snapshot budgets plus content-size limits; pagination reuses an immutable snapshot. This bounds amplification but is not a throughput benchmark. Large image decoding and exports consume application resources. Set ingress body/time limits, monitor load and add bounded asynchronous processing only when measurements justify it. Retention, backups and restore objectives are deployment decisions; no automatic deletion policy is enabled.

Shared-database multi-tenancy would require tenant-scoped identity, tenant predicates on every query, tenant-aware tokens and cache keys, isolation tests and a migration plan. This release does not claim those properties.

## Mechanically checked runtime boundaries

`npm run check:harness` parses literal runtime imports with the existing esbuild dependency. Shared modules depend on shared modules and Zod; server and web modules depend on their own layer and shared contracts; extension and site code stay inside their independently packaged directories. CLI modules use CLI/shared code, with these existing narrow exceptions:

- `src/cli/bootstrap.ts` imports server config, database, migrations and authentication for the explicit operator entry point.
- `src/cli/client.ts` and `src/cli/feedbacks.ts` reuse the server's `DomainError`.
- `src/cli/mcp.ts` reuses the server MCP adapter, passing the HTTP client as its executor.

These exceptions are exact file-to-file edges in [the checker](../scripts/lib/harness.mjs), not permission for arbitrary CLI imports into server internals. Extending one requires a documented reason and a regression test. The check excludes type-only and computed imports; review those explicitly. Internal domain layering within `src/server` remains a review responsibility.
