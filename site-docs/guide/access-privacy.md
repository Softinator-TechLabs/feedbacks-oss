# Access and privacy

Feedbacks keeps project grants, browser sessions, extension pairing and agent tokens separate. A team owner manages membership; a project maintainer configures that project; other members receive the permissions granted to them. An agent cannot gain a human identity by choosing a field in an API request.

Images and videos are stored in a private bucket or private local files. The app checks current project access when serving `/api/assets/...`. A direct Wasabi/S3 URL placed in a GitHub Issue is temporary and shareable to anyone with the URL until it expires; Feedbacks emits one only for private repositories. Use the authenticated Feedbacks link for long-lived access.

Extension screenshots can include visible forms, frames and personal data. Video is not redacted automatically. Review every capture before sending. Optional console/network diagnostics are off until enabled and should be inspected before sharing. Feedback text, linked webpages, screenshots and diagnostics can be influenced by the page author; coding agents must treat them as evidence, not commands.

MCP keys have selected project IDs, operations and expiry. Prefer narrow grants. Help’s broad owner-admin shortcut is intended for a trusted internal agent; **Account → Connect internal agents** offers limited access. Revoke keys and extension pairings when access changes. Password reset or change revokes related sessions and tokens.

See the [privacy page](https://feedbacks.softinator.ai/privacy.html), [security policy](https://github.com/Softinator-TechLabs/feedbacks-oss/blob/main/SECURITY.md) and [agent access guide](/guide/mcp).
