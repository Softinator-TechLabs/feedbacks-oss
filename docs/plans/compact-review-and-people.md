# Compact review and people controls

Status: in progress. Owner: Feedbacks maintainers. Date: 2026-09-24.

## Outcome and scope

Reduce the thread page's vertical chrome and expose frequent actions at the top. Put the actual screenshot ahead of secondary controls on mobile. Compact saved views and allow status changes directly from the project list. Use a consistent 12-hour IST date format. Make People a list-first screen with one person editor at a time, clearer expertise and weighting, a safe removal path for disabled accounts, and a private welcome message. Clarify account key identification and project instructions.

## Evidence and approach

The supplied browser comments identify tall status, review and navigation sections, actions hidden in thread details, an image below the first mobile viewport, a crowded People page, ambiguous account labels, and saved-view forms that push feedback down the page. Use the existing UI vocabulary and preserve the work, response and human review distinctions documented in [review workflow](../review-workflow.md). Keep activity history and removed user records intact.

## Steps and progress

- [x] Map browser comments to current components and contracts.
- [x] Implement compact controls and one-person editing with focused backend coverage.
- [x] Verify desktop and narrow-screen layout with synthetic data, including an uploaded image and a saved list-row status change.
- [x] Verify keyboard activation of the mobile menu and native status and view controls.
- [ ] Run repository checks, review diff and integrate through CI.

## Compatibility and recovery

Migration 14 adds nullable key suffix and removed-account timestamp columns. Existing keys cannot reveal their original suffix; only newly issued keys show it. Removing a disabled person hides the account from ordinary People lists but preserves records and leaves login disabled. Owners can display removed accounts and restore them to the list. The account must be enabled separately after restore.

## Decision log

- Use a reversible People removal because threads, replies and audit records can refer to a member.
- Keep password delivery in a one-time local browser action after creating a member. The password does not enter a public page or returned member record.

## Completion receipt

Source revision: `codex/usability-polish`, pending merge.
Checks and results: `npm run check` passed with 66 tests passed and one intentional skip; `npm run test:postgres` passed. Synthetic desktop and mobile renders checked in light and dark themes.
Artifacts: local sandbox screenshots and test output, kept outside tracked source.
Deployment and live verification: pending.
Remaining risks or follow-up: required CI and live authenticated readback pending.
