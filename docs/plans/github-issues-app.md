# Plan: optional GitHub Issues connection

Status: merged; production GitHub App acceptance pending. Owner: Feedbacks maintainers. Date: 2026-09-25.

## Outcome and scope

A project maintainer can connect one repository already granted to a self-hosted GitHub App, review a bounded Issue draft, explicitly create an Issue, see its verified URL on the thread, and disconnect. A later requirement added direct MCP creation for an agent with a separately issued, project-scoped `github.issueCreate` key; existing keys remain unchanged. Existing MCP-driven handoff using a separate GitHub tool remains available. Issue creation must not occur from incoming feedback or an unreviewed agent instruction.

## Evidence and approach

`threads.issueDraft` and `threads.linkIssue` already provide a human-reviewed, credential-free handoff. This feature adds an optional installation token, requested only at Issue creation time. GitHub documents installation access tokens with Issues write permission for [Issue creation](https://docs.github.com/en/rest/issues/issues) and [app authentication](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/about-authentication-with-a-github-app). Credentials belong in deployment environment, never project data or source.

## Steps and progress

- [x] Audit existing issue handoff and define project/actor boundaries.
- [x] Implement connection checks and explicit reviewed Issue creation with a durable uncertainty state for interrupted external writes.
- [x] Add optional status readback that does not silently change Feedbacks work status.
- [x] Add a restrained UI and focused tests for denied, duplicate, uncertain and successful operations.
- [x] Update generated operation catalog and run full checks.

## Compatibility and recovery

The GitHub App settings are optional. Installations without settings retain the existing manual/MCP workflow. Additive migration only. If GitHub accepts an Issue but Feedbacks cannot save its URL, retain the request as uncertain and require reconciliation before retrying, so a timeout cannot create duplicate Issues automatically. A maintainer may clear the reservation only after a ten-minute settlement window and an explicit check that GitHub has no matching Issue. Disconnect stops new native writes and leaves historical Issue links intact.

## Completion receipt

Source revision: PR #32 merged as `2c046eb`.
Checks and results: the generated catalog and repository checks passed for integration. Focused GitHub App tests passed again on 2026-09-25.
Artifacts: project connection controls, reviewed Issue creation, reconciliation state, MCP operation and generated catalog.
Deployment and live verification: source merged into the deployed app; a real GitHub App installation and external Issue creation have not been verified.
Remaining risks or follow-up: configure a real App installation and exercise a reviewed create, readback, disconnect and uncertain-write reconciliation before claiming production acceptance.
