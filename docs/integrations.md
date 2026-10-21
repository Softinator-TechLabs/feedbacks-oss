# Integration adapters

Owners open **Setup → Manage integrations**. The `/integrations` page lists implemented adapters and current connection counts. GitHub retains its [App setup and Issue workflow](../site-docs/guide/github.md). **Task trackers** at `/trackers` manages Jira Cloud, Linear, Asana, ClickUp, monday.com, Trello, Productive, Teamwork, Firmao CRM and OpenProject connections per project. GitLab and Bitbucket adapters are not implemented.

Project maintainers use **Project settings → Integrations** to choose **Tasks**, **Slack & Teams**, **GitHub**, **Webhooks** or **Time tracking**. The **Tasks** tab keeps connections pinned to this project; the owner adds credentials and maintainers can inspect and test saved connections. Email subscriptions and authorized delivery configuration live in **Project settings → Email notifications**; existing `#integrations-email` links open that tab. Only the selected panel is shown. Panels load on first visit and retain drafts when you switch tabs; setup help and delivery history open on demand.

An implemented adapter is not proof of an approved provider app or a successful connection to your account. Guided setup verifies its destination before saving. Manual connections start unchecked; **Test connection** performs real authenticated reads of the destination and status mappings. Keep external sandbox checks, provider app approval and deployment verification separate from the synthetic contract tests.

## Connect a task account

Open **Project settings → Integrations → Tasks**, choose a provider and supply its documented account credential once. Where offered, choose a saved account to reuse it for another project. Then select the workspace, project, board or list by name and choose **Connect**. Feedbacks generates the connection name. Status sync and polling are optional; configure them under **Advanced**. **Advanced setup** retains the manual destination fields for recovery and existing installations. Jira requires its own OAuth authorization per connection; its rotating refresh token is not copied between projects.

ClickUp offers workspace, space and folder/list choices. monday.com offers boards and named description/status columns. The other providers expose the destinations their documented APIs permit. Some accounts need an organization identifier, site name or trusted instance origin before discovery. If a destination is missing, check the account's provider permissions; discovery never grants access.

monday.com discovery reads current typed column settings. Text and long-text description columns use their respective API value formats; long-text descriptions over the provider's 2,000-character limit are rejected before task creation. Existing status mappings retain their label values. [Status column reference](https://developer.monday.com/api-reference/docs/status), [long-text reference](https://developer.monday.com/api-reference/docs/long-text), checked 2026-10-21.

The browser's provider login does not authorize API access. First-time credentials come from the provider's own account settings; Jira uses the separately configured OAuth broker described below. A local Feedbacks installation makes outbound HTTPS requests, so named discovery and task creation need no incoming public webhook. The operator must still configure trusted OpenProject origins and any OAuth broker.

Only current human owners can list reusable accounts, discover destinations or save credentials. Account references contain a connection ID and revision, never a token. Reuse decrypts on the server and seals a separate credential for the new connection. Disabling one connection prevents its further use as an account source; independently saved connections retain their own credentials until disabled or revoked at the provider. Discovery keeps a newly entered credential transient and writes no connection on failure. See [discovery](../src/server/integrations/trackers/discovery.ts) and [server operations](../src/server/integrations/trackers/operations.ts).

## Shared foundation

[`IntegrationAdapter`](../src/server/integrations/types.ts) defines a safe descriptor and local metadata summary. Register implemented adapters in [`catalog.ts`](../src/server/integrations/catalog.ts). `integrations.catalog` returns supported capabilities, management paths and active/retained counts with each storage choice. The server rechecks current human owner access under the account lock. Listing integrations never decrypts credentials or contacts providers; members, agents and extensions cannot use this owner catalog.

