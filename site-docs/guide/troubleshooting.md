---
description: Find the failing connection, check its permissions and retry without losing evidence or duplicating GitHub Issues.
---

# Find the connection that's missing

Start with the failing surface. Server sign-in, Chrome pairing, agent keys and GitHub installation are separate checks.

<DocPath :steps="['Identify the surface', 'Check access', 'Retry safely']" />

| Symptom                    | Check first                                                                                                |
| -------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Extension cannot connect   | Use the exact HTTPS server origin without a path; open the app and sign in                                 |
| Website cannot be reviewed | Check exact project origin, write access and Chrome permission; protected browser pages cannot be captured |
| Agent cannot see a project | Check endpoint, key expiry, selected project IDs and read scopes in **Account**                            |
| GitHub says not connected  | In the project's **GitHub** tab, check App, repository installation and **Connect project**                |
| Media link fails           | Open the Issue's Source thread link; current project access is still required                              |

## Reconnect the right client

A Store extension and an unpacked build are separate: pair the one you use. Approve pairing in the app and allow Chrome access to that server.

After agent configuration changes, reconnect and verify MCP initialization and tool discovery. A variable exported in one terminal does not automatically reach a desktop app started elsewhere. [Agent setup](/guide/mcp).

## An Issue request is pending

Do not create a second Issue or retry with a new key. Check GitHub for the Feedbacks request marker. A maintainer can verify and link the actual Issue. If none exists, wait for the **ten-minute settlement period**, then clear the request with explicit confirmation. [GitHub recovery](/reference/manual/api#optional-github-app).

New Issue attachment links use your Feedbacks sign-in and do not expire. Older raw API links may require sign-in; older storage links may expire after seven days.

[Extension setup](/guide/chrome-extension) · [GitHub setup](/guide/github) · [Server health and recovery](/reference/manual/operations)
