# Agent-facing feedback contract

Exact schemas and callable operation names are in the [API reference](api.md). The HTTP integration tests exercise protocol initialization, tool discovery and authorized calls. Deployment acceptance is a separate operator check.

## Independent status dimensions

| Dimension      | States / data                                                                      | Changes pin visibility?                     |
| -------------- | ---------------------------------------------------------------------------------- | ------------------------------------------- |
| Response       | `unanswered`, `responded`, `needs-follow-up`; last request/response actor and time | No                                          |
| Work           | `open`, `in_progress`, `ready_for_review`, `resolved`, `declined`                  | Resolved and declined hide by default       |
| Review         | Open round, human approval, or changes requested with attributed history           | No                                          |
| External issue | No link, or one/more supplied GitHub Issue URLs with provenance                    | No                                          |
| Fix evidence   | Attributed commit/PR/variant/incorporated-in URL and note                          | Only an authorized resolution hides the pin |

An Issue being closed is not proof that a deployed UI is fixed. A reply is not a fix. A failed write never changes either status or pin visibility optimistically without a recoverable pending/error state.

## Structured result

The transport returns `structuredContent` with an explicit output schema and a short text summary. A thread read or successful mutation includes:

- `id`, `projectId`, `revision`, `createdAt` and `updatedAt`.
- `response`: state, last human request, last response, actor and time.
- `work`: current state and attributed state-change history; resolution requires a note.
- `review`: current round, decision state and attributed history. Older export snapshots may not contain this field. Human sign-off is independent of work status; agent tokens cannot write it.
- `externalIssues`: URL, repository, issue number, linked-by actor, link time and optional reported creation time. Manual links have `verification:"reported"`; an optional human-operated GitHub App connection records `github_verified` and can read open or closed state. Neither kind changes work status.
- `fixEvidence`: attributable commit/PR/variant/incorporated-in links and notes. A supplied URL is not proof that the target is deployed or verified.
- `pins.defaultVisible`: resolved/declined/archived pins are hidden by default. Original context and client anchor match remain separate.
- `context`: sanitized target URL, requested preset, actual viewport, pixel ratio, scroll, capture dimensions and bounded element anchor metadata.
- `view`: view fingerprint, raw unique likes, caller preference and discussion count; authorized internal policy data is separate.
- `likes:{uniqueLikes,liked}` on original feedback and every reply: independent discussion-message aggregates. Agents read counts with `liked:false`, never voter lists. Existing view likes and most-liked-view sorting remain separate.
- `assets`: opaque asset IDs and authenticated proxy paths. Fetch with the same authorized cookie or bearer token; there is no public object URL.
- `trust: "untrusted_discussion"`, author, replies and last actor. Approved instructions use a different trust marker and operation.
- With `context.policy`, `reviewerContext` carries `trust:"owner_approved_advisory_reviewer_context"` and items `{userId,name,guidance,revision,policy,policyVersion}` associated with stable thread and reply author identities. This is advisory reviewer context, not discussion or project instructions. Private notes never enter this result.

Use `context.reviewers {projectId}` with both `context.reviewers` and `context.policy` scopes to read current guidance and dimension importance. It is restricted to project members and actual feedback/reply authors. A `reviewer.guidance.changed` event in `context.changes` indicates that current guidance should be fetched; an export snapshot retains its historical values. Ordinary scoped keys cannot edit guidance, read private notes or administer users. Explicit owner-admin keys can administer users; only a primary owner's delegation can read/write private notes and edit guidance. Language, age and family relationship are never automatic grounds to discount feedback. Owner login links are full browser credentials and must never be substituted for MCP bearer tokens.

Project reads expose caller-specific project permissions; they are not duplicated as an invented per-thread permissions object. Context exports carry `schemaVersion`, a stable paginated snapshot and a change cursor. Change records include archive metadata and entity IDs to re-fetch; there is no HTTP hard-delete operation. Permission errors, revision conflicts, unavailable screenshots and invalid external links have explicit error codes and do not return ambiguous success text.

`discussion.like.changed` identifies the parent thread to re-fetch after an actual human vote change. Its public record has only `cursor`, `entityId`, `kind` and `createdAt`; actor/voter identity, reply ID and individual liked/unliked choice are omitted. Other event kinds retain their existing actor metadata. Export snapshots retain the counts captured when created. The shared registry exposes `threads.like` for discovery, but its human-session authorization rejects all agent tokens including owner delegation. Likes never constitute a response, resolution, delivery proof, importance change or permission grant, and do not change thread revisions.

The registry now covers all business input/output contracts and powers remote MCP, stdio and the JSON CLI. Only newly issued `ownerAdmin:true` keys can administer accounts, grants, projects and approved instructions; only a primary owner's delegation can access private member Markdown or guidance. Ordinary scoped keys never gain new permissions. Current owner/primary status and token lifecycle are checked inside the common transaction, and audits retain agent identity without sensitive bodies. See [API/CLI boundaries](api.md#json-cli-and-deliberate-identity-boundaries) for human votes, credential issuance, owner recovery and browser transport exceptions. Setup itself does not authorize account writes or private-note access.

## External GitHub Issue workflow

1. An authorized agent reads the relevant thread through MCP. A key explicitly granted `threads.issueDraft` can request a bounded, read-only draft. The draft excludes screenshots, diagnostics, private notes and reviewer policy; its text remains untrusted and needs a privacy/accuracy review.
2. After an agreed handoff, an agent with a separately granted, project-scoped `github.issueCreate` key can review the proposed title/body and create the Issue through Feedbacks MCP if the project's GitHub App is connected. The server reads the created Issue back and records a verified link. This scope is never added to existing keys or the one-click owner setup.
3. Without the App or that scope, an agent may use its own separately authorized GitHub access, such as `gh`, then call `threads.linkIssue` with the actual Issue URL after readback.
4. Manual links are reported links; only a successful App readback is recorded as independently verified.
5. The agent replies to the thread and later supplies fix evidence. Resolution uses the caller's project permission and does not happen merely because an Issue link was supplied.

Incoming feedback never creates an Issue automatically. Feedbacks does not receive the developer's GitHub token. The optional GitHub App lets signed-in project maintainers use the web app and explicitly authorized agents use MCP. If a request is uncertain after an external write, the agent stops; a human maintainer inspects GitHub and reconciles it before another attempt.

## Responsive view reconstruction

`M`, `T`, `D` and `W` act only in active review mode outside text inputs. The extension records both the selected preset and the measured viewport. Shared Feedbacks links restore that context in an authorized review window; the original website URL is preserved without adding internal feedback parameters. A page opened in a narrow desktop Chrome window is labelled a responsive preview, not an emulated mobile browser.

Resolved pins disappear on connected clients but stay discoverable under Show resolved. Reopen restores them. Other-device and unmatched-anchor threads remain accessible without placing misleading pins on the current layout.
