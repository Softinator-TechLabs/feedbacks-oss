# Operations

Keep runtime secrets, deployment resource IDs, customer records and incident evidence in your private infrastructure repository or secret manager. The public repository contains reusable deployment definitions only.

## Release acceptance

1. Record the source revision, dependency lockfile and built artifact checksums.
2. Complete the contributor checks and native PostgreSQL tests. Review permission and migration changes.
3. Restore a protected database backup into an isolated environment and confirm its schema and sample synthetic records. Validate the object-store recovery process separately.
4. Deploy to staging with independent credentials and storage. Verify sign-in, project grants, extension pairing, screenshot submission/readback and a scoped MCP call.
5. Promote the same reviewed image. Confirm readiness, a real authenticated read and authorized image access at the intended domain. Record the deployment receipt privately.

Build success, a healthy container and a working domain are separate checks. Object storage is not checked by `/readyz`.

## Monitoring

Monitor HTTP error rate, latency, memory, CPU, PostgreSQL connections/locks, disk headroom and object-store errors. Verify your proxy reports the correct client IP before relying on rate limits. Send logs to protected storage with bounded retention. Do not log authorization headers, cookies, passwords, request bodies, private feedback or credential-bearing URLs.

The service drains HTTP connections and closes the pool on SIGTERM/SIGINT with a bounded timeout. Give the process at least 15 seconds before forced termination. Maintain a rollback candidate compatible with the current schema.

## Recovery

Define backup frequency and recovery objectives for your installation. Keep database backups encrypted and off-host; object storage needs its own versioning/backup policy. Restore into a new isolated database and bucket or prefix, confirm record counts and image access, then test the application there. Avoid granting routine application credentials restore or deletion privileges.

Preserve the Compose project name, persistent volumes, organization UUID and object prefix across updates. Do not erase or recreate them during troubleshooting. Data removal, retention changes and credential rotation are explicit operator actions with a recorded scope.

## Export retention and upgrade

Migration 5 adds export byte accounting and a persistent request budget. Existing snapshots retain their original expiry and content. The service sweeps expired snapshots every minute; new export attempts also sweep. Exports are temporary transfer snapshots, not backups. See the [API limits](api.md#instructions-context-and-agent-tokens).

Do not roll back to a build that lacks export budgets: it can create unaccounted snapshots and reintroduce unrestricted allocations. Retain the new schema and deploy a forward fix if needed. Database migrations run serially across concurrent process starts.
