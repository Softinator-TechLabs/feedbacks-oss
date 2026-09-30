---
title: GitHub Issues across repositories and organizations
description: Connect multiple repositories through GitHub App installations, choose a destination for each Feedbacks issue and opt into verified status synchronization.
---

# GitHub Issues

Feedbacks can create a verified Issue in selected GitHub repositories across multiple organizations within one project. The integration is optional; normal feedback and MCP reads work without it.

**Multiple configured Apps, one App per project.** A server can use separate private GitHub Apps for different projects. Its owner selects each project's App; project maintainers connect repositories across that App's permitted installations.

## Connect your GitHub account

1. As the Feedbacks server owner, open **Setup → Manage integrations → GitHub → Add GitHub account**.
2. Choose **Encrypted in Feedbacks**, then enter the GitHub organization or personal username. Choose **Continue to GitHub** using the GitHub login allowed to create Apps for that account.
3. Approve the private App. Feedbacks saves the connection automatically. On GitHub, install it on **Only select repositories** and choose the repositories you need.
4. In your project's **GitHub** tab, choose this App and **Save App**. Save the first exact `https://github.com/OWNER/REPO` URL and **Connect project**. Use **Add another repository** for other destinations.

Each GitHub account can have its own private App on the same Feedbacks server.
For different GitHub logins, repeat the steps with the correct login/account.
The existing private App does not need to become public. GitHub still requires
approval on the owning account; adding a repository URL alone grants no access.
Project maintainers can connect repositories; only human server owners manage
Apps and change project App assignment.

### Two ways to store credentials

**Encrypted in Feedbacks** supports setup and management from this page without
per-App environment edits or a restart. **Deployment environment** keeps the
operator's existing secret configuration and restart workflow. Choose it for
manual setup instructions. Existing environment Apps remain usable; **Manage
here** optionally moves an App into encrypted management.

Managed PEMs are encrypted in the database, with their encryption keys in the
server's existing private storage. Back up both. A database dump alone cannot
decrypt them; control of the server or both stores can. Environment secrets are
also accessible to the running server. Use HTTPS, limit server owners and select
only needed repositories. [Storage details and recovery](/reference/manual/self-hosting#multiple-github-apps).

### Manage or recover an App

Open **Manage App** to rename the local label, upload a replacement PEM, or
disconnect/reconnect. Private keys are never displayed. **Connect existing App**
accepts an App ID and PEM generated in its GitHub settings. Import verifies
identity and permissions; the App's public/private visibility remains a GitHub
setting. **Install on repositories** starts GitHub installation; **Manage
repository access** opens account settings. Use the GitHub login authorized for
that account. A private App only installs on its owning account.

If you see a private-App landing page while using another GitHub login, add a
separate App for that login's organization instead of trying to install the
first account's private App. A public App can be installed on other approved
accounts; public visibility itself does not grant repository access.

A failed/expired return needs a new setup attempt in the same Feedbacks session.
If GitHub already created the App, use **Connect existing App** with a new PEM.
For independent self-hosted servers, create separate App credentials; never
share a common private key between operators.

Changing project App clears repository connections and status sync. Existing
Issue links retain their original App. Pending writes must be reconciled before
switching/disconnecting; a same-ID key replacement remains available for
credential recovery. Disconnect retains history and does not uninstall the App
on GitHub. With multiple connected repositories, choose a destination when
creating an Issue. The server requests tokens for the exact repository.

## Create an Issue from feedback

Open a thread. With the GitHub App connected to one repository, the header’s **Create GitHub issue** icon creates an Issue directly. With multiple connected repositories, the icon first opens a repository selector; **Create Issue** then creates an Issue from the original feedback, links it back to the thread and records a verified URL. Use **More actions → GitHub issue options → Review/edit first** when the text needs adjustment. Without a configured App, the header offers **View or link issues** instead. Linked Issues and uncertain requests remain accessible from that same header icon. The button is a deliberate maintainer action; incoming comments never create Issues on their own. API and MCP callers must pass `repositoryUrl` when there is more than one connected repository.

For each image or video, the Issue includes a link to that attachment inside the Feedbacks thread. These links do not expire. The web app reuses your existing sign-in and checks current project access before loading the media. Storage objects remain private; expiring Wasabi/S3 URLs and raw asset API URLs are not copied into new Issues.

Only one native Issue request is allowed per thread. If a GitHub write has an uncertain result, Feedbacks pauses creation rather than risk a duplicate. Inspect GitHub and use the recovery controls to verify and link the actual Issue, or clear the request after confirming no Issue exists and waiting for the settlement period.

## Optional status sync

Turn on **Status sync** in the project’s GitHub tab only when you want verified GitHub open/closed state to coordinate with Feedbacks open/resolved work status. The sync follows the exact repository recorded on each verified Issue link. New links establish a baseline. A first mismatch, changes on both sides or an uncertain GitHub write pause for a maintainer decision. In progress and ready for review stay open on GitHub; review decisions remain separate. Removing a connected repository pauses project sync; review its linked Issues before enabling it again. Turning sync off stops polling and automatic updates without deleting historical links.

For API details and recovery rules, see the [GitHub App reference](/reference/manual/api#optional-github-app).
