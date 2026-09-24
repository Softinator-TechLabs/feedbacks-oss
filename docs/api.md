# Feedbacks API contract, schema version 1

Example server origin (replace with your deployment): `https://feedback.example.com`. Every operation is **POST `/api/<dotted-name>`**, with JSON input. Success is `{ "ok": true, "data": ... }`; errors are `{ "ok": false, "error": { "code": "FORBIDDEN", "message": "..." } }` and use HTTP 400/401/403/404/409/410/413/429/503. Do not infer success from HTTP alone. Zod input/output registries live in `src/shared/contracts.ts`; unknown object fields are stripped. All IDs are UUIDs; revisions are positive integers; timestamps are ISO UTC. Pagination defaults to 30 and is capped at 100.

## Web session

`auth.login {email,password}` accepts an email or legacy username alias in `email`, case-insensitively, and requires `Origin` equal to `APP_ORIGIN`. It sets a HttpOnly, SameSite=Strict session cookie (Secure in production) and returns `{actor,csrf,expiresAt}`. Passwords are minimum 10 characters when set. `auth.acceptInvite {token,name,password}` returns `{accepted:true}`; then sign in. New invite links are `/invite#token=...` and expire after 7 days, single use; old query links remain accepted. The browser removes the capability from its URL immediately and retains it only in component memory until explicit submission.

After a page reload, call `auth.me {}` with the cookie and same origin; it returns `{actor,projects,csrf}` and renews the CSRF value. Keep that value in memory. All other cookie operations require header `X-CSRF-Token: <csrf>` and the app's origin. `auth.logout {}` revokes the current session. `auth.changePassword {currentPassword,password}` requires a different password and revokes all browser sessions, agent/extension tokens, approved pairings and account links; returns `{changed:true,signInRequired:true}`. Pre-existing accounts already marked `mustChangePassword:true` retain that state; `auth.me` returns no projects and only password change/logout are available until replacement. Private image reads and MCP are also blocked.

```js
let csrf;
export async function api(operation, input = {}) {
  const r = await fetch(`/api/${operation}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(csrf ? { "X-CSRF-Token": csrf } : {}),
    },
    body: JSON.stringify(input),
  });
  const result = await r.json();
  if (!result.ok) throw Object.assign(new Error(result.error.message), result.error);
  if (result.data.csrf) csrf = result.data.csrf;
  return result.data;
}
```

`actor` exposes `{id,userId,name,kind,owner,primaryOwner?,mustChangePassword?}`. Agent identities have a distinct id; extension identity maps to its human user. Current session existence, user status, token revocation and project grants are checked on every operation. Web `owner` is false for non-human credentials.

### Account administration and recovery

Owner administration operations (human owner or explicitly delegated owner-admin agent; primary-owner checks still apply):

| Operation                                      | Input                                                        | Result                                                                                               |
| ---------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `members.create`                               | `{name,email,password,username?,grants?:[{projectId,role}]}` | `{id}`; assigned password is hashed, never returned; `username` is legacy API compatibility only     |
| `members.resetPassword`                        | `{userId,password?}`                                         | `{updated:true}` with an assigned password, or `{updated:true,resetPath,expiresAt}` for a reset link |
| `members.owner`                                | `{userId,owner:boolean}`                                     | `{updated:true}`; primary owner only                                                                 |
| `members.notes.get` / `members.guidance.get`   | `{userId}`                                                   | `{body,revision}`; primary owner only                                                                |
| `members.notes.save` / `members.guidance.save` | `{userId,body,revision}`                                     | `{body,revision}`; primary owner only, 4000-character limit, initial revision 0                      |

New account forms use email as the login and do not create username aliases. The optional `username` field remains API-only compatibility for legacy clients and saved aliases: 3–40 ASCII letters/digits/dots/underscores/hyphens, no `@`, and case-insensitively unique. Duplicate identities return `CONFLICT` and forms preserve drafts. No accounts are automatically seeded. All projects currently listed in the create form are selected with Maintainer by default; those UI defaults do not grant future projects, and explicit deselection or role edits are authoritative. Invite and new-grant forms also start at Maintainer; saved grant roles are not changed. Owner is organization-level; project roles are unchanged. Migration 2 records the earliest existing owner as immutable primary identity; bootstrap records it for a new installation. Only that identity can promote/demote co-owners. Co-owners cannot reset, disable or change the primary owner through generic member operations. The primary owner cannot self-disable or demote, preventing last-owner lockout. Disabling or changing owner status revokes credentials.

Private notes live in a separate table and endpoint. Their bodies are absent from member lists, events, exports, reviewer context and other owners' responses. Only a primary-owner human or their explicitly delegated owner-admin agent can use the notes get/save tools. Note access and account operations record action/target/agent identity without password, capability or Markdown payloads. Guidance lives separately and may be disclosed to authorized agents; neither field grants permissions. The editor renders a safe Markdown subset (headings, bold, code, links and paragraphs), escapes HTML and never loads remote images. Unsupported syntax remains literal.

Reset issuance immediately revokes existing credentials. A supplied assigned password can be used immediately and does not require replacement. With no password, issuance also invalidates the old password and returns `/reset#token=...`; manually deliver this seven-day, single-use link. No email is sent. Public origin-checked `auth.resetPassword {token,password}` explicitly consumes it by POST and returns `{changed:true,signInRequired:true}`. Tokens are hashed; replay, expiry, revocation and disabled accounts fail. GET never authenticates or consumes a capability. Credential changes, login, pairing exchange and domain operations serialize through one transaction advisory lock, with current authentication read after acquisition under READ COMMITTED; this prevents a waiting issuance request from undoing revocation. This trades service write concurrency for clear account security boundaries.

