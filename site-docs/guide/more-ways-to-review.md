---
title: Guest review, documents, surveys and more
description: Choose guest links, documents, a text widget, surveys, task connections, project emails or host-app SDK source.
---

# More ways to bring feedback together

Choose the workflow your project needs, then set its access and review the evidence.

<DocPath :steps="['Choose a workflow', 'Set access', 'Review evidence']" />

| You need                      | Use                                                                                            | Keep in mind                                                                             |
| ----------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| A client’s reply              | [Guest discussion link](/reference/manual/review-workflow#invite-a-guest-to-one-discussion)    | One discussion; guests see the original text, not screenshots or existing replies        |
| New guest requests            | [Guest feedback link](/reference/manual/review-workflow#invite-a-guest-to-submit-new-feedback) | Submission only; no access to your workspace                                             |
| PDF or image comments         | [Document review](/reference/manual/review-workflow#review-a-pdf-or-image)                     | Project access applies; documents are not exposed to guest links                         |
| Text feedback on your site    | [Website widget](/guide/website-widget)                                                        | Exact approved origins; no screenshot or recording capture                               |
| Ratings and written responses | [Surveys and NPS](/reference/manual/review-workflow#run-an-opt-in-survey)                      | Opt-in responses stay separate from threads                                              |
| Recurring public-page checks  | [Scheduled QA](/reference/manual/scheduled-qa)                                                 | Inspect run history and visual baselines; authenticated flows are outside these checks   |
| Screen feedback in your app   | [Mobile SDK source](/reference/manual/mobile-sdk)                                              | iOS/Android host integrations; real-device acceptance remains pending                    |
| Tasks in another work app     | [Guided task connections](/reference/manual/integrations#connect-a-task-account)               | Ten adapters; choose named destinations after authorized account setup                   |
| Discussion and work updates   | [Subscribed email](/guide/email-notifications)                                                 | Each project member subscribes; server/project templates and verified senders            |
| Thread activity notifications | [Signed webhooks](/reference/manual/webhooks)                                                  | Your HTTPS receiver gets event identifiers and revisions, not thread text or screenshots |

Guest links, widgets and surveys need configured Turnstile. Permanent website intake remains enabled until disabled and uses durable attempt limits. Guest links, older token-based widgets and surveys keep their expiry and response/submission caps; revoke guest access when finished. Enable **Documents** and **Surveys** under **Project settings → Project → Optional tools** when needed.

## Organize the work

Use the [Kanban Board](/reference/manual/project-board) to move, assign or archive work, and [Analytics](/guide/analytics) to compare pending, overdue and high-priority tasks by project. Keep categories, tags, saved views and individual point progress alongside the same threads. Link delivery evidence and verify the result before resolving. [Work through a review queue](/guide/review-feedback).

For custom integrations, [API, MCP and CLI](/reference/api-cli) provide authorized reads and writes through the same server operations.

For extension-free image import and browser window capture, use the [App screenshot pilot](/reference/manual/app-capture). The [website widget](/guide/website-widget) already collects text feedback without the extension.

## Coming soon: native apps

Windows, Ubuntu and macOS companions and Android/iOS standalone or sharing apps are planned, with no confirmed dates. See [Upcoming](/reference/manual/upcoming) and [platform compatibility](/reference/manual/platform-compatibility) for scope and limits. The web capture/import pilot is implemented separately; existing mobile SDKs capture only their host app and still need real-device verification.
