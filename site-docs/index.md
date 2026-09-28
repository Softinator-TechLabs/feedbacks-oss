---
title: Website feedback for AI coding agents
description: Start with a team server, connect the Chrome extension, prepare your projects and give AI coding agents the context to resolve UI feedback.
---

# Website feedback your coding agent can work with

Feedbacks prepares context for AI-assisted UI changes and bug fixes. Clients, colleagues and testers point to a problem on a website. The screenshot, exact page, selected element details and comments stay together. Developers connect their own coding agent through MCP, make the agreed change and record what they verified.

**Your team needs a Feedbacks server first.** DevOps installs it once on your company's infrastructure. Everyone connects to that address. Installing the Chrome extension alone does not create a server or an account.

## New team? Follow this order

1. **DevOps:** [Install the team server](/guide/self-host) and create the first owner.
2. **Reviewers:** [Install, pin and connect the extension](/guide/chrome-extension) using the team's server URL. Project capture becomes available after the owner grants access.
3. **Owner:** [Set up projects and people](/guide/team-setup): website origins, project context, optional GitHub App, members, profiles and responsibilities.
4. **Each resolving developer:** [Connect your own agent through MCP](/guide/mcp).
5. **Team:** Capture a point, review it, send it, ask the developer to work on it and verify the result.

If your team already has a server, start with your role below. You do not need another installation.

## What are you here to do?

| Your role                                       | Start here                                              | You need                                        |
| ----------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------- |
| Client                                          | [Leave feedback and check the result](/guide/clients)   | Review access from the team                     |
| Colleague, developer or UI/functionality tester | [Capture your first feedback](/guide/chrome-extension)  | Server URL, account and project access          |
| DevOps / server administrator                   | [Install and operate Feedbacks](/guide/self-host)       | Company infrastructure and owner handoff        |
| Developer resolving feedback                    | [Connect Codex, Claude Code or Antigravity](/guide/mcp) | Personal agent key and permitted project access |

The owner also follows [project and member setup](/guide/team-setup). One person can fill several roles.

## Your first complete feedback

Open the pinned extension on an approved website → right-click an element → write a note → **Save point** → **Review & send** → inspect the evidence → **Send feedback**.

**Save point is a local draft.** Sending creates feedback on the team server. The developer then asks their agent to read it, makes the agreed change, checks it and records evidence before resolution.

[Full setup walkthrough](/guide/getting-started) · [Troubleshooting](/guide/troubleshooting) · [Access and privacy](/guide/access-privacy)

Feedbacks is [open source](https://github.com/Softinator-TechLabs/feedbacks-oss). The guides are also exported as Markdown for coding agents; [llms.txt](/llms.txt) lists them.
