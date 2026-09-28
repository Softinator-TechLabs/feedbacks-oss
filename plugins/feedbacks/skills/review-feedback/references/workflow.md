# Sequential task lifecycle

Read `feedbacks_describe {operation:"threads.status"}` for exact schemas. `feedbacks_execute` preserves original scopes; it grants no extra authority. Each write needs the latest returned/read revision.

1. Agree selection, success criteria and approach: direct fix, larger plan, investigate or defer. Preserve prior authorization. For a batch retain ordered IDs, stopping at missing decisions, denial, conflict or failed required verification.
2. Read overview and relevant complete sections; inspect newer corrections and current work/response/review states. Coordinate before taking over existing in-progress work; status is not a lock.
3. Start with `threads.status {threadId,revision,state:"in_progress",note:"Agreed scope"}`. Planning can be the agreed scope. Read-only triage never starts work automatically.
4. Implement and test. If blocked, retain in-progress and explain the blocker to the developer; there is no invented blocked state. Post comments only when communication is authorized.
5. Add real links via `threads.evidence` after reading its schema. Separate source, tests, full checks, deployment and live visual evidence.
6. Resolve only verified selected points: `threads.annotationStatus {threadId,revision,annotationId,state:"resolved"}`. Use the returned revision for the next write. Captured markings stay historical; `effectiveState` includes parent closure.
7. Use `ready_for_review` when required human/deployment checks remain. Parent `resolved`/`declined` closes active points, so never close it for partial work. Supply a meaningful resolution note and honor resolve/review permission. Reopening a parent preserves individual point decisions; explicitly reopen selected points when appropriate.
8. When authorized, reply with `intent:"response"`, current revision and a unique stable `idempotencyKey`. The same key/payload reconciles an uncertain retry; never blindly resend with a new key. Replies do not resolve work.
9. Read back overview/points. Re-query the live queue from offset 0 with the same filters and skip completed IDs: mutations reorder the list and old offsets can skip work. Discuss the next task unless an order/approach is already agreed.

## Recovery

`FORBIDDEN`: identify the operation/scope and request appropriately scoped access or human action; never expand access automatically. A denied weighted priority query can use explicitly labelled top-priority-only sorting.

`CONFLICT`: re-read and reconcile rather than overwrite. Paged reads pin the initial revision and a SHA-256 section content version, including likes and reviewer guidance that can change independently. Carry both `expectedRevision` and `expectedContentVersion` on continuations. Expiry/revocation requires reconnection, not endless retries or issuing credentials.

Timeout after write: read back first. Idempotency exists only on schemas supplying it. Inspect additional external-issue uncertainty rules before such actions.

`nextTextOffset`: retain section/item offset/limit, join text before parsing, finish the text continuation, then follow `nextOffset`. A fragment is not a complete record.

## Example output shape

“Today in the selected timezone: N threads from this reviewer, P points; A threads remain active. Two are explicitly top priority. Proposed order: checkout blocker, shared header dependency, remaining visual fixes. Here are the specific evidence and uncertainty for each. The first needs a plan; the second looks like a direct fix. Which approach should we use?”

Compute actual numbers and dependencies; this is only an output shape.
