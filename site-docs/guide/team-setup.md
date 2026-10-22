---
description: Prepare a Feedbacks project, publish approved guidance and give each teammate access.
---

# Get the project ready for your team

For the owner or project lead. Your [team server](/guide/self-host) should already be running.

<DocPath :steps="['Create project', 'Publish guidance', 'Add teammates', 'Try a review']" />

## Prepare the project

1. In **Projects → New project**, add the website's exact origins. Scheme, hostname and non-default port matter; there are no wildcard approvals.
2. In **Instructions**, publish the product rules, design constraints and acceptance criteria a fix should follow. Keep secrets and private owner notes out.
3. In **Members**, give each person their own account and appropriate project access. Maintainers configure the project; reviewers need permission to submit.

<Demo step="project" />

## Keep work moving

| Need                                                | Use                                                                  |
| --------------------------------------------------- | -------------------------------------------------------------------- |
| Move, assign or archive tasks                       | [Project Kanban Board](/reference/manual/project-board)              |
| Compare pending, overdue and high-priority work     | [Analytics: Overview, Trends and Explore](/guide/analytics)          |
| Notify subscribed clients, developers and teammates | [Email providers, senders and templates](/guide/email-notifications) |

## Check the handoff

| Person              | Next action                                                                    |
| ------------------- | ------------------------------------------------------------------------------ |
| Reviewer or client  | [Connect the extension](/guide/chrome-extension), then send a synthetic review |
| Resolving developer | [Connect their own agent](/guide/mcp), then verify project access              |
| Project lead        | Check that both can see the same submitted thread                              |

## Add context as needed

Use **People** for expertise. An authorized agent can update member profiles, project background and responsibilities on request. These guide interpretation; they never grant access. [Context reference](/reference/manual/agent-setup#project-and-member-context-on-request).

GitHub is optional. The server owner selects an App; a GitHub account owner installs it on selected repositories; project maintainers connect them. Follow the [GitHub guide](/guide/github).

For task apps, open **Project settings → Integrations → Tasks**. Supported adapters are Asana, ClickUp, Jira Cloud, Linear, monday.com, Trello, Productive, Teamwork, Firmao CRM and OpenProject. Choose account access, select a destination by name and connect; Feedbacks generates the connection name.

Jira starts with consent through the operator's configured OAuth broker, then offers named sites, projects and issue types. Other saved provider accounts can be reused where offered. Status sync stays optional, and manual setup remains available. [Provider setup and local-server requirements](/reference/manual/integrations#connect-a-task-account).

For separate websites or moving existing feedback, see [project routing](/reference/manual/project-routing). A move requires access to both projects and does not widen membership.
