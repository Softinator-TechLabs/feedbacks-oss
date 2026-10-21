# Guided task connections

Status: in progress.

## Outcome

Owners connect a task provider by choosing an account and a named destination. The normal path does not require a connection name, raw destination IDs or six status mappings. Existing connections, project permissions and encrypted credentials remain compatible.

## Implementation

- Add owner-only, bounded provider discovery through the shared operation registry. New credentials are transient until saved; existing account credentials can be reused without returning plaintext to the browser.
- Replace the long Add form with account and destination steps. Generate the connection name and keep optional status sync, polling and manual configuration behind Advanced.
- Keep configured Jira OAuth functional. Other providers require their documented credential unless a real OAuth app is configured; browser sign-in alone does not authorize API access.
- Preserve unsaved drafts, back navigation and stale-request protection. Use native named pickers and clear empty/error/loading states on desktop and mobile.

## Verification

- Regression tests cover owner-only access, revoked and mismatched account references, credential isolation, fixed origins, bounded discovery and destination configuration.
- Lost-response and concurrent save retries share one durable receipt, connection and encrypted key. Provider account context remains bound to the saved credential.
- Browser checks cover ClickUp and monday.com discovery, account reuse, failures/retry, optional status mapping, unsaved drafts and responsive keyboard operation.
- Run the repository checks and required CI. Where release and deployment are requested, verify the merged revision, published image and authenticated live flow separately.

## Evidence and remaining gates

Named discovery and the guided form are implemented. Focused provider/authorization tests, the operation catalog and a native PostgreSQL concurrent-save test passed during development; final browser, full repository and release checks remain in progress. Real provider authorization and task creation require a usable provider account grant; synthetic transport tests do not establish those gates.

## Compatibility and recovery

Use the existing credential vault and connection records. Do not change applied migrations, delete existing connections or rewrite remote tasks. A failed discovery does not save a credential or connection. Manual configuration remains available for existing installations and provider-specific recovery.