[`credential-vault.ts`](../src/server/integrations/credential-vault.ts) seals values up to 64 KiB with AES-256-GCM and a versioned envelope. Authenticated identity includes provider, installation and connection: another provider or connection cannot open the same secret. Each record has a random 32-byte key in private storage, with verified readback before persistence. Prefixes stay beneath the installation's existing storage permission boundary. GitHub keeps `server-secrets/github-apps/`; future providers use `server-secrets/integrations/<provider>/`.

The vault grants no authorization and verifies no provider permissions. Adapters construct scope from trusted server configuration and stable connection identity, validate their credential shape and provider account, then recheck owner rights before committing. Persist the envelope and key reference atomically; retain keys for recoverable or unknown commit outcomes. Never return plaintext, envelopes or key references in catalogs, errors or audit events. Reuse the [storage choice control](../src/web/integrations/credential-storage.tsx) for encrypted management and deployment environment setup.

## Provider boundaries

The [GitHub adapter](../src/server/integrations/github.ts) supplies catalog metadata and uses the common vault through a small wrapper. GitHub registration, installation approval, project App selection, Issue history and uncertain write recovery keep their existing domain rules. [Tracker adapters](../src/server/integrations/trackers/providers.ts) use fixed SaaS HTTPS origins or an explicitly allowed OpenProject origin, with provider-specific requests. There is no arbitrary runtime plugin loading.

GitHub Issue discussion uses the existing App and verified Issue link through [`github/comments.ts`](../src/server/github/comments.ts). Human maintainers load bounded comment pages and queue explicitly reviewed text in the Issue panel. Reservations are durable and source pinned; a lost or unverifiable write pauses for inspected comment-ID reconciliation. No automatic local-discussion mirroring runs. [`github-comments.test.ts`](../tests/github-comments.test.ts) covers authorization, duplicate intent, revoked grants, accepted-write uncertainty, reconciliation and moved-thread history. Live App/account acceptance is a separate gate. API shapes follow GitHub's [Issue comments REST reference](https://docs.github.com/en/rest/issues/comments?apiVersion=2026-03-10), consulted 2026-10-21.

Each tracker connection pins its project, provider, encrypted credential and destination. Changing configuration increments its revision and requires verification again. Disabled connections retain historical task links; they never fall back to another account. API redirects are rejected. Jira and Teamwork account site names are validated single DNS labels. Tracker operations require a signed-in human with current project maintainer access; only server owners manage tracker credentials. Existing agent keys receive no tracker write scope.

## Tracker setup and synchronization

Create a connection, run **Test connection**, then edit its status mappings using the remote IDs shown by the test. Mappings are one-to-one and can cover the six existing work states. For Jira, a write mapping also needs the workflow transition ID; a status ID and transition ID are different provider concepts.

| Provider    | Authentication                                                  | Destination                                                                                                   |
| ----------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Jira Cloud  | Distributable OAuth app through the optional broker below       | Consented Jira site, project ID or key, issue type ID                                                         |
| Linear      | API token or OAuth credential                                   | Team ID; workflow state IDs                                                                                   |
| Asana       | API token or OAuth credential                                   | Project ID; `open` and `completed`                                                                            |
| ClickUp     | API token or OAuth credential                                   | List ID; status names                                                                                         |
| monday.com  | API token or OAuth credential                                   | Board ID, description text column ID, status column ID; status labels                                         |
| Trello      | API key and delegated token                                     | Board ID and intake list ID; list IDs as statuses                                                             |
| Productive  | API token                                                       | Organization ID, task list ID; workflow status IDs                                                            |
| Firmao CRM  | API login and generated API password using Basic authentication | Organization identifier, numeric CRM project ID, optional project-team responsible user; explicit status keys |
| OpenProject | API token, sent using the documented `apikey` Basic login       | Allowed HTTPS instance origin, numeric project ID and work package type ID                                    |
| Teamwork    | API token or OAuth credential                                   | Account site name, task list ID; `open` and `completed`                                                       |

The web setup accepts documented API credentials for non-Jira providers. OAuth credential import through the API is useful for operator-managed recovery; the bundled consent broker currently implements Jira Cloud only. Provider permissions, account plans and token lifetime remain provider-specific requirements.

