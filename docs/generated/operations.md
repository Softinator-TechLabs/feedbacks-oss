# Operation catalog

Generated from [shared contracts](../../src/shared/contracts.ts). Do not edit by hand.

Regenerate with `npm run docs:generate`; CI checks for drift with `npm run docs:check`.

Read-only is a transport annotation, not an authorization grant. Scope availability does not grant project access. See the [MCP contract](../mcp-contract.md) and [API](../api.md).

| Operation               | Read-only annotation | Available in scoped agent keys |
| ----------------------- | -------------------- | ------------------------------ |
| `account.links.list`    | Yes                  | No                             |
| `account.links.revoke`  | No                   | No                             |
| `assets.get`            | Yes                  | Yes                            |
| `assets.upload`         | No                   | No                             |
| `auth.me`               | Yes                  | No                             |
| `context.changes`       | Yes                  | Yes                            |
| `context.export`        | Yes                  | Yes                            |
| `context.reviewers`     | Yes                  | Yes                            |
| `guest.inspect`         | No                   | No                             |
| `guest.reply`           | No                   | No                             |
| `guestLinks.create`     | No                   | No                             |
| `guestLinks.list`       | No                   | No                             |
| `guestLinks.revoke`     | No                   | No                             |
| `instructions.get`      | Yes                  | Yes                            |
| `instructions.publish`  | No                   | No                             |
| `members.create`        | No                   | No                             |
| `members.grant`         | No                   | No                             |
| `members.guidance.get`  | Yes                  | No                             |
| `members.guidance.save` | No                   | No                             |
| `members.invite`        | No                   | No                             |
| `members.list`          | Yes                  | No                             |
| `members.notes.get`     | Yes                  | No                             |
| `members.notes.save`    | No                   | No                             |
| `members.owner`         | No                   | No                             |
| `members.policy`        | No                   | No                             |
| `members.resetPassword` | No                   | No                             |
| `members.update`        | No                   | No                             |
| `projects.create`       | No                   | No                             |
| `projects.get`          | Yes                  | Yes                            |
| `projects.list`         | Yes                  | Yes                            |
| `projects.update`       | No                   | No                             |
| `reviewViews.delete`    | No                   | Yes                            |
| `reviewViews.list`      | Yes                  | Yes                            |
| `reviewViews.save`      | No                   | Yes                            |
| `threads.archive`       | No                   | No                             |
| `threads.create`        | No                   | No                             |
| `threads.evidence`      | No                   | Yes                            |
| `threads.get`           | Yes                  | Yes                            |
| `threads.issueDraft`    | Yes                  | Yes                            |
| `threads.like`          | No                   | No                             |
| `threads.linkIssue`     | No                   | Yes                            |
| `threads.list`          | Yes                  | Yes                            |
| `threads.neighbors`     | Yes                  | Yes                            |
| `threads.organize`      | No                   | Yes                            |
| `threads.reply`         | No                   | Yes                            |
| `threads.review`        | No                   | No                             |
| `threads.status`        | No                   | Yes                            |
| `tokens.create`         | No                   | No                             |
| `tokens.list`           | Yes                  | No                             |
| `tokens.revoke`         | No                   | No                             |
| `views.get`             | Yes                  | Yes                            |
| `views.like`            | No                   | No                             |
