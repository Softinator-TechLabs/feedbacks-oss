# Development

Follow the README for local setup. The development database binds only to `127.0.0.1:5432`. Keep its example password local and never reuse it in production. Docker Compose loads `.env`; Node development scripts explicitly load it too.

| Command                  | Purpose                                                          |
| ------------------------ | ---------------------------------------------------------------- |
| `npm run dev:server`     | API + built application on port 3000, reload on source changes   |
| `npm run dev:web`        | Vite application client on port 5173; API proxy to port 3000     |
| `npm run dev:site`       | Standalone website on port 4174                                  |
| `npm run dev:docs`       | VitePress documentation preview (local search works after build) |
| `npm run typecheck`      | Server and React TypeScript checks                               |
| `npm test`               | Isolated PGlite domain/transport tests and focused unit tests    |
| `npm run test:postgres`  | Native PostgreSQL cursor/migration concurrency tests             |
| `npm run build`          | Server, application, website and extension distributions         |
| `npm run check`          | Contributor quality gate                                         |
| `npm run release:source` | Build a source-only archive with no Git history                  |

## Disposable agent sandbox

Run `npm run harness:dev` after `npm ci`. Each run creates an in-memory PGlite database, local assets, random owner credentials and a fresh loopback port. Access details are written with owner-only permissions under ignored `.local/`; passwords are not logged. No `.env`, external database or S3 configuration is loaded. Stop with Ctrl+C to discard the instance. Rebuild/restart after source edits.

Run `npm run harness:smoke` after `npm run build` for the same fixture with automatic sign-in, create/readback, denial and readiness checks followed by cleanup. See [verification](verification.md) for its limits.

## Database testing

PGlite tests create isolated databases and temporary asset directories. They never connect to a configured production database. Native PostgreSQL tests create and stop a temporary local cluster using `initdb` and `pg_ctl`; put those binaries on PATH. They use a Unix socket and do not listen on TCP. Run them for migration or transaction changes because PGlite serializes its single connection and cannot prove concurrent commit behavior.

## UI changes

Keep the authenticated application and public site independent. Website code belongs under `site/`; app routes belong under `src/web/`. Use synthetic review content for screenshots. Verify desktop and mobile layouts, keyboard use, contrast and controls. Do not add analytics or third-party runtime scripts without an explicit product and privacy review.

## Dependency changes

Commit `package-lock.json`, explain the need and inspect licenses, maintenance and installation scripts. Use `npm ci` in CI. Runtime images install production dependencies only. Keep extension code local to its package and review permission changes separately.