### Owner sign-in links

Account offers `account.links.create {}`, returning `{id,loginPath,expiresAt}` once. It requires an active authenticated human owner web session plus the normal origin and CSRF protections, but does not reconfirm the account password. It always targets the caller's own identity; no target-user parameter is accepted. Links use `/owner-login#token=...`, expire in seven days and work once. The user must explicitly press **Create owner link**; navigating to the account page does not create one. The recipient must then press the explicit sign-in button, which calls public origin-checked `auth.consumeLoginLink {token}`; success establishes a full owner browser session with the same `{actor,csrf,expiresAt}` shape as login. This grants full owner access, not a scoped MCP token or authorization for production changes. The UI warns before copying.

`account.links.list {}` returns own link metadata `{items:[{id,expiresAt,usedAt,revokedAt}]}` without secrets. `account.links.revoke {linkId}` returns `{revoked:true}` and also deletes any session established by that link. Expired, consumed, revoked, deactivated, demoted and forced-password-change accounts fail consumption. Password changes/reset, disabling and demotion revoke links and sessions. Seven-day single-use is the conservative implementation default; no reusable-link preference was confirmed.

### Private help

`GET /help` (including trailing slash) requires a browser session; anonymous requests redirect to sign-in with exact `/help` return. `GET /api/help` serves the internal static HTML only to an authenticated human browser session with `Cache-Control: no-store`; bearer/extension/agent requests are denied. Help instructions are compiled only into the server, absent from public web chunks. `/privacy`, health endpoints, sign-in assets and extension downloads remain public. Capability and help responses use no-store and no-referrer.

## Projects and members

| Operation         | Input                                                                                 | Returned data                                                           |
| ----------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `projects.list`   | `{}`                                                                                  | `{items:Project[]}`                                                     |
| `projects.get`    | `{projectId}`                                                                         | `Project`                                                               |
| `projects.create` | `{name,origins:["https://example.org"],captureMode?:"origins"\|"any",repositoryUrl?}` | `Project`; owner web account                                            |
| `projects.update` | `{projectId,revision,name,origins,captureMode?:"origins"\|"any",repositoryUrl?}`      | fresh `Project`; maintainer; only a human owner may change capture mode |
| `members.list`    | `{projectId?}`                                                                        | `{items:Member[]}`; global list owner-only                              |
| `members.invite`  | `{email,projectId,role}`                                                              | `{token,expiresAt,invitePath}`; owner only, display secret once         |
| `members.grant`   | `{projectId,userId,role,canResolve?:false,remove?:false}`                             | `{updated:true}`; owner only                                            |
| `members.update`  | `{userId,name,active,classification,expertise:string[],policy}`                       | `{updated:true}`; owner only                                            |
| `members.policy`  | `{projectId,userId,policy:null\|Policy}`                                              | `{updated:true}`; owner only                                            |

`Project={id,name,origins,captureMode?,repositoryUrl,revision,permissions:{role,canWrite,canMaintain,canResolve}}`. Missing `captureMode` means `origins`. Origins mode requires at least one exact HTTP(S) origin with no path, query or trailing slash; localhost origins must be added explicitly. Any mode may use an empty origins list and accepts any credential-free HTTP(S) contextual URL while retaining project grants and token scope enforcement. Existing projects are never widened automatically. Roles: `maintainer`, `reviewer`, `viewer`. `classification` is `employee|external`. `Policy={general:number,visualDesign?:number,productWorkflow?:number,usabilityAccessibility?:number}`; numbers range 0–10, neutral default 1. Member rows use `id,name,active,owner,role,can_resolve` and owner-only `email,classification,expertise,policy,policy_version,project_policy`. Weighting is independent of permissions and hidden from ordinary reviewers.

