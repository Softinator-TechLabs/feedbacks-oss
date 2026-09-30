---
description: Prepare a Feedbacks project, publish context and give your team access.
---

# Get the project ready for your team.

**For the owner or project lead.** Your [team server](/guide/self-host) should already be running.

1. **Create a project.** Add the website origins your team will review.
2. **Publish context.** In **Instructions**, explain the product, codebase and rules a fix should follow.
3. **Add teammates.** Use **Members** to grant access; keep each person’s own account.

<Demo step="project" />

Reviewers can now [connect the extension](/guide/chrome-extension). Developers can [connect their own agent](/guide/mcp).

::: details Profiles and permissions
In **People**, set each person’s expertise. Give reviewers permission to submit and developers the appropriate resolve access. Maintainers manage project configuration.

For richer profiles and responsibilities, ask your authorized agent to update the member’s context. These notes guide the agent; they don’t grant access. Keep private owner notes separate from project instructions. [Member context reference](/reference/manual/agent-setup).
:::

::: details Optional: GitHub Issue tracking
Capture and MCP work without GitHub.

DevOps configures the GitHub App (or separate private Apps for different GitHub accounts); the Feedbacks server owner selects the App in the project’s **GitHub** tab; a GitHub account owner installs it for the selected repositories. In the project’s **GitHub** tab, save the repository and choose **Connect project**. [Full GitHub guide](/guide/github).
:::
