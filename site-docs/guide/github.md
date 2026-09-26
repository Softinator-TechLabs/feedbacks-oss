# GitHub Issues

Feedbacks can create a verified Issue in one connected GitHub repository per project. The integration is optional; normal feedback and MCP reads work without it.

## Set up the App

1. A server owner creates a GitHub App with **Metadata: read** and **Issues: read and write** on the selected repositories. Webhooks are not required for Issue creation or the current polling-based status sync.
2. Store `GITHUB_APP_ID`, `GITHUB_APP_SLUG` and `GITHUB_APP_PRIVATE_KEY_BASE64` as private deployment secrets. The last value is the base64-encoded RSA PEM; never commit or display it in a public page.
3. Install the App on the specific repository. Do not grant every repository unless your organization intends that access.
4. In Feedbacks, open the project’s **GitHub** tab, save the exact `https://github.com/OWNER/REPO` URL, then choose **Connect project**. The tab shows whether the server App is configured, the repository installation is available and the project is connected. A revoked installation is shown as needing attention.

Only a project maintainer can connect or disconnect. Use a repository whose access policy matches the feedback you will put in Issues.

## Create an Issue from feedback

Open a thread. The GitHub bar below its heading shows the current connection and **Create Issue**. One click creates an Issue from the original feedback, links it back to the thread and records a verified URL. Use **Review/edit first** when the text needs adjustment. The button is a deliberate maintainer action; incoming comments never create Issues on their own.

For image or video attachments, the Issue includes a durable Feedbacks URL that checks current project access. When the repository is **private** and storage supports signing, it also includes a direct Wasabi/S3 download URL valid for seven days. Anyone who sees that temporary URL can open the media until expiry. Public repositories receive no direct storage URL. Storage objects remain private and no raw object key or storage credential is copied to GitHub.

Only one native Issue request is allowed per thread. If a GitHub write has an uncertain result, Feedbacks pauses creation rather than risk a duplicate. Inspect GitHub and use the recovery controls to verify and link the actual Issue, or clear the request after confirming no Issue exists and waiting for the settlement period.

## Optional status sync

Turn on **Status sync** in the project’s GitHub tab only when you want verified GitHub open/closed state to coordinate with Feedbacks open/resolved work status. New links establish a baseline. A first mismatch, changes on both sides or an uncertain GitHub write pause for a maintainer decision. In progress and ready for review stay open on GitHub; review decisions remain separate. Turning sync off stops polling and automatic updates without deleting historical links.

For API details and recovery rules, see the [GitHub App reference](https://github.com/Softinator-TechLabs/feedbacks-oss/blob/main/docs/api.md#optional-github-app).