## Capture context and threads

The minimum `Context` is `{url,viewport:{width,height},devicePixelRatio?:1}`. Optional fields: `title`, `scroll:{x,y}`, `preset:mobile|tablet|desktop|wide|custom`, `requestedSize:{width,height}`, `captureDimensions:{width,height}`, `capturedAt`, `anchor:{selector?,fingerprint?,recordIdentity?,confidence?:element|coordinate-only|unmatched,point?:{x,y},rect?:{x,y,width,height},screenshotPoint?:{x,y},styles?:{fontFamily?,fontSize?,color?,backgroundColor?}}`. Width/height are actual CSS viewport pixels; point coordinates should be normalized to their element. Do not submit arbitrary DOM/form values. Sensitive query keys and every fragment are removed server-side; the extension must redact before transmission too. Server returns `origin,hostname,domain,subdomain,port,path,deviceClass,fingerprint`; `domain` is the registrable domain where one exists, while localhost and IP addresses remain intact. Fingerprints bind normalized URL, device class, safe record identity and element fingerprint/selector.

Both boundaries remove query names containing token, secret, password, passwd, auth, session, cookie, email, key, code, signature, jwt or credential (case insensitive); legitimate parameters such as `variant` remain sorted. The extension uses sanitized URL for route identity and independent hashed record identity for anchors. Selected evidence survives unmatched confidence; opaque evidence IDs keep unkeyed selections distinct without claiming relocation. A capture without a selected element records the viewport center as its coordinate fallback. The service also includes screenshot point and scroll in view identity when no fingerprint/selector exists. Older anchor versions remain readable through thread/unmatched lists but are not automatically relocated by the newer resolver.

| Operation            | Input                                                                                                               | Returned data                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------- |
| `threads.create`     | `{projectId,body,context                                                                                            | document:{documentId,page,x,y},category?:general,idempotencyKey}`      | full `Thread` |
| `threads.list`       | `{projectId,limit?:30,offset?:0,search?:"",sort?:activity,showResolved?:false,url?,domain?,hostname?,deviceClass?}` | `{items:Thread[],total,nextOffset,websiteFilters:{domains,hostnames}}` |
| `threads.get`        | `{threadId}`                                                                                                        | full `Thread`                                                          |
| `threads.issueDraft` | `{threadId}`                                                                                                        | bounded, read-only Issue draft; explicit new token scope               |
| `threads.like`       | `{threadId,replyId?,liked:boolean}`                                                                                 | `{threadId,replyId:null\|UUID,uniqueLikes,liked}`                      |
| `threads.reply`      | `{threadId,revision,body,intent?:request\|response,idempotencyKey,mentions?:UUID[]}`                                | fresh `Thread`                                                         |
| `threads.status`     | `{threadId,revision,state,note?,duplicateOf?}`                                                                      | fresh `Thread`                                                         |
| `threads.review`     | `{threadId,revision,decision:approved\|changes_requested\|reopen,note?}`                                            | fresh `Thread`; signed-in human project writer only                    |
| `threads.linkIssue`  | `{threadId,revision,url,createdAt?}`                                                                                | fresh `Thread`                                                         |
| `threads.evidence`   | `{threadId,revision,url,note,kind?:incorporated_in}`                                                                | fresh `Thread`                                                         |
| `threads.archive`    | `{threadId,revision,archived}`                                                                                      | fresh `Thread`; maintainer only                                        |
| `views.get`          | `{projectId,context}`                                                                                               | `{fingerprint,uniqueLikes,liked,discussionCount,weightedPreference?}`  |
| `views.like`         | `{projectId,context,liked:boolean}`                                                                                 | same view data, one like per human per view/target                     |

`category` is `general|visualDesign|productWorkflow|usabilityAccessibility`. Sort is `newest|activity|likes`; deviceClass is `mobile|tablet|desktop` (<600, <1000, >=1000 actual width). `state` is `open|in_progress|ready_for_review|resolved|declined`. Resolved/declined requires a nonempty note and permission. Human review decisions are independent of status; reopening starts a new round. `kind` for evidence is `commit|pull_request|variant|incorporated_in`. Issue URL must be `https://github.com/OWNER/REPO/issues/NUMBER`. Manual `threads.linkIssue` links remain `reported`. The optional GitHub App path verifies created Issues through GitHub readback and records `github_verified` without changing thread work status.

## Optional GitHub App

