---
description: The complete Feedbacks setup order, from installing a team server to sending your first visual feedback and resolving it with an AI coding agent.
---

# Start here: from setup to your first fix

Feedbacks turns client requests and UI test findings into context an AI coding agent can use: the comment, exact page, screenshot, viewport, selected element and approved project guidance. Your developer chooses the work and verifies the result.

## 1. Install the team server — DevOps

Install Feedbacks once on your company's own server or cloud infrastructure. A shared team installation needs HTTPS, PostgreSQL and private S3-compatible storage. Create the first owner and hand over the server URL and sign-in access privately. Follow the separate [DevOps installation guide](/guide/self-host).

**Already joining a team? Skip installation.** Ask the owner for the server URL, an account or invitation and project access. The public documentation website is not your team's server.

## 2. Install and connect the extension — reviewers

Install Feedbacks from the Chrome Web Store. Open Chrome's **Extensions** menu (the puzzle-piece button) and pin Feedbacks. In your team's web app, open **Help → Copy server URL**. Paste it into **Your Feedbacks server** in the extension, choose **Connect to server**, allow Chrome's server access and approve pairing after signing in.

Follow the [step-by-step extension guide](/guide/chrome-extension) for your first review. Connection alone does not grant project access; the owner prepares that next.

## 3. Prepare projects and people — owner

Create a project and add the exact website origins your team will review, including the right scheme and development port. Publish project guidance under **Instructions → Context for Coding Agent**. Add useful background and repository information.

If you want GitHub Issue tracking, ask DevOps to configure the GitHub App, install it on the selected repositories and connect them in the project's **GitHub** tab. GitHub is optional for capture and MCP.

Create or invite members, grant project access and set relevant expertise, profiles and responsibilities. Reviewers need permission to submit; resolving developers need appropriate write and resolve access. See [project and member setup](/guide/team-setup).

## 4. Connect the resolving developer's AI agent

Each developer signs in with their own Feedbacks account and creates their own setup prompt from **Help → Connect your coding agent**, or selects narrower projects and permissions in Account. Paste the private prompt into their own Codex, Claude Code or Antigravity session. Verify the connection by listing accessible projects before changing feedback.

MCP is the connection that lets the agent read feedback and use authorized tools. It is separate from Chrome pairing. See [agent setup and first fix](/guide/mcp).

## 5. Capture, send, fix and verify

1. Open the website and click the pinned Feedbacks icon to start review.
2. Hover the problem element, right-click, write what should change and choose **Save point**. Repeat for other points.
3. Choose **Review & send** to finalize the saved points. Inspect the images and notes; redact private details.
4. Choose **Send feedback**. Wait for completion and open the resulting thread. **Save point** alone does not share anything.
5. Ask the developer's agent to read that thread and its project context. Agree the changes, work on the code and test the result.
6. Record the real checks and commit, PR or deployed-view link. Resolve only when the work is verified; the reviewer checks the result.

## If you get stuck

- **No server address:** ask your owner or DevOps; do not paste the website you want to review as the Feedbacks server.
- **No project or matching website:** ask the owner to grant access and add the correct website origin.
- **Point says “not sent”:** finish **Review & send → Send feedback**.
- **Agent sees no project:** check the signed-in member, selected projects and token permissions.

[Client guide](/guide/clients) · [Extension guide](/guide/chrome-extension) · [Troubleshooting](/guide/troubleshooting)