In a feedback thread, **External tasks** creates a task from a reviewed title and description or verifies and links an existing task in the configured destination. **Send comment** shares only the text reviewed in that form for providers with a documented comment endpoint; Firmao task comments are unavailable. **Read remote comments** retrieves a bounded provider discussion page and preserves provider attribution; it does not turn external authors into Feedbacks members or local discussion replies. Private screenshots, diagnostics, attachments and the rest of the discussion are not automatically copied.

**Use remote status** and **Send local status** make the direction explicit. Optional five-minute polling imports remote status changes using outbound HTTPS, so a server on localhost or a LAN needs no incoming provider webhook. When local and remote states have both changed, polling records a conflict for a maintainer to resolve. An unmapped state is shown as an error rather than guessed. The integration owner must remain active and keep project maintainer access for automatic polling.

**Refresh remote state** reads the current provider state for a maintainer's decision while retaining the last applied synchronization checkpoint. Refreshing alone does not change local work status or silently consume an update that polling still needs to apply.

Actions use persistent reservations and idempotency keys. Definite transient rejection can retry with backoff; a timeout, interrupted attempt or ambiguous provider write becomes **uncertain**. Check the remote system and record the verified result before trying again. Created tasks can be reconciled by their remote ID. Connection rotation, disablement, current access and attempt leases are rechecked around credential reads and writes. Disabling cannot undo a request already accepted by a provider. [Worker implementation](../src/server/integrations/trackers/worker.ts) and [regression tests](../tests/trackers.test.ts).

Moving feedback retains original-provider task and time history without granting the destination project's members access to it. A historical reference is visible only when the reader can access the moved thread and still maintain the original connection project. It is labeled historical and offers no sync, comment or logging actions from the moved thread. Polling retires those old links, and pending deliveries are cancelled. Processing or uncertain external writes must finish or be reconciled before moving the feedback. A move never deletes external tasks, comments or time entries.

## OpenProject: cloud or self-hosted work packages

Open **Project settings → Integrations → Tasks → OpenProject**. Enter the exact HTTPS instance origin, numeric project ID, work package type ID and the API token created in your OpenProject account. The adapter uses OpenProject API v3 and the documented Basic login `apikey` with that token; it does not collect your account password. The connection is encrypted in the existing installation vault.

Before saving the connection, the server operator must add that exact origin to `OPENPROJECT_ALLOWED_ORIGINS` and recreate the application container. The value is a comma-separated list, for example `https://tasks.example.com,https://projects.internal.example.com`. It accepts no paths, embedded credentials, query strings or fragments. The empty default denies OpenProject connections. An internal/VPN instance is supported only when explicitly allowed and reachable from the Feedbacks application container, with a certificate trusted by its runtime. HTTP and TLS-verification bypasses are not supported. The Feedbacks server itself can remain local; no inbound provider callback is needed.

**Test connection** verifies the selected project, its work package creation permission, selected type and returned status IDs. Create a reviewed work package or link an existing package in the same project and type from **External tasks**. Comments are explicit reviewed text; reading external activity does not copy it into local discussion. Status changes use the package's observed `lockVersion`; a concurrent external update is reported as a conflict. Configured mappings use numeric status IDs. A status appearing in the returned list does not guarantee that every workflow transition or required custom field permits a write.

Requests use fixed API paths beneath the operator-allowed origin, reject redirects and never follow arbitrary URLs returned by the provider. Timeouts and failed creation readback use the existing uncertain-write reconciliation. Real instance permissions, required custom fields, workflow rules and API-version compatibility still need account acceptance; synthetic transports are not a live OpenProject certification.

## Optional Jira OAuth broker

