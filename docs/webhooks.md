# Signed project webhooks

One project maintainer can configure one outbound destination per project through the authenticated [operation API](api.md). The feature is off until `webhooks.save` succeeds. The endpoint must be a public HTTPS URL on port 443 with no credentials, query or fragment. The worker resolves DNS for each attempt, rejects private addresses, pins the checked address for TLS, and does not follow redirects. A receiver must expose a public endpoint. The server needs outbound HTTPS and DNS access.

| Operation             | Input             | Result                                                                             |
| --------------------- | ----------------- | ---------------------------------------------------------------------------------- |
| `webhooks.save`       | `{projectId,url}` | `{configured:true,url,secret}`; creates or replaces the 32-byte hexadecimal secret |
| `webhooks.get`        | `{projectId}`     | Configuration metadata, never the secret                                           |
| `webhooks.rotate`     | `{projectId}`     | New secret shown once; pending attempts use it                                     |
| `webhooks.disable`    | `{projectId}`     | Disables delivery and removes pending jobs                                         |
| `webhooks.deliveries` | `{projectId}`     | Latest 50 IDs, status, attempts, HTTP status and timestamps                        |

Only current project maintainers may call these operations. Secret-returning responses should be stored securely by the caller. No secret is logged or included in project lists, exports, events, or delivery status. The service stores the active secret in its database so it can sign queued requests; protect and back up that database accordingly.

Each committed thread creation, `threads.*` change, and guest reply queues a JSON body with `id`, `type`, `projectId`, `threadId`, `revision`, and `occurredAt`. No thread text, page URL, screenshot, diagnostics, notes or reviewer policy is sent. Requests include `X-Feedbacks-Event-Id` and `X-Feedbacks-Signature: sha256=<hex HMAC-SHA256 of the exact UTF-8 request body>`. Compute the HMAC with the configured hexadecimal secret as the **text key** and compare signatures in constant time. Use event ID to deduplicate, since a timeout can cause delivery after the receiver has already accepted a request.

The background worker checks every minute. It accepts any 2xx response and retries other responses or transport failures up to eight total attempts with exponential delay from 30 seconds to one hour. A failed item remains visible with the last HTTP status, if any. Delivery and receiver side effects are at least once, not exactly once. `webhooks.deliveries` provides the operational status; the worker does not log destination URLs, payloads or error messages. Rotation changes signatures for later attempts. Disable removes queued deliveries; a request already in flight may complete. A backup restore can replay or lose recently completed attempts, so receiver deduplication remains necessary.
