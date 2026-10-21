---
title: Email notifications
description: Subscribe to project activity and configure email delivery and templates.
---

# Get project activity by email

<DocPath :steps="['Configure a provider', 'Choose events', 'Check delivery']" />

Open your project's **Email notifications** controls and choose the events you want: new feedback, discussion replies, mentions, status or assignments. Enable excerpts only if you want feedback/discussion text in your mailbox. Each client, developer and teammate controls their own subscription. Project access is still required.

A server owner first configures a provider under **Setup → Manage integrations → Email notifications**. Supported transports are Google/custom SMTP, Mailjet API and Amazon SES API. Use a sender verified by the provider. **Send test email to me** queues a test to your own account.

Server settings provide the defaults. In **Project settings → Integrations**, maintainers can customize templates and project delivery. A server owner can also use a different verified project sender or separate provider credentials. Google requires an app password or OAuth; SES sandbox restrictions still apply.

Templates use plain text and documented placeholders, with a synthetic preview before saving. Screenshots, recordings and diagnostics stay in Feedbacks. **Accepted** means the provider accepted the email; inbox delivery is a separate check. Failed or uncertain sends appear in recent attempts. Check the provider before retrying an uncertain send.

Stop emails from the project's preferences or the confirmation link in an email. Opening the link alone does not unsubscribe you. [Configuration, templates and recovery details](/reference/manual/email-notifications).