Jira Cloud accepts OAuth credentials only. Do not ask every customer to create an individual OAuth app or collect their Jira API tokens. A distributor or operator registers a distributable confidential app in Atlassian's developer console and deploys [`tracker-oauth-broker.mjs`](../scripts/tracker-oauth-broker.mjs) once at an HTTPS origin. Its client secret stays on that service; it is never included in an OSS client, local installation or image layer.

Configure these secrets on the broker through the deployment's secret manager:

- `TRACKER_BROKER_PUBLIC_ORIGIN`: exact public HTTPS origin.
- `TRACKER_BROKER_JIRA_CLIENT_ID` and `TRACKER_BROKER_JIRA_CLIENT_SECRET`: the distributable app credentials.
- `TRACKER_BROKER_INSTALLATION_KEYS`: a JSON array of distinct strong installation keys, each at least 32 characters.
- `PORT`: optional loopback port, default `4786`.

Register `<broker-origin>/oauth/jira/callback` as the Jira callback. The requested classic scopes are `read:jira-work`, `write:jira-work`, `read:jira-user` and `offline_access`. Enable distribution according to Atlassian's current app policy before sharing it with other installations.

On each Feedbacks installation set `TRACKER_OAUTH_BROKER_URL` and its own `TRACKER_OAUTH_INSTALLATION_KEY`. The owner opens Jira consent, returns to Feedbacks and chooses a consented site, project and issue type by name. The new guided flow needs no project or type IDs. The existing manual flow remains available under Advanced setup.

The local flow is bound to the original signed-in session and expires after ten minutes. Another sign-in, an unconsented site and altered account authority are rejected. Named discovery reads through the pending encrypted broker handle without saving a temporary connection or copying a refresh token. Final Connect validates create permission, the selected non-subtask type, supported create fields and optional mappings, then commits one canonical encrypted connection. Same-input completion retries recover that connection after a lost response. Token delivery is acknowledged only after the local record commits. Refreshes use a connection lease and the broker briefly caches rotated-token responses for lost-response recovery.

Jira types with additional required fields without defaults are unavailable until the Jira administrator adjusts their create configuration or the owner chooses another type. The integration sends the reviewed summary and description; it does not silently discard the feedback body. Finish pending guided flows or let their ten-minute expiry pass before downgrading to an older application build. Existing saved connection records retain their format.

Run `node scripts/tracker-oauth-broker.mjs` behind an HTTPS reverse proxy. [`Dockerfile.oauth-broker`](../Dockerfile.oauth-broker) packages the same dependency-free service as a non-root Node image. It binds loopback; the reverse proxy must share its network namespace (for example a Linux host-network deployment) instead of publishing an unreachable container port. The main app image does not require the broker. The broker keeps pending flows and short refresh-retry receipts in memory only: a restart invalidates unfinished consent and removes those receipts. Keep it monitored, protect installation keys, and reconnect any account whose refresh outcome cannot be recovered. Do not treat the local broker tests as live Atlassian approval.

## Slack and Microsoft Teams

Project maintainers opt into each activity type under **Project settings → Integrations → Slack & Teams**: new feedback, discussion, work status and assignments. Create the provider's incoming webhook for the intended channel, store its secret URL and send a test. Teams Workflows must accept the Adaptive Card payload; assign a workflow co-owner so notifications survive staff changes. Existing legacy Teams incoming URLs can also be retained where Microsoft still permits them.

Webhook URLs are encrypted and never returned in settings. Delivery accepts only recognized Slack/Teams HTTPS endpoint shapes, pins public DNS addresses and follows no redirects. Each message contains an activity label and a Feedbacks link, without the feedback body, discussion or project name. Everyone in the selected external channel can see that metadata; opening the link still requires current Feedbacks access and access to the local server or VPN. Saved event subscriptions, current maintainer access, revocation, retries and uncertain-delivery reconciliation are enforced on the server. [Implementation](../src/server/integrations/channels.ts), [tests](../tests/channels.test.ts).

## Fullstory and LogRocket session references

