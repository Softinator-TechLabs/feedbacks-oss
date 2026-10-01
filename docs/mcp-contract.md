# Agent-facing feedback contract

Exact schemas and callable operation names are in the [API reference](api.md). The HTTP integration tests exercise protocol initialization, tool discovery and authorized calls. Deployment acceptance is a separate operator check.

## Independent status dimensions

The optional compact profile (`/mcp?profile=compact`, or stdio `FEEDBACKS_MCP_PROFILE=compact`) provides progressive project/queue/thread/media access over these same operation scopes. See [compact tools and CLI](agents.md#compact-profile-and-cli). Both profiles expose the same compact entry tools, static skill resources and prompt; full also retains direct operations. `feedbacks_start` is read-only and composes permitted task, identity, instruction and coordination reads. Compact calls do not mint scopes or bypass authorization. Read `expectedRevision`, `expectedContentVersion`, `nextOffset` and `nextTextOffset` before continuing section reads. Native image metadata includes preview dimensions and optional original-pixel crop.

| Dimension      | States / data                                                                                                   | Changes pin visibility?                     |
| -------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Response       | `unanswered`, `responded`, `needs-follow-up`; last request/response actor and time                              | No                                          |
| Work           | `open`, `in_progress`, `ready_for_review`, `resolved`, `declined`                                               | Resolved and declined hide by default       |
| Review         | Open round, human approval, or changes requested with attributed history                                        | No                                          |
| External issue | No link, or reported GitHub, Jira Cloud and Linear Issue URLs with provenance; GitHub App links may be verified | No                                          |
| Fix evidence   | Attributed commit/PR/variant/incorporated-in URL and note                                                       | Only an authorized resolution hides the pin |

An Issue being closed is not proof that a deployed UI is fixed. A reply is not a fix. A failed write never changes either status or pin visibility optimistically without a recoverable pending/error state.

## Identity and denied operations

`auth.me` adds `member`, `serverOrigin` and `credential` information. The credential identifies token versus session scope mode, granted scopes, effective operation-scope grants, selected projects and resolution grant. These are not a bypass of current project or domain authorization. Missing operation scopes return `FORBIDDEN` with `operation`, `requiredScopes`, `reason` and `recovery` in HTTP error details and MCP JSON error text/metadata. MCP errors omit success `structuredContent`, preserving legacy clients that validate that field even when `isError` is true. CLI errors retain the same details. Clients should not repeat an unchanged denied call.

`threads.activity` accepts `threadId`, optional `before` cursor and bounded `limit`; it requires current thread access and either `threads.get` or `threads.activity`. It returns whitelisted event metadata, current revision, coverage limits and `nextBefore`. It excludes raw payloads, actors, historical message bodies and failed attempts.

## Structured result

The transport returns `structuredContent` with an explicit output schema and a short text summary. A thread read or successful mutation includes:

- `id`, `projectId`, `revision`, `createdAt` and `updatedAt`.
- `response`: state, last human request, last response, actor and time.
- `work`: current state and attributed state-change history; resolution requires a note.
- `review`: current round, decision state and attributed history. Older export snapshots may not contain this field. Human sign-off is independent of work status; agent tokens cannot write it.
- `externalIssues`: URL, repository, issue number, linked-by actor, link time and optional reported creation time. Manual links have `verification:"reported"`; an optional GitHub App connection records `github_verified` and can read open or closed state. Linking and readback alone leave work status unchanged. A project maintainer may separately enable status sync for verified links; the worker then reconciles one-sided open/closed changes conservatively, with visible conflict and uncertainty states.
- `fixEvidence`: attributable commit/PR/variant/incorporated-in links and notes. A supplied URL is not proof that the target is deployed or verified.
- `pins.defaultVisible`: resolved/declined/archived pins are hidden by default. Original context and client anchor match remain separate.
- `context`: sanitized target URL, requested preset, actual viewport, pixel ratio, scroll, capture dimensions and bounded element anchor metadata.
- For document feedback, `context.document` identifies the private project document, page and normalized point. The context URL opens the authorized document viewer. Newly issued tokens need explicit `documents.list`, `documents.get` or `documents.threads` scopes to inspect document metadata; the file proxy requires `documents.get` and a current project grant. Existing scoped keys do not gain these scopes.
- `view`: view fingerprint, raw unique likes, caller preference and discussion count; authorized internal policy data is separate.
- `likes:{uniqueLikes,liked}` on original feedback and every reply: independent discussion-message aggregates. Agents read counts with `liked:false`, never voter lists. Existing view likes and most-liked-view sorting remain separate.
- `assets`: opaque asset IDs and authenticated proxy paths. Fetch with the same authorized cookie or bearer token; there is no public object URL.
- `diagnosticEvidence`: compact screenshot evidence count, recent IDs, byte sizes and channel coverage. The ordinary thread/MCP overview never embeds a full DOM or raw console/network values. Use `diagnostics.list` and `diagnostics.describe` for coverage and files, `diagnostics.search` to locate console/network/performance events by exact request ID or absolute ingress time, and bounded `diagnostics.read` for selected bytes. Search returns at most 50 metadata locators per page with a stable cursor and a complete/partial/unavailable index status; it does not return captured page values or search raw DOM/body bytes. It requires both search and read scopes. The local stdio full profile can call `feedbacks_diagnostics_materialize` for a checksum-verified private directory. The authenticated thread UI can stream an archive. These operations require explicit diagnostic scopes and current project access.
- `trust: "untrusted_discussion"`, author, replies and last actor. Approved instructions use a different trust marker and operation.
- With `context.policy`, `reviewerContext` carries `trust:"owner_approved_advisory_reviewer_context"` and items `{userId,name,guidance,revision,policy,policyVersion}` associated with stable thread and reply author identities. This is advisory reviewer context, not discussion or project instructions. Private notes never enter this result.

Use `context.reviewers {projectId}` with both `context.reviewers` and `context.policy` scopes to read current guidance and dimension importance. It is restricted to project members and actual feedback/reply authors. A `reviewer.guidance.changed` event in `context.changes` indicates that current guidance should be fetched; an export snapshot retains its historical values. Ordinary scoped keys cannot edit guidance, read private notes or administer users. Explicit owner-admin keys can administer users; only a primary owner's delegation can read/write private notes and edit guidance. Language, age and family relationship are never automatic grounds to discount feedback. Owner login links are full browser credentials and must never be substituted for MCP bearer tokens.

Project reads expose caller-specific project permissions; they are not duplicated as an invented per-thread permissions object. Context exports carry `schemaVersion`, a stable paginated snapshot and a change cursor. Change records include archive metadata and entity IDs to re-fetch; `threads.deleted` tombstones mean that the entity is no longer available. Permanent deletion and cleanup operations require a signed-in human maintainer and are excluded from agent-key presets. Permission errors, revision conflicts, unavailable screenshots and invalid external links have explicit error codes and do not return ambiguous success text.

`discussion.like.changed` identifies the parent thread to re-fetch after an actual human vote change. Its public record has only `cursor`, `entityId`, `kind` and `createdAt`; actor/voter identity, reply ID and individual liked/unliked choice are omitted. Other event kinds retain their existing actor metadata. Export snapshots retain the counts captured when created. The shared registry exposes `threads.like` for discovery, but its human-session authorization rejects all agent tokens including owner delegation. Likes never constitute a response, resolution, delivery proof, importance change or permission grant, and do not change thread revisions.

The registry now covers all business input/output contracts and powers remote MCP, stdio and the JSON CLI. Only newly issued `ownerAdmin:true` keys can administer accounts, grants, projects and approved instructions; only a primary owner's delegation can access private member Markdown or guidance. Ordinary scoped keys never gain new permissions. Current owner/primary status and token lifecycle are checked inside the common transaction, and audits retain agent identity without sensitive bodies. See [API/CLI boundaries](api.md#json-cli-and-deliberate-identity-boundaries) for human votes, credential issuance, owner recovery and browser transport exceptions. Setup itself does not authorize account writes or private-note access.

## External GitHub Issue workflow

1. An authorized agent reads the relevant thread through MCP. A key explicitly granted `threads.issueDraft` can request a bounded, read-only draft. The draft excludes screenshots, diagnostics, private notes and reviewer policy; its text remains untrusted and needs a privacy/accuracy review.
2. After an agreed handoff, an agent with a separately granted, project-scoped `github.issueCreate` key can review the proposed title/body and create the Issue through Feedbacks MCP if the project's GitHub App is connected. The server reads the created Issue back and records a verified link. Eligible maintainers may separately opt into that scope in Account for projects they maintain. This scope is never added to existing keys or one-click Help setup, and an assignment's GitHub decision does not authorize issue creation.
3. Without the App or that scope, an agent may use its own separately authorized GitHub access, such as `gh`, then call `threads.linkIssue` with the actual Issue URL after readback.
4. Manual links are reported links; only a successful App readback is recorded as independently verified.
5. The agent records the final outcome/verification note and appropriate work status, with a useful fix link when available. Discussion replies are reserved for important blockers/decisions or explicitly requested updates; Issue/PR milestones do not require announcements. Resolution uses the caller's project permission and does not happen merely because an Issue link was supplied.

Incoming feedback never creates an Issue automatically. Feedbacks does not receive the developer's GitHub token. The optional GitHub App lets signed-in project maintainers use the web app and explicitly authorized agents use MCP. If a request is uncertain after an external write, the agent stops; a human maintainer inspects GitHub and reconciles it before another attempt.

## Assignment attribution

Durable thread/point assignments use `assignments.delegations/assign/cancel/history`; renewable current-worker claims use `assignments.list/claim/renew/release`. Both transports use the same scoped operations and server-derived member/agent attribution. Assignment category/tags and GitHub rationale describe the selected scope, without granting permission, starting a recipient agent or changing thread status. See [assignment contracts](api.md#durable-assignments-and-current-workers) and the [requested triage workflow](agents.md#requested-delegation-and-triage).

## Responsive view reconstruction

`M`, `T`, `D` and `W` act only in active review mode outside text inputs. The extension records both the selected preset and the measured viewport. Shared Feedbacks links restore that context in an authorized review window; the original website URL is preserved without adding internal feedback parameters. A page opened in a narrow desktop Chrome window is labelled a responsive preview, not an emulated mobile browser.

Resolved pins disappear on connected clients but stay discoverable under Show resolved. Reopen restores them. Other-device and unmatched-anchor threads remain accessible without placing misleading pins on the current layout.

## Protocol and client compatibility

Verified locally on 2026-09-28: runtime packages `@modelcontextprotocol/server` and `@modelcontextprotocol/node` 2.1.0 serve both [2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning) and initialization-based legacy clients. Remote HTTP uses the SDK's request classification and modern handler while preserving stateless JSON responses for legacy callers. Stdio uses the SDK's `serveStdio` entry point, which chooses the protocol era from the opening exchange. Both paths retain the same authenticated operation closure and full/compact tool profiles; no protocol version is invented by application code.

[HTTP integration tests](../tests/http.test.ts) use the real v2 client to assert modern negotiation, discovery, schema-bearing tools, guide access, authorized reads and denied writes. They exercise full and compact profiles over remote HTTP and both source and bundled stdio, while retaining v1 SDK clients and legacy initialization/JSON HTTP calls. [MCP result tests](../tests/agent-mcp.test.ts) cover native image blocks, text metadata and output schemas in both eras, plus modern input validation. These are SDK-level compatibility receipts; an installed Codex, Claude or Antigravity session and deployment acceptance remain separate checks.

The migration follows the official TypeScript SDK [v2 upgrade guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/upgrade-to-v2.md) and [2026-07-28 support guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/support-2026-07-28.md), accessed 2026-09-28. Feedbacks uses explicit bearer keys rather than implementing an OAuth authorization server; protocol support is not a claim to implement every optional MCP capability or OAuth flow.

The small catalog, bounded reads, shared operation contracts and executable checks apply the progressive-disclosure and environment-validation principles in [OpenAI harness engineering](https://openai.com/index/harness-engineering/). They are not a guarantee that every small model or client succeeds. See the tracked workflow plan for measured fixtures and verification boundaries.
