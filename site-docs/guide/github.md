---
title: GitHub Issues across repositories and organizations
description: Connect selected GitHub repositories, deliberately create an Issue and choose whether to synchronize status.
---

# Connect GitHub when you need Issues

Optional: feedback and MCP work without GitHub. One project uses one App and can connect up to 20 repositories across that App's permitted installations.

<DocPath :steps="['Add an App', 'Connect repositories', 'Create an Issue']" />

<Demo step="github" />

## Connect selected repositories

1. As the server owner, open **Setup → Manage integrations → GitHub → Add GitHub account**.
2. Choose **Encrypted in Feedbacks**, enter the account, then **Continue to GitHub** with an authorized GitHub login. Approve the private App.
3. Install it on **Only select repositories**. Use a separate private App for another owning GitHub account.
4. In the project's **GitHub** tab, choose **Save App**. Save an exact `https://github.com/OWNER/REPO` URL → **Connect project**. Use **Add another repository** for more destinations.

Only human server owners manage/select Apps; maintainers connect repositories. Adding a URL grants no GitHub access.

If the connection check fails, choose **Retry GitHub connection** to load its status
again. When no App is selected, the page asks you to configure one instead of
leaving the repository check running.

| Credential choice          | Operational requirement                       |
| -------------------------- | --------------------------------------------- |
| **Encrypted in Feedbacks** | Back up database and private storage together |
| **Deployment environment** | Keep operator secrets; restart after changes  |

Both are accessible to the running server. Use HTTPS, limit owners and never share private keys between independent servers. [Storage, import and recovery](/reference/manual/self-hosting#multiple-github-apps).

## Create deliberately

Use **Create GitHub issue** on the thread; multiple repositories require a destination. For edited text, choose **More actions → GitHub issue options → Review/edit first**.

Attachment links require Feedbacks sign-in and current project access. One native Issue request is allowed per thread; uncertain writes pause to avoid duplicates. [Recover a pending request](/guide/troubleshooting#an-issue-request-is-pending).

**Status sync** is opt-in. First mismatches, changes on both sides and uncertain writes pause for a maintainer decision. Changing App clears connections/sync; historical Issue links keep their original App. [Sync rules and limits](/reference/manual/api#optional-github-app).