Set `GITHUB_APP_ID`, `GITHUB_APP_SLUG` and `GITHUB_APP_PRIVATE_KEY_BASE64` together on the server. The key is a base64-encoded RSA private key and belongs only in deployment secrets. Grant the App repository metadata read and Issues read/write, then install it on the intended repository. In project settings, save an exact `https://github.com/OWNER/REPO` URL and select **Verify and connect**. Existing MCP agent handoff needs none of these settings.

Connection and recovery operations require an authenticated human web session; agent and extension tokens cannot invoke them. `github.connection {projectId}` reports setup status and an installation URL. `github.connect {projectId,revision}` checks installation and Issues write permission. `github.disconnect {projectId,revision}` stops new native writes while preserving historical Issue links. `github.issueState {threadId}` returns `none|pending|linked` and the linked URL when available.

To create an Issue, first read `threads.issueDraft {threadId}`, review and edit the title/body for accuracy and private content, then call `github.issueCreate {threadId,revision,reviewed:true,title,body,idempotencyKey}`. A signed-in human project maintainer can use the web interface. An agent may use the same operation through MCP only when a human owner issues a project-scoped key with the optional `github.issueCreate` scope. Existing keys and the one-click owner setup do not gain that scope. The GitHub App must already be installed and connected to the project repository. One native Issue request is allowed per thread. The server reserves the request before GitHub is called. A network failure or interrupted readback leaves it `pending`; repeating the request never sends another POST. Inspect the repository and ask a human maintainer to call `github.issueReconcile {threadId,revision,issueUrl}` for the actual Issue with the matching request marker, or, only after confirming no Issue exists and the ten-minute settlement window has passed, `github.issueAbandon {threadId,revision,confirmedAbsent:true}`. `github.issueState` reports when abandonment is available. `github.issueRefresh {threadId,revision,issueUrl}` reads current GitHub open/closed state for an already verified link, even if the project repository later changes. It does not change Feedbacks work or review status. Source: `src/server/github-operations.ts` and `tests/github-app.test.ts`.

Discussion likes are independent of view likes. Current thread get/list and new exports include `likes:{uniqueLikes,liked}` on the original feedback and on every reply. Counts are distinct human users, without voter lists; agents read the counts with `liked:false`. Existing export snapshots retain their historical aggregates rather than being rewritten as votes change; pre-migration snapshots may omit these new fields. `threads.like` requires an active human web session and current project write permission; agent and extension tokens cannot vote. `replyId` must belong to the authorized thread. No `userId` is accepted as vote authority. Set `liked:true` or `liked:false` explicitly: repeating an identical request is idempotent, including retry after an uncertain response. A changed vote emits `discussion.like.changed` for the parent thread in `context.changes`; an identical set emits no event. Likes do not alter thread revision, timestamps, work/response state, pin visibility, importance or reply drafts. Migration 3 adds separate discussion vote storage; no view likes are copied. The existing `sort:"likes"` still means **most liked views**, not most liked messages.

Public `discussion.like.changed` records contain only `cursor`, parent `entityId`, `kind`, and `createdAt`: no voter actor, reply ID or individual liked/unliked choice. Re-fetch the parent for current aggregates. Internal audit attribution is retained; other public change-event kinds keep their existing actor metadata.

Idempotency keys are 8–200 characters: preserve input including revision when retrying the exact same operation; a reused key with changed input returns `IDEMPOTENCY_CONFLICT`. Each successful mutation returns the current authoritative thread; replace local state with it. A stale revision returns `CONFLICT` (409), then fetch/review before trying a new mutation. Status changes and linked Issues are not responses and never imply a verified fix.

Reply `intent` is `request|response`. Any authorized human participant (including extension identity) can request follow-up or explicitly respond, independently of the original reporter. Omitted intent defaults to `request` for humans and `response` for agents; agents cannot label a message as a human request. The web form presents both choices and defaults to request. New replies retain resolved intent in their output. HTTP and MCP use the same schema and defaults.

Legacy migration is conservative and performed on reads: historical human replies without intent are treated as requests, historical agent replies as responses. Response state and actor/timestamps are reconstructed in reply order; no bulk database rewrite or historical work/status/evidence change occurs. A human request after a response produces `needs-follow-up`; before any response it remains `unanswered`. Existing integrations that intentionally post human answers must send `intent:"response"` on new operations. An uncertain retry must retain its original omitted/explicit intent and idempotency key; do not add intent to an already-sent attempt.

