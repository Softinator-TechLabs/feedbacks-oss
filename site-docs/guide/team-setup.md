---
description: Owner guide to Feedbacks project origins, coding-agent context, GitHub App installation, members, profiles and permissions.
---

# Owner guide: prepare projects and people

Start after DevOps has installed your [team server](/guide/self-host) and created the first owner. Reviewers can install and pair the extension, but they need project access and an allowed website before capture works.

## Create the project and add its websites

Open **Projects** and create the project. Add the exact origins under its settings: for example `https://app.example.com` and a separate development origin such as `http://localhost:5173`. An origin includes scheme, hostname and port; it does not include a page path. Grant only the sites your team intends to review.

A server address tells the extension where to save feedback. A project website origin tells it which website may be reviewed. These are different addresses.

## Set the context your coding agent needs

Open the project's **Instructions** tab, headed **Context for Coding Agent**. Describe what the product does, who uses it, where its code lives, how to run and test it, and the rules a fix must follow. Choose **Publish context** to publish the approved version.

For example: “This is our customer checkout. Preserve keyboard navigation. Reproduce at the captured screen size, test the change and attach the PR before marking it ready for review.” This is an example; use your project's real requirements.

The API/MCP also supports collaborative project background through `projects.context.get/save` and member responsibilities through `members.responsibility.get/save`. These are advisory context; they do not replace approved instructions or change access permissions. Ask an authorized agent to read the current text, make the requested update and read it back.

## Optional: install and connect the GitHub App

Use this when you want to create GitHub Issues from feedback or enable status sync. Capture and MCP do not require GitHub.

1. DevOps configures the GitHub App credentials on the server as described in the [GitHub guide](/guide/github).
2. An authorized GitHub account or organization owner installs the App and selects the repositories it can access. Each organization needs its own installation of the same App.
3. A Feedbacks project maintainer opens **GitHub**, saves the exact repository URL and chooses **Connect project**. Use **Add another repository** for more destinations.
4. Confirm the repository connection shows access. Enable status sync only if your team wants it.

Feedback does not automatically create Issues. A permitted maintainer or separately authorized agent chooses when to create one.

## Add members and grant project access

Use **People → Create user**, or the project's **Members → Invite person** or **Add existing** controls. Give each person their own sign-in. Share the prepared login/setup message privately.

Assign project access deliberately: reviewers need permission to submit feedback; developers resolving it need the appropriate work/resolve permission; maintainers manage project configuration. An account existing on the server does not mean it has access to every project.

## Set useful profiles and responsibilities

In **People**, select a member to maintain account details and expertise. Expertise describes what they know; it does not grant permissions.

For a fuller profile, ask the owner's authorized administration agent to use `members.profile.get/save`. Members can update their own profile through their own agent. Project maintainers can update existing members' project responsibilities. Keep relevant role, experience and current responsibilities factual. See [member context in the MCP guide](/guide/mcp#project-and-member-context-on-request).

Private owner notes are separate from ordinary profiles and project context. Do not paste private notes into public project instructions.

## Hand off to each developer

Ask each developer to sign in as themselves, open **Help → Connect your coding agent**, and create a personal setup prompt. The key belongs to that member and retains their permissions. Even if people share a coding-tool subscription, they need separate Feedbacks identities and keys.

An owner using Help creates an owner-administration key. For ordinary project work, use **Choose projects and permissions** to select narrower access. Follow [MCP setup](/guide/mcp).

## Check that setup worked

Use a synthetic page or non-sensitive example. Confirm a reviewer can connect, capture and send one point; the correct project receives it; and the developer's agent can read it with the intended project context. Record a real fix and verify the outcome before resolving it.
