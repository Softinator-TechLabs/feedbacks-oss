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

Monitor HTTP error rate, latency, memory, CPU, PostgreSQL connections/locks, disk headroom and object-store errors. Verify your proxy reports the correct client IP before relying on rate limits; an incorrect proxy hop count can make a five-minute password-login lock affect unrelated people or be bypassed. Monitor login `429` responses without logging passwords, request bodies or raw client IPs. Send logs to protected storage with bounded retention. Do not log authorization headers, cookies, private feedback or credential-bearing URLs.

The service drains HTTP connections and closes the pool on SIGTERM/SIGINT with a bounded timeout. Give the process at least 15 seconds before forced termination. Maintain a rollback candidate compatible with the current schema.

## Recovery

Define backup frequency and recovery objectives for your installation. Keep database backups encrypted and off-host; object storage needs its own versioning/backup policy. Restore into a new isolated database and bucket or prefix, confirm record counts and image access, then test the application there. Avoid granting routine application credentials restore or deletion privileges.

Preserve the Compose project name, persistent volumes, organization UUID and object prefix across updates. Do not erase or recreate them during troubleshooting. Data removal, retention changes and credential rotation are explicit operator actions with a recorded scope.

## Export retention and upgrade

Migration 5 adds export byte accounting and a persistent request budget. Existing snapshots retain their original expiry and content. The service sweeps expired snapshots every minute; new export attempts also sweep. Exports are temporary transfer snapshots, not backups. See the [API limits](api.md#instructions-context-and-agent-tokens).

Do not roll back to a build that lacks export budgets: it can create unaccounted snapshots and reintroduce unrestricted allocations. Retain the new schema and deploy a forward fix if needed. Database migrations run serially across concurrent process starts.

## Thread deletion and private object cleanup

Migration 18 adds a durable deletion receipt and object-cleanup outbox. `threads.delete` commits removal of selected thread records and attachment metadata with their cleanup keys in one database transaction. Authorized asset URLs stop resolving immediately, even when private storage is unavailable. Object deletes run after commit with four concurrent requests and a maximum of 12 objects per request. Leases expire after 60 seconds; an interrupted request can be resumed. The Feedback list's **Deleted feedback** panel exposes failed/pending work and explicit retries. A dedicated worker drains a global batch on startup and every 10 seconds, even when the browser closes. Failed objects back off from 30 seconds up to one hour; manual retry bypasses the schedule.

Each deletion accepts at most 50 distinct thread IDs and their current revisions. All are validated before mutation. `threads.deletions` returns up to 100 receipts, prioritizing unfinished cleanup; `activeOnly: true` limits the result to unfinished cleanup for the Feedback list. `threads.retryDeletion` rechecks current human maintainer authorization. Storage failures expose only a safe status, not provider credentials/errors. A reused deletion key with different input fails. Retries after an uncertain database response recover the persisted receipt.

Thread-owned images/videos and their renditions use the configured local or S3 `remove` operation, including Wasabi-compatible storage. Shared `documents` objects are retained. A successful cleanup receipt means current-object delete requests succeeded, **not** certified physical erasure: versioned buckets may retain older versions or create delete markers; Object Lock, retention policies, backups and previously issued short-lived signed URLs require separate operator handling. No version-purge or retention-bypass permission is requested. Verify version lifecycle and retention policies separately before promising complete storage erasure.

Deletion invalidates existing project export snapshots to avoid serving their deleted discussion content. A small audit tombstone retains thread IDs, actor and deletion time; cleanup receipts retain object keys. Hash/ID-only idempotency mappings are retained so delayed create/upload retries cannot resurrect deleted content. External GitHub issues are retained, and in-flight issue creation must be reconciled before deletion. Existing applied migrations and object keys are not rewritten.

## GitHub App credential recovery

Migration 28 stores encrypted managed App records and expiring setup requests.
Back up PostgreSQL and the private AssetStore, including
`feedbacks/<production|development>/organizations/<ORGANIZATION_ID>/server-secrets/github-apps/`; a database backup alone cannot recover managed
keys. Preserve the original `ORGANIZATION_ID` and storage prefix/mode because
managed encryption is bound to that server identity. Restore both into an isolated environment and verify a synthetic App
connection before relying on the backup. The same store must be shared across
replicas. Environment-managed Apps keep their existing secret/restart workflow.

A human owner can upload a replacement PEM for the same App ID in **Manage App
→ Update private key**, including while an uncertain Issue awaits reconciliation.
The operation verifies identity/permissions, preserves account policy and
disconnected state, and never repeats a pending Issue POST. Reconcile the
original request after credentials recover. A failed manifest exchange consumes
its state: start again, or import the already-created App with a new PEM.

Disconnect pauses App use while retaining history and credentials; active or
uncertain writes block it. Rotation retains prior private key objects for
recovery; no automatic secret-object cleanup is enabled. Preserve them with
your protected backup/retention policy. Unknown database commit outcomes also
retain newly written objects. Ordinary asset downloads cannot address this
prefix without authorized attachment metadata.

Older application builds ignore managed overrides and may use old environment
keys. Disable GitHub writes/sync before rollback; keep migration 28 and storage
intact and use a compatible forward fix before resuming. See
[storage choices and security boundaries](self-hosting.md#storage-and-security).
