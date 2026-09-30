---
title: GitHub Issues across repositories and organizations
description: Connect multiple repositories through GitHub App installations, choose a destination for each Feedbacks issue and opt into verified status synchronization.
---

# GitHub Issues

Feedbacks can create a verified Issue in selected GitHub repositories across multiple organizations within one project. The integration is optional; normal feedback and MCP reads work without it.

**One configured App, multiple installations and repositories.** The server currently uses one GitHub App credential set. Install that App on each permitted account; projects can select repositories across those installations.

## Set up the App

1. A server owner creates a GitHub App with **Metadata: read** and **Issues: read and write** on the selected repositories. Webhooks are not required for Issue creation or the current polling-based status sync.
2. Store `GITHUB_APP_ID`, `GITHUB_APP_SLUG` and `GITHUB_APP_PRIVATE_KEY_BASE64` as private deployment secrets. The last value is the base64-encoded RSA PEM; never commit or display it in a public page.
3. Install the App on each owning GitHub account and select only the repositories that should receive Issues. A private App created for one organization cannot be installed in other organizations; its owner must first make it public, then each organization owner approves its own selected-repository installation. Public App visibility does not itself grant repository access.
4. In Feedbacks, open the project’s **GitHub** tab. Save the first exact `https://github.com/OWNER/REPO` URL and choose **Connect project**. Use **Add another repository** for each additional destination. Feedbacks checks installation access for each exact repository before connecting it and shows the access state per row. A revoked installation is shown as needing attention.

Only a project maintainer can connect or disconnect. Use a repository whose access policy matches the feedback you will put in Issues.

### More than one GitHub organization or repository

A GitHub App installation belongs to a GitHub **account** (a personal account or one organization). Selecting three repositories in Softinator-TechLabs grants access only to those three repositories in that organization. To use another organization, [install the same App there separately](https://docs.github.com/en/apps/using-github-apps/installing-your-own-github-app) and choose its repositories. The Feedbacks server requests a token for the exact repository when it creates an Issue; it does not reuse an installation token from another organization.

If your App is **private**, GitHub permits installation only on the account that owns it. To install it in other organizations, the App owner must [change its visibility](https://docs.github.com/en/apps/maintaining-github-apps/modifying-a-github-app-registration) in the App's **Advanced → Danger zone → Make public** settings. This makes the installation page available to other accounts; each installation still needs an owner to choose and approve repositories. GitHub warns that a public App installed on other accounts cannot be made private again until those installations are removed. Review the App's requested permissions and availability before making that change. You do not need to create one App per organization.

A Feedbacks project can connect multiple repositories across these installations. Use **Manage App installations** to install the same App on another organization, then **Add another repository** in the project. Separate Feedbacks projects keep independent repository selections. When a thread has more than one possible destination, choose the repository before creating its Issue.

## Create an Issue from feedback

Open a thread. With the GitHub App connected to one repository, the header’s **Create GitHub issue** icon creates an Issue directly. With multiple connected repositories, the icon first opens a repository selector; **Create Issue** then creates an Issue from the original feedback, links it back to the thread and records a verified URL. Use **More actions → GitHub issue options → Review/edit first** when the text needs adjustment. Without a configured App, the header offers **View or link issues** instead. Linked Issues and uncertain requests remain accessible from that same header icon. The button is a deliberate maintainer action; incoming comments never create Issues on their own. API and MCP callers must pass `repositoryUrl` when there is more than one connected repository.

For each image or video, the Issue includes a link to that attachment inside the Feedbacks thread. These links do not expire. The web app reuses your existing sign-in and checks current project access before loading the media. Storage objects remain private; expiring Wasabi/S3 URLs and raw asset API URLs are not copied into new Issues.

Only one native Issue request is allowed per thread. If a GitHub write has an uncertain result, Feedbacks pauses creation rather than risk a duplicate. Inspect GitHub and use the recovery controls to verify and link the actual Issue, or clear the request after confirming no Issue exists and waiting for the settlement period.

## Optional status sync

Turn on **Status sync** in the project’s GitHub tab only when you want verified GitHub open/closed state to coordinate with Feedbacks open/resolved work status. The sync follows the exact repository recorded on each verified Issue link. New links establish a baseline. A first mismatch, changes on both sides or an uncertain GitHub write pause for a maintainer decision. In progress and ready for review stay open on GitHub; review decisions remain separate. Removing a connected repository pauses project sync; review its linked Issues before enabling it again. Turning sync off stops polling and automatic updates without deleting historical links.

For API details and recovery rules, see the [GitHub App reference](/reference/manual/api#optional-github-app).
