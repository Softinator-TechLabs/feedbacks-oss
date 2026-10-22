# Guided task connections

Status: implementation, publication and live UI verified; external provider-account acceptance remains separate.

## Outcome

Owners connect a task provider by choosing an account and a named destination. The normal path does not require a connection name, raw destination IDs or six status mappings. Existing connections, project permissions and encrypted credentials remain compatible.

## Implementation

- Add owner-only, bounded provider discovery through the shared operation registry. New credentials are transient until saved; existing account credentials can be reused without returning plaintext to the browser.
- Replace the long Add form with account and destination steps. Generate the connection name and keep optional status sync, polling and manual configuration behind Advanced.
- Keep configured Jira OAuth functional. Other providers require their documented credential unless a real OAuth app is configured; browser sign-in alone does not authorize API access.
- Start new Jira connections with consent before requesting a destination. Reuse the session-bound encrypted broker flow for named discovery, validate creatable types/fields and atomically commit one canonical connection at final Connect. Keep the legacy manual flow compatible.
- Preserve unsaved drafts, back navigation and stale-request protection. Use native named pickers and clear empty/error/loading states on desktop and mobile.

## Verification

- Regression tests cover owner-only access, revoked and mismatched account references, credential isolation, fixed origins, bounded discovery and destination configuration.
- Lost-response and concurrent save retries share one durable receipt, connection and encrypted key. Provider account context remains bound to the saved credential.
- Jira checks cover session/expiry/revocation boundaries, consented-site authority, create metadata, concurrent finalization, lost responses and post-commit broker acknowledgement failure.
- Browser checks cover ClickUp and monday.com discovery, account reuse, failures/retry, optional status mapping, unsaved drafts and responsive keyboard operation.
- Run the repository checks and required CI. Where release and deployment are requested, verify the merged revision, published image and authenticated live flow separately.

## Evidence and remaining gates

Named discovery and the guided form are implemented, including consent-first Jira setup. Focused provider/authorization tests, desktop/mobile browser checks, the operation catalog and native PostgreSQL concurrent-save/completion checks passed. Jira broker expiry exposes a working restart, while an identical committed completion retry can recover its connection after consent expiry under the same currently authorized session.

Application source: `6387b8d61971edaf75063aaeb6478a73f41542c5`. [Exact-main CI](https://github.com/Softinator-TechLabs/feedbacks-oss/actions/runs/39648999766), attempt 1, passed all six jobs. The public [0.3.1 release](https://github.com/Softinator-TechLabs/feedbacks-oss/releases/tag/v0.3.1) was downloaded and verified: seven checksummed files and all 1,127 exported source hashes matched. [Image publication](https://github.com/Softinator-TechLabs/feedbacks-oss/actions/runs/39651299190) passed both native architectures; public manifests, parsed SBOM/provenance and actual anonymous pulls were checked.

Twelve isolated released-image checks passed with fresh synthetic data and real S3 storage; cleanup affected only the owned acceptance resources. A separate fresh local-volume installation passed twelve installer, authentication, screenshot and persistence checks. Its original owner login, project, thread and exact screenshot bytes survived recreation of only its own app/PostgreSQL containers with the same named volume identities.

The deployed application passed readiness with its database and S3 storage available. Authenticated UI readback preserved the existing owner session and saved connections, loaded the released build and showed the guided Account, Destination and Connect steps. Real provider authorization and task creation require a usable provider account grant; package publication, visible setup forms and synthetic broker/transport tests do not establish Atlassian registration, distribution, live consent or a successful remote task. Live ClickUp acceptance also verified reuse of the encrypted saved account and named workspace, space and list selection through the ready step. A controlled task, reviewed discussion delivery/readback and explicit status synchronization in both directions passed. Other providers still require their own live account acceptance. Detailed operational evidence remains private.

## Compatibility and recovery

Use the existing credential vault and connection records. Do not change applied migrations, delete existing connections or rewrite remote tasks. A failed discovery does not save a credential or connection. Manual configuration remains available for existing installations and provider-specific recovery.
