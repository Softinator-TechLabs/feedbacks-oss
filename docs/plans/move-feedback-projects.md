# Plan: move feedback between projects

Status: in progress. Date: 2026-09-28.

## Outcome and scope

A maintainer can move a thread to another accessible project through a small destination chooser in More actions or the same MCP/CLI operation. The thread ID and URL, evidence, discussion, points and human work plan remain usable. Project creation, context and membership continue using existing operations; moving does not grant access or connect repositories.

## Evidence and approach

Use `threads.move` with current thread revision and destination `projectId`, implemented in the domain transaction shared by all transports. Require maintainer access and token scope for both projects. Update project-owned dependent rows and invalidate snapshots so former project members cannot retain API access to moved evidence. Keep storage object keys stable. Do not silently change uncertain external integrations or move a document still used by other threads.

## Steps and progress

- [x] Inspect existing project, thread, asset and membership operations.
- [x] Implement transactional move with permission, revision, media and dependency regression coverage.
- [x] Add a compact destination chooser under thread More actions with error recovery.
- [x] Document exact MCP operation and regenerate discoverable schemas.
- [x] Verify synthetic desktop/mobile moves, full checks and PostgreSQL behavior.
- [ ] Merge passing CI, deploy and verify live project routing and move capability.

## Compatibility and recovery

No persistent object keys or thread IDs change. New agent keys receive a separate move scope; existing credentials retain their scopes. A move requires target membership for active assignees; it never adds people implicitly. Guest thread links are revoked at the project boundary. Immutable exports containing moved content are invalidated. Linked external issues remain references; automated status sync must not continue under the wrong project. Move back is an explicit new operation after reading the latest revision.

## Completion receipt

Local checks: 201 passed, 5 optional skips, 0 failed; native PostgreSQL concurrency passed including simultaneous moves. Browser move preserved URL, draft, points, discussion and assignment; desktop/mobile and dark dialog checked. Documentation build exposed a missing publication root, corrected in publish-docs. Full builds, generated docs, isolated smoke and 509-file release validation passed. Compact MCP execution was verified against the synthetic app. CI and deployment pending.