A reviewer can attach a provider session URL to a thread after confirming the exact page and capture time. The server compares normalized page URLs, validates the provider session URL and rejects credential-bearing links. The UI labels these references **reviewer-provided**; this is not independent proof that a session contains that page or person. There is no fuzzy user matching, cookie extraction or import of private provider recordings. Provider login, retention and regional availability still apply.

Applications can obtain the correct link using Fullstory's `FS('getSessionAsync', { format: 'url.now' })` or LogRocket's `getSessionURL` callback before a reviewer shares it. Never construct session links by guessing identifiers. [Implementation](../src/server/integrations/replay-links.ts), [tests](../tests/replay-links.test.ts).

## TestMu CI intake

[`testmu-intake.mjs`](../scripts/testmu-intake.mjs) sends a reviewed, normalized TestMu/LambdaTest failure through the existing authenticated `threads.create` operation. It is a CI adapter, not an unauthenticated native webhook receiver. Obtain build and test IDs from your runner or the provider's session details, select the actual reviewed page and viewport, and remove private logs, credentials and personal data from the summary.

Give the CI job a deliberately issued, project-scoped Feedbacks key with only `threads.create`, plus the `FEEDBACKS_URL` and `FEEDBACKS_PROJECT_ID` settings. Store the key as `FEEDBACKS_TOKEN` in the CI secret store. Run from a locked-dependency checkout:

```sh
node scripts/testmu-intake.mjs < reviewed-testmu-report.json
```

The input is a strict JSON object with `version: 1`, `reviewed: true`, `buildId`, `testId`, `checkpoint`, `name`, `status` (`failed` or `error`), `summary`, `pageUrl`, a private provider dashboard `sessionUrl`, ISO `capturedAt`, and the real `viewport: { width, height }`. Raw logs, screenshot bytes and unknown fields are rejected. See the [executable schema](../scripts/lib/testmu-intake.mjs) and [real authenticated HTTP test](../tests/testmu-intake.test.ts).

The provider/build/test/checkpoint identity produces a stable retry key. Repeating the same report returns the same thread; changed content under that identity is an idempotency conflict for the sender to review. Current project scope, write grants, exact approved origins and credential revocation are checked by the normal server operation. A private local server can receive this outbound CI request only when the CI runner has network access (for example a local runner or VPN).

## Explicit Harvest and Time Doctor entries

Owners configure an encrypted time connection for a provider account, project, task and optional provider user in **Project settings → Integrations → Time tracking**. Maintainers test the destination, then submit reviewed minutes, date and note from **Log reviewed work time** in a thread. No background activity tracking, automatic timer or billing approval is enabled.

Harvest connections require duration mode and an active project task assignment. A submitted duration creates a stopped entry and an external reference back to the Feedbacks thread. Time Doctor uses its documented JWT API token, company/project/task/user IDs and a reviewed local start time converted to UTC. It creates an `add` manual-time edit with `approved: false`; provider approval policy still applies. API availability and the caller's provider role remain account setup gates.

Persistent entry reservations prevent duplicate HTTP retries; failed access checks stop delivery. Timeouts become uncertain rather than creating time twice. Verify the provider's history and record its entry ID to reconcile. Previously submitted time remains in the provider when a connection is disabled. [Implementation](../src/server/integrations/time-tracking.ts), [tests](../tests/time-tracking.test.ts).

## Firmao: feedback to CRM task

Choose **Firmao CRM** under **Project settings → Integrations → Tasks → Add connection**. Enable Firmao's API under **Company → Settings → API** and use its API login and generated API password. Enter the organization identifier from your Firmao login URL and the numeric CRM project ID. Optional responsible-user IDs must be present in that project's returned team or managers. Credentials use the existing encrypted vault; only human server owners configure them and current project maintainers initiate reviewed task actions.

