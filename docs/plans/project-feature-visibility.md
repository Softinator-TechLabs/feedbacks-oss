# Basic project view with optional tools

## Intent

Keep a new project focused on feedback, discussion and status. Show GitHub Issue creation only when the project has a connected repository. Let maintainers turn on document review and surveys/polls in project settings when needed.

## Implementation

- Persist `documentsEnabled` and `surveysEnabled` in project data, defaulting both to false. Existing content remains stored when a tab is turned off.
- Include optional tools in the project editor, and show GitHub connection state and setup link in project settings.
- Keep webhooks, scheduled QA and guest links in a collapsed advanced settings section so the initial settings view stays short.
- Hide the GitHub thread action when `githubConnected` is false. Hide the GitHub, Documents and Surveys navigation tabs unless the corresponding project capability is active. Direct document and survey routes point to settings while their tabs are off.
- Keep the existing server authorization and GitHub installation check for enabled actions.

## Acceptance evidence

- A newly created project reports both optional tabs off. Saving one flag persists it without changing the other.
- An unconnected thread has no GitHub creation control or connection warning. Connected projects retain the Issue action.
- Maintainer settings expose both switches and GitHub setup; the navigation and direct routes follow the stored values.
- Repository checks and production browser verification are recorded before release completion.
