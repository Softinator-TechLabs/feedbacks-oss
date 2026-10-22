---
title: Email notifications
description: Subscribe clients, developers and teammates; configure SMTP, Mailjet or SES with server and project templates.
---

# Get project activity by email

<DocPath :steps="['Configure a provider', 'Choose events', 'Check delivery']" />

Open **Project settings → Email notifications → My email preferences** and choose the events you want: new feedback, discussion replies, mentions, status or assignments. Own activity and text excerpts have separate opt-ins. Each client, developer and teammate controls their own subscription and still needs project access.

A server owner first configures a provider under **Setup → Manage integrations → Email notifications**. Choose Google/custom SMTP, Mailjet API or Amazon SES API; Mailjet can also use the SMTP option. Use a sender verified by that provider. **Send test email to me** queues a test to your own account.

Server settings provide default subjects, bodies and delivery. In **Project settings → Email notifications**, maintainers can enable/disable delivery and override event templates. A server owner can set a different verified project sender or separate provider credentials. Google requires an app password or OAuth; SES sandbox restrictions still apply.

Templates use plain text and documented placeholders, with a synthetic preview before saving. Screenshots, recordings and diagnostics stay in Feedbacks. **Accepted** means the provider accepted the email; inbox delivery is a separate check. Failed or uncertain sends appear in recent attempts. Check the provider before retrying an uncertain send.

Stop emails from the project's preferences or the confirmation link in an email. Opening the link alone does not unsubscribe you. [Configuration, templates and recovery details](/reference/manual/email-notifications).
