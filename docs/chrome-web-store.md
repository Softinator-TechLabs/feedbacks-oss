# Chrome Web Store listing

This is the listing copy for the server-neutral public extension. Packaging a ZIP does not publish a Store release. Use the same title and summary as `extension/manifest.json`; verify the actual package before submission.

## Title

Feedbacks: UI Context for AI Agents

## Short description

Capture UI feedback and screenshots for AI coding agents. Connect to your team’s self-hosted Feedbacks server first.

## Detailed description

Turn website feedback into context your AI coding agent can use.

Feedbacks helps clients, colleagues and UI testers show developers exactly what needs to change. Capture the original screenshot, page URL, viewport, selected element details when available, and your note. Developers read that evidence with project guidance through MCP, make the agreed change and record what they verified.

YOUR TEAM NEEDS A FEEDBACKS SERVER FIRST

This extension connects to your team’s Feedbacks installation. It does not include a hosted workspace or create a server. Your company’s DevOps administrator installs Feedbacks once on company infrastructure, then shares the server URL and account access. If your team already has a server, ask the owner for access; you do not need another installation.

Server installation: https://feedbacks.softinator.ai/docs/guide/self-host
Complete setup flow: https://feedbacks.softinator.ai/docs/guide/getting-started

INSTALL, PIN AND CONNECT

1. Add the extension to Chrome.
2. Open Chrome’s Extensions menu (the puzzle-piece button), find Feedbacks and click the pin.
3. Sign in to your team’s Feedbacks web app. Open Help and choose Copy server URL.
4. Click the pinned Feedbacks icon and paste the URL into Your Feedbacks server.
5. Choose Connect to server, allow access to that server, then sign in and approve the connection.

The owner prepares projects, allowed website origins, project context, optional GitHub App connections and member access. Each developer who resolves feedback connects their own coding agent through MCP. Clients and testers do not need to configure an agent.

CAPTURE, FINALIZE AND SEND

1. Open the website and click the pinned Feedbacks icon to start review.
2. Hover the element, right-click, write what should change and choose Save point.
3. Add more points, then choose Review & send to finalize your draft.
4. Check the screenshots and notes. Redact private information before sharing.
5. Choose Send feedback to send the reviewed evidence to your team’s server.

Save point keeps a local draft; it does not send feedback. If an upload stops, Retry Send in the same draft resumes the remaining images.

FOR DEVELOPERS AND THEIR AGENTS

Connect Codex, Claude Code, Antigravity or another supported MCP client using a personal Feedbacks key. Ask the agent to read the request, inspect the original images and project guidance, work on the agreed change and report actual checks. Feedbacks does not include an AI subscription or start fixes merely because MCP is connected.

GitHub Issue creation and status sync are optional. Normal feedback capture and MCP reads work without GitHub.

CAPTURE TOOLS

• Point-specific screenshots and comments.
• Visible-area capture and optional full-page screenshots.
• Drawing, arrows, text and redaction before sharing.
• Optional short tab recordings with review before sending.
• Shared project feedback, discussion and work status.

DATA AND PERMISSIONS

Capture starts when you invoke a review. Chrome asks for access to your selected server. All-site access is optional. Connection information and unfinished drafts are stored locally; submitted comments, screenshots and page context go to the server you choose. Screenshots can contain sensitive page content, so inspect and redact them before sending. Browser-protected pages cannot be captured. Your server operator manages access, storage and retention.

Guides: https://feedbacks.softinator.ai/docs/guide/chrome-extension
Project and member setup: https://feedbacks.softinator.ai/docs/guide/team-setup
AI agent setup: https://feedbacks.softinator.ai/docs/guide/mcp
Privacy: https://feedbacks.softinator.ai/privacy.html
Source: https://github.com/Softinator-TechLabs/feedbacks-oss

## Listing visuals

Use current product captures with synthetic data. Show these in order: server prerequisite and connection; Chrome pinning; right-click and Save point; Review & send and Send feedback; the submitted thread and agent context. Label illustrations clearly. Never include private server addresses, keys or real customer evidence.

## Publication checks

Confirm the packaged manifest title and summary, blank default server, version, permissions and bundled code. Keep the privacy questionnaire consistent with actual collection of submitted screenshots, comments and page context. Follow the Store dashboard's current field limits and review requirements at submission time. This document does not claim a Store submission or approval.