**Test connection** reads the exact project and checks returned task-create/read permission metadata. Creation sends the reviewed title/description, project, optional responsible user and initial mapped status (default `WAITING`). It extracts the task ID from the documented `CREATE` changelog, then verifies the task belongs to that project. The saved reference shows its exact task ID and opens the documented organization login URL; no unsupported task deep-link format is invented. This workflow does not create customers, contacts, opportunities or invoices.

Optional status mappings use dictionary keys. Testing returns documented initial `WAITING` plus keys observed in the first fifty organization tasks belonging to this project; this is a bounded sample, not the complete status dictionary. Other configured keys missing from that sample fail verification. Explicit status writes send one `status` field through the documented object-update API and verify readback. Provider status/update permission and local resolution permission still apply. Task comment endpoints are not documented in the checked API, so read/send comments fail closed and are hidden for Firmao.

All requests use fixed `https://system.firmao.pl/{organization}/svc/v1` routes, bounded numeric IDs and redirect rejection. Durable reservations deduplicate retries; missing create IDs, timeouts and failed post-create readback require reconciliation instead of another blind creation. The provider documents 60 requests/minute and at most five concurrent requests; HTTP 429 follows the shared worker's bounded backoff. Real account/API-plan permission, company-specific fields/status keys and sandbox acceptance remain setup gates. Synthetic contract/browser checks do not prove a live Firmao account. [Current official API PDF](https://firmao.pl/wp-content/uploads/2026/05/API-Documentation_EN.pdf), [official source examples](https://github.com/FirmaoCRM/API), checked 2026-10-21. TLS verification remains enabled; unsafe legacy example flags are not copied.

## External references

Provider documentation checked on 2026-10-21; provider schemas, plans and approval rules may change:

- [OpenProject API authentication](https://www.openproject.org/docs/api/introduction/), [work packages and activities](https://www.openproject.org/docs/api/endpoints/work-packages/), [project types](https://www.openproject.org/docs/api/endpoints/types/), [statuses](https://www.openproject.org/docs/api/endpoints/statuses/).
- [Atlassian OAuth app policy and flow](https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/), [Jira REST v3](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/).
- [Linear GraphQL](https://linear.app/developers/graphql), [Asana tasks](https://developers.asana.com/reference/createtask), [ClickUp tasks](https://developer.clickup.com/reference/createtask).
- [monday.com items](https://developer.monday.com/api-reference/reference/items), [Trello cards](https://developer.atlassian.com/cloud/trello/rest/api-group-cards), [Productive](https://developer.productive.io/), [Teamwork tasks](https://apidocs.teamwork.com/docs/teamwork/v1/tasks/post-tasklists-id-tasks-json).
- [Slack incoming webhooks](https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks), [Teams Workflows incoming webhooks](https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook).
- [Fullstory session details](https://developer.fullstory.com/browser/get-session-details/), [LogRocket session URL](https://docs.logrocket.com/reference/get-session-url), [TestMu runner test identity](https://www.testmuai.com/support/docs/analytics-test-case-insights/).
- [Harvest time entries](https://help.getharvest.com/api-v2/timesheets-api/timesheets/time-entries/), [Time Doctor API](https://timedoctor.redoc.ly/), [Firmao API](https://firmao.io/api-documentation/).

## Adding a provider

1. Define supported capabilities and domain contracts; implement current server authorization, credential validation and bounded external calls.
2. Reuse the vault and storage selector. Implement storage choices only when supported, preserve connection identity, and document rotation, revocation, backup and recovery.
3. Add the local metadata adapter and owner UI; register its descriptor after its operations and page work. Extend the shared capabilities only for implemented use cases.
4. Verify owner/member/agent denial, consent replay/expiry, provider isolation, refresh concurrency, storage loss, disabled fallback, uncertain writes and historical links. Synthetic responses do not prove real provider approval.
5. Verify direct navigation, storage choices, mobile/light/dark/keyboard and existing providers; pass full checks, required CI and live release gates.

Back up database and private storage together. A compromised running server can access either encrypted or environment credentials. See [storage security and recovery](self-hosting.md#storage-and-security).