```json
{
  "id": "UUID",
  "projectId": "UUID",
  "revision": 3,
  "body": "Please adjust the heading",
  "category": "general",
  "context": {
    "url": "https://example.org/",
    "viewport": { "width": 1440, "height": 900 },
    "deviceClass": "desktop",
    "fingerprint": "sha256"
  },
  "author": {
    "id": "UUID",
    "userId": "UUID",
    "name": "Reviewer",
    "kind": "human"
  },
  "response": {
    "state": "responded",
    "lastHumanRequest": { "actor": {}, "at": "ISO" },
    "lastResponse": { "actor": {}, "at": "ISO" }
  },
  "work": { "state": "open", "history": [] },
  "externalIssues": [
    {
      "url": "https://github.com/org/repo/issues/12",
      "repository": "org/repo",
      "number": 12,
      "verification": "reported",
      "linkedBy": {},
      "linkedAt": "ISO",
      "reportedCreatedAt": null
    }
  ],
  "fixEvidence": [],
  "pins": { "defaultVisible": true },
  "lastActor": {
    "id": "UUID",
    "userId": "UUID",
    "kind": "agent",
    "name": "UI agent"
  },
  "replies": [
    {
      "id": "UUID",
      "body": "Looking into this",
      "author": {},
      "mentions": [],
      "trust": "untrusted_discussion",
      "createdAt": "ISO"
    }
  ],
  "assets": [],
  "view": {
    "fingerprint": "sha256",
    "uniqueLikes": 1,
    "liked": false,
    "discussionCount": 1
  },
  "archived": false,
  "trust": "untrusted_discussion",
  "createdAt": "ISO",
  "updatedAt": "ISO"
}
```

`response.state` is `unanswered|responded|needs-follow-up`. Resolved/declined or archived pins default to hidden; reopening restores visibility. Fetch list/changes every 15 seconds while visible to synchronize other clients. Approved fixed history remains even if response becomes needs-follow-up. Authorized policy contexts additionally contain `importance.feedbackTime` and `importance.current` with policy and policyVersion; views add weightedPreference separately from raw uniqueLikes.

## Project guest feedback links

`guestProjectLinks.create {projectId,label,expiresInDays?,maxSubmissions?}`, `guestProjectLinks.list {projectId}` and `guestProjectLinks.revoke {linkId}` require a signed-in project maintainer. Creation returns a one-time token and `/guest-project#token=...` path. The database stores only its hash. Links expire after 1 to 30 days, permit 1 to 50 submissions and can be revoked. At most ten unexpired links with remaining capacity may be active for a project. Listing returns labels, expiry, revocation and counts, never tokens.

Public same-origin `guestProject.inspect {token}` returns only the project name, expiry and Turnstile site key. `guestProject.submit {token,name,url,body,turnstileToken}` verifies a `guest_project_submit` Turnstile token server-side, enforces the project's approved website origins and creates one new untrusted guest thread. It returns `{posted:true}` without any thread content. Expiry, revocation and capacity are checked again inside the write transaction. These operations do not grant access to existing threads, screenshots, private notes or reviewer guidance. The form has no screenshot or target-page viewport; the stored viewport is marked unknown.

## Private attachments and documents

`assets.uploadVideo {threadId,revision,videoBase64,durationMs,idempotencyKey}` accepts a user-approved WebM recording of at most 8 MiB and a declared duration of at most 30 seconds. The extension enforces the recording timer and previews locally before sending; the server bounds bytes and checks the WebM header, but does not independently measure duration. It stores the original clip under a private project key and rechecks current thread authorization and revision after object storage writes. Existing paired extension tokens use their `assets.upload` grant for this operation. `assets.get` returns metadata for videos; `includeImage:true` is only for images. The authenticated `/api/assets/:id` route serves WebM to authorized users. Retention and backups follow the deployment operator's policy.

Project documents use `documents.upload {projectId,name,fileBase64,idempotencyKey}`. Only a signed-in human project maintainer can upload; the server accepts canonical base64 for a PDF, PNG, JPEG or WebP up to 8 MiB, checks PDF parsing and its 1–25 page count, and normalizes images to WebP. The response has `{id,projectId,name,kind,contentType,pageCount,bytes,createdAt,url}` and page dimensions when available. `documents.list {projectId}`, `documents.get {documentId}` and `documents.threads {documentId}` require current project access. The private source path `/api/documents/:id/file` requires a current cookie or bearer token with `documents.get` scope and serves downloads with `Cache-Control:no-store` and `Content-Disposition:attachment`. A document-scoped `threads.create` requires exactly one of `context` and `document`; coordinates are normalized from 0 to 1 and the page must belong to that document. All document threads remain ordinary discussions. Existing scoped token presets are unchanged; a new key needs explicit document read scopes. Guest links cannot access documents.

## Private screenshots

