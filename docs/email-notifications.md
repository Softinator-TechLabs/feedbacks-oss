# Subscribed email notifications

Email is optional and uses outbound connections. A server behind a private network can send notifications without exposing an incoming webhook. A provider must be configured and each recipient must subscribe. External clients with project accounts use the same subscription controls as other members.

## Configure delivery

A signed-in server owner opens **Setup → Manage integrations → Email notifications** (or `/email`). Choose Google/custom SMTP, Mailjet API or Amazon SES API, enter a verified sender and enable delivery. Save before using **Send test email to me**. Tests go only to the requesting account and are limited to five per hour.

- SMTP requires TLS on port 465 or STARTTLS on 587. Google requires an app password with two-step verification or configured OAuth credentials. Ordinary Google account passwords are not supported by Google.
- Mailjet uses the Send API v3.1 with an API key and secret. A Mailjet SMTP account can instead use the SMTP option.
- SES uses the official v2 client with an explicit region and optional configuration set. Choose **Server role** to use the server's standard AWS credential chain, or **Access keys** to supply a complete key pair. Switching to Server role clears saved keys; replacing both keys clears a previous session token unless a new token is supplied. SES sandbox and verified-sender restrictions still apply.

Credentials are encrypted through the existing provider/installation credential vault. API readback, event history and delivery errors do not return secrets. Back up the database and private storage together. Both are available to the running server; encryption does not protect against an administrator who controls both.

The owner can configure a separate provider or just a verified sender in **Project settings → Email notifications**. A project sender can reuse the server's credentials. Project maintainers can enable/disable project notifications and override templates; only server owners can change provider credentials or sender identities. Disabling the inherited server provider stops inherited project delivery. A separately configured project provider has its own enabled setting.

Optional deployment variables in [the environment example](../.env.example) seed server settings only when no settings have been saved. `FEEDBACKS_MAIL_PROVIDER=smtp|mailjet|ses` opts in; `MAIL_FROM_EMAIL` is required. Saved settings, including a later disable, remain authoritative across restarts. Keep environment files private and out of source. The disposable development harness does not load deployment configuration or send background email.

## Subscribe and customize

Open **Project settings → Email notifications → My email preferences**. Select new feedback, discussion replies, mentions, status changes and/or assignment changes. Own activity and discussion excerpts have separate opt-ins. An event that is both a subscribed reply and mention produces one message. Leaving every event unchecked unsubscribes.

Server templates are defaults. Project templates override individual events. Subjects and bodies are plain text, with these literal placeholders:

`{{project}}`, `{{event}}`, `{{actor}}`, `{{title}}`, `{{comment}}`, `{{status}}`, `{{threadUrl}}`, `{{preferencesUrl}}`.

Unknown variables and executable expressions are rejected. Preview uses synthetic data. Title/comment variables are empty unless the recipient opted into excerpts. Screenshots, recordings, diagnostics, private notes and other recipients' addresses are never attached. Links into Feedbacks require current sign-in and project access. The preferences link opens a confirmation page for unsubscribing; merely opening the link does not change preferences.

## Delivery and recovery

The [event producer](../src/server/access.ts) queues a notification in the same transaction as the recorded action. The [worker](../src/server/notifications/worker.ts) processes up to ten due messages per maintenance pass, outside the domain transaction. It checks the recipient's active account, current project access, subscription, excerpt choice, thread existence and provider status before sending. A removed member, unsubscribe or disabled provider suppresses pending mail. No historical catch-up mail is created when someone subscribes.

Server owners can inspect recent attempts across projects; project maintainers see only their project. Recent attempts show `pending`, `sending`, `accepted`, `suppressed`, `failed` or `uncertain`. **Accepted** means the provider accepted the request, not that the message reached the inbox. Explicit retryable rejections back off, with at most five automatic attempts. Network ambiguity, an interrupted send or an expired send lease stays **uncertain** and is not automatically resent. Inspect the provider, then confirm accepted, confirm not accepted and retry, or cancel. Reconciliation uses the current delivery revision.

Queue records contain bounded event excerpts to preserve the original notification context. Deleted threads remove their queue records. Deleting a reply before its queued notification is processed suppresses that message. Existing threads and applied migrations remain intact when email is disabled. Retain queue data under the same access and backup policy as project discussions; no independent automatic history-purge policy is enabled.

Domain, permission and failure coverage: [notification tests](../tests/notifications.test.ts). A fake transport verifies application logic; it does not certify an external provider account or inbox receipt.

Primary transport documentation checked 2026-10-21: [Nodemailer SMTP](https://nodemailer.com/smtp), [Google authentication](https://nodemailer.com/guides/using-gmail), [Mailjet Send API](https://dev.mailjet.com/docs/email-api/), [SES SendEmail](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_SendEmail.html).
