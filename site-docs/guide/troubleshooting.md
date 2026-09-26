# Troubleshooting

## The extension cannot connect

Confirm the server origin has the correct `https://` scheme and no path. Open the app in Chrome and sign in. Pairing needs Chrome permission for that server and approval in the app. A public Store install and an unpacked developer build are separate extensions; pair the one you are actually using. Browser-protected pages cannot be captured.

## My coding agent cannot see a project

Check the MCP endpoint, the key’s expiry, selected project IDs and read scopes in **Account**. Reconnect the client after changing configuration. An environment variable exported in one terminal is not automatically available to a desktop app started elsewhere. Test MCP initialization and tool discovery before assuming a client is connected. See [MCP setup](/guide/mcp).

## GitHub says not connected

Open the project’s **GitHub** tab. It distinguishes a server App that is not configured, a repository without an installation, and a project that has not been connected. Save the exact repository URL, install the App on that repository and choose **Connect project**. If installation access was revoked after connection, the tab marks the state as needing attention. See [GitHub setup](/guide/github).

## Issue creation is pending

Do not click again with a new key or manually create a second Issue. Check the connected repository for an Issue with the Feedbacks request marker. A maintainer can verify and link the actual Issue. If none exists, wait for the ten-minute settlement period and then clear the request with the explicit confirmation in the thread.

## A media link expired

Direct Wasabi links in private GitHub Issues expire after seven days. Open the same attachment through the durable Feedbacks link while signed in with current project access. If access was removed, ask a project maintainer rather than making the bucket public.

For server health, migrations and backup/restore, use the [operator guide](https://github.com/Softinator-TechLabs/feedbacks-oss/blob/main/docs/operations.md).