`assets.upload {threadId,revision,imageBase64,rendition?:annotated,idempotencyKey}` accepts raw standard base64 or a PNG/JPEG/WebP data URI, maximum 10 MiB decoded. `rendition=screenshot|annotated|thumbnail`. It validates decoding, <=40M pixels and <=12000 pixels per side, strips metadata, flattens to WebP and stores an opaque private key. Returns `{asset:{id,captureId,rendition,width,height,bytes,contentType,createdAt,url},thread:Thread}`. Submit approved/redacted pixels only. If upload fails, preserve the draft and exact retry input. No unvalidated asset is readable. After an explicit `CONFLICT`, the extension fetches the current thread and persists a new upload attempt with its revision, a new idempotency key and the unchanged approved pixels. Retry Send submits that durable attempt. Network errors, lost acknowledgements and other errors preserve the exact prior attempt, because upload success may be unknown; idempotency lookup precedes revision checking.

Capture failure retains a local context-only draft, the actual failure message and the comment. The editor offers sending without an image and retrying native capture on the original page; route changes require a fresh draft. Rejected, mismatched or oversized pixels are never kept as the recovery image. Closing the editor or restarting the browser retains this context-only draft; a missing original tab still permits text-only submission.

`assets.get {assetId}` returns the same metadata plus `projectId,threadId,url`. URL is the authenticated relative proxy `/api/assets/UUID`. Web `<img>` requests use the session cookie; extension/agents fetch with `Authorization: Bearer ...` and can use a local blob URL. Never send credentials to the target page. No public bucket URL or long-lived signed link is returned. Asset responses and API reads use `Cache-Control:no-store`.

For agent viewing, call `assets.get {assetId,includeImage:true,maxDimension:1600}`. The optional preview preserves aspect ratio without enlarging the original, accepts a maximum dimension of 256–2048 pixels, and caps encoded WebP at 2 MiB. Original metadata and stored files are unchanged. HTTP and JSON CLI return an optional `image:{data,mimeType,width,height}` (base64 data); remote and stdio MCP emit it as a native image content block, without duplicating base64 in structured metadata. Default calls remain metadata-only. Authorization uses the same `assets.get` scope and live project/credential checks; private storage and resizing run after the account transaction is released. A previously authorized in-flight read may finish after revocation, as with the original-image proxy.

CLI discovery: `npm run --silent cli -- --describe assets.get` includes input/output schemas and image retrieval guidance. Pipe `{"assetId":"UUID","includeImage":true}` to `npm run --silent cli -- assets.get` using the existing private credential configuration. Consume the base64 image as private media; do not log whole image responses or put credentials in command arguments. Thread reads and snapshot exports now declare attachment metadata in their schemas; follow `assets.get` for pixels. For current uploads use activity sorting/change cursors and refetch the changed thread. Refresh `context.reviewers` after a guidance change rather than relying on an old export snapshot.

Image-byte requests recheck current credential lifecycle, `assets.get` scope and project access under the account transaction lock, including delegated owners' current/future project access. Storage reads happen after authorization without holding that lock. Revocation denies new requests; an already authorized in-flight image read may finish.

## Instructions, context and agent tokens

| Operation              | Input                                                                                             | Returned data                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `instructions.get`     | `{projectId}`                                                                                     | `{trust:"approved_project_instructions",revision,items:[{id,version,body,actor,createdAt}]}` newest version first |
| `instructions.publish` | `{projectId,revision,body}`                                                                       | same data; human maintainer or delegated owner agent, initial revision 0                                          |
| `context.export`       | `{projectId,limit?:30,offset?:0,snapshotId?}`                                                     | `{schemaVersion,project,approvedInstructions,discussionTrust,cursor,items:Thread[],snapshotId,total,nextOffset}`  |
| `context.changes`      | `{projectId,cursor?:"0",limit?:50}`                                                               | `{schemaVersion,items:[{cursor,entityId,kind,actor,createdAt}],cursor,hasMore}`                                   |
| `tokens.list`          | `{}`                                                                                              | `{items:[{id,name,kind,projects,scopes,canResolve,expiresAt,revokedAt}]}`                                         |
| `tokens.create`        | `{name,projectIds?:UUID[],scopes:string[],expiresInDays?:30,canResolve?:false,ownerAdmin?:false}` | `{id,name,kind,token,expiresAt,ownerAdmin}`; human owner only, token shown once                                   |
| `tokens.revoke`        | `{tokenId}`                                                                                       | `{revoked:true}`; token's owner or web owner                                                                      |

Exports have stable 15-minute snapshot pages; pass the returned snapshotId for subsequent offsets. Membership is rechecked on every page. Changes carry metadata only: re-fetch the referenced entity for current authorized contents; archive changes remain visible. Hard purge is deliberately operator-only and no HTTP purge exists. New exports are bounded to 1000 threads, 5000 replies, 4 MiB of stored source content and 8 MiB of serialized output. Active snapshots are capped at four per user (across that user's tokens), eight per project, 24 per deployment and 64 MiB total. New attempts have shared database-backed one-minute budgets of 12/user, 24/project and 60/deployment; failed construction consumes its attempt. Reuse snapshotId for later pages. Limits return EXPORT_CAPACITY or EXPORT_RATE_LIMITED (429), or EXPORT_TOO_LARGE (413); use incremental changes for larger projects. Expired snapshots are removed on new exports and by a one-minute maintenance sweep. Discussion is untrusted data and does not authorize actions. Only explicit approved instructions are project instructions.

Ordinary agent scopes: `projects.list`, `projects.get`, `threads.list`, `threads.get`, `threads.reply`, `threads.status`, `threads.linkIssue`, `threads.evidence`, `assets.get`, `instructions.get`, `context.export`, `context.changes`, `context.reviewers`, `views.get`; optional `context.policy` allows internal importance and reviewer guidance. Optional `github.issueCreate` permits a native external GitHub write only for explicitly named projects after the App is connected. `context.reviewers {projectId}` requires both its operation scope and `context.policy` for ordinary agents and returns `{trust:"owner_approved_advisory_reviewer_context",items:[{userId,name,guidance,revision,policy,policyVersion}]}`. It includes only project members or actual thread/reply authors, not an organization directory. Full threads and export items restrict reviewer context to their actual authors. Read current guidance after `reviewer.guidance.changed`; exports remain snapshot-time. Guidance is advisory, distinct from untrusted discussion and approved project instructions. Ordinary tokens last 1–90 days, require at least one named project, cannot edit notes/guidance or administer accounts, and default to `canResolve:false`.

Explicit new `ownerAdmin:true` issuance by a human owner grants the shared business scopes plus `context.policy`, resolution and all current/future projects (an empty initial project list is valid). It does not implicitly grant `github.issueCreate`; use a separate scoped key for that external write. Supplied project IDs are checked but do not restrict this full-owner capability; stored token metadata has `ownerAdmin:true` and `projects:[]` meaning organization-wide access. Scopes are a fixed issuance-time snapshot; migration 4 defaults all old and extension keys to `ownerAdmin:false`. Live account activity, owner status, primary-owner identity, expiry and revocation are rechecked on every operation. `auth.me.actor.ownerAdmin` distinguishes delegation while `actor.owner` remains the human-web flag. Token listing includes `ownerAdmin`; agent audit attribution retains distinct token id plus issuing user id. Only a primary-owner delegation can read/write private member Markdown or guidance and promote/demote owners. Key revocation/expiry stops that credential; durable authorized account, grant and content changes are not undone.

## JSON CLI and deliberate identity boundaries

`npm run --silent cli -- --list` lists every business operation and mutation hint; `--describe members.create` returns its exact JSON schemas. `npm run --silent cli -- projects.list` reads JSON from stdin (empty means `{}`); append `--input /private/path/input.json` for a file. After a server build, `node dist/cli/feedbacks.js` is equivalent. Supply `FEEDBACKS_TOKEN` through a private environment or an owned mode-0600 `~/.config/feedbacks/config.json` containing `{url,token}`. `FEEDBACKS_CONFIG` selects another private config; `FEEDBACKS_URL` overrides the server origin. Secrets never belong in command arguments. Stdout is exactly `{ok:true,data}` or `{ok:false,error:{code,message}}`; failures exit nonzero. Protect stdout/files when reading private notes, invitations or reset capabilities. CLI and stdio use the same HTTPS client, reject redirects, and allow HTTP only on loopback.

MCP/CLI discover the shared business registry: projects, members (including grants, policy, notes and guidance), instructions, threads, assets, views, context, token management and existing owner-link list/revoke. All delegate to the same typed service methods as HTTP. Tool discovery does not grant permission: ordinary keys retain their original scopes.

Exceptions are explicit: login, invitation acceptance, recovery consumption, logout/password change, primary bootstrap, device pairing and owner sign-in-link creation remain their existing authentication/session flows. Agents cannot mint any descendant token, approve browser/device sessions or issue owner sign-in links. Owner credential resets require a human owner session; delegated agents may reset ordinary member credentials. Token creation remains a discoverable business operation requiring human issuance; list/revoke work for owner agents. `threads.like` and `views.like` are discoverable but deny agents because votes represent humans; agent replies cannot use human-request intent. Browser installation, screenshot capture and image-byte download remain browser/HTTP transport; MCP supports thread creation and validated image upload/read metadata, not browser emulation. An owner-admin key is powerful enough to create durable accounts and grants; these restrictions do not make its effects temporary or nondelegable. Mutations and private-note access require the user's explicit task authorization, beyond initial client setup.

```sh
# FEEDBACKS_TOKEN is injected by the client's secret environment.
curl --fail-with-body https://feedback.example.com/api/projects.list \
  -H "Authorization: Bearer $FEEDBACKS_TOKEN" -H 'Content-Type: application/json' -d '{}'
```

## Chrome pairing

Rate limits use one-minute windows: account login/invite acceptance share 30 attempts per IP; new pairing requests have a separate 30/IP allowance. Polling never consumes either allowance. A real, unexpired, unconsumed pairing ID **and its matching secret** must be verified before receiving a separate 30-polls/minute device allowance. Invalid pairing credentials share 30 failures/IP; all polling also has a 600/IP ingress ceiling to bound verification work. Clients should poll every 3 seconds and honor HTTP 429 `Retry-After`. Device rate entries expire within a minute or at pairing expiry, and limiter storage is bounded. These process-local limits restart with the app.

Public `pairing.request {name?:"Chrome extension"}` returns `{pairingId,deviceSecret,expiresAt,intervalSeconds:3,approvalPath}`. Open the app's `approvalPath` (`/pair?pairingId=...`); an authenticated account explicitly calls `pairing.approve {pairingId}` and receives `{approved:true,name}`. Poll public `pairing.poll {pairingId,deviceSecret}` at the suggested interval: `{status:"pending"}` or `{status:"approved",id,token,expiresAt,kind:"extension",name}`. Approval expires in 10 minutes; exchange is single-use and must be stored before further polling. A lost completed exchange requires new pairing. Device tokens last 30 days; list/revoke them in account tokens. They contain only the project IDs current when the token is issued, so a newly created or newly granted General project requires reconnecting the extension; existing token scope is not widened silently. Grants are rechecked on every request. No web session or owner-agent credential is sent to the extension. Keep deviceSecret/token in trusted extension background storage and bind them to the chosen Feedbacks origin.

## MCP

Remote: authenticated stateless Streamable HTTP POST `/mcp`, using the same agent token in `Authorization: Bearer ...`. MCP tool names match the agent operation names, carry explicit schemas, and return `structuredContent` plus short text. Protocol initialization and tool-call readback are verified by the HTTP integration test. GET/SSE session streams are not used; POST returns JSON.

Broad-compatible stdio configuration (Codex and Antigravity support this server shape; substitute the actual installed absolute path):

```json
{
  "mcpServers": {
    "feedbacks": {
      "command": "node",
      "args": ["/absolute/path/to/feedbacks/dist/cli/mcp.js"],
      "env": {
        "FEEDBACKS_URL": "https://feedback.example.com",
        "FEEDBACKS_TOKEN": "<inject named scoped token>"
      }
    }
  }
}
```

The adapter forwards tool inputs over HTTPS through the authorized HTTP operations, produces no stdout logs besides the MCP protocol, and never executes discussion content. `npm run build:server` builds the adapter. For native Codex TOML, use `[mcp_servers.feedbacks]`, `command="node"`, `args=["/absolute/path/to/feedbacks/dist/cli/mcp.js"]` and `[mcp_servers.feedbacks.env]` with the same environment keys. Keep real tokens out of Git.

Liveness: GET `/healthz`; readiness: GET `/readyz` checks database connectivity and reports configured storage driver. Readiness does not claim a Wasabi object read/write test. Configure production secrets separately and perform authorized live object verification.

## Review navigation and organization

- `threads.list` accepts optional `category` and `tag`, alongside the existing search/website/device/status/sort filters.
- `threads.neighbors` accepts a thread ID and the same filters; returns nullable `previous`, `next`, one-based `position`, and `total`. It authorizes the current thread's project before calculating neighbors.
- `threads.organize` updates optional category/tags with `threadId` and the current `revision`.
- `reviewViews.list`, `reviewViews.save` and `reviewViews.delete` manage the actor's personal views within an accessible project. Saved views hold typed filters, a name and revision. Updates/deletes require the current revision; another person's view is not accessible even to an owner.
- `threads.create` accepts optional tags and a reviewer-approved diagnostics packet. Diagnostics are strictly bounded and marked `untrusted_diagnostics` in output. No arbitrary headers, bodies or other fields are accepted.

These operations use the same HTTP, MCP and CLI dispatch. Explicit token scopes are required; existing token presets are not expanded silently. The exact field and output contracts are in `src/shared/contracts.ts` and `src/shared/diagnostics.ts`. Screenshot comparison is a browser presentation of authorized attachments, so it needs no new server operation. See [agent setup](agents.md) and [review workflow](review-workflow.md).
