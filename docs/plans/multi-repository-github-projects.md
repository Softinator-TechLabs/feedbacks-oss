# Multi-repository GitHub projects

Status: implementation complete; release verification pending. Date: 2026-09-27.

## Outcome

One Feedbacks project can connect selected repositories from more than one GitHub organization, provided the same GitHub App is installed on each owning account. The maintainer chooses the exact repository before a one-click or reviewed Issue creation. Feedbacks verifies that repository's installation at connection and write time. A linked Issue records its own repository; optional status sync follows that repository and pauses safely when access is removed.

## Compatibility

The existing `repositoryUrl` plus `githubConnected` pair remains the primary connection. Additional connected URLs live in a bounded project list. Legacy projects still route a single-repository Issue without a new choice. An update that changes the primary repository clears additional connections and disables sync until a maintainer reconnects. Historical verified links remain visible after disconnect.

## Steps

- [x] Add a bounded repository list and project-maintainer add/remove operations with installation checks.
- [x] Require an explicit destination when a project has multiple connected repositories; bind it to the stored idempotent request.
- [x] Route status sync from the verified Issue link's repository, and stop safely on removal or revocation.
- [x] Show connected repositories, owning accounts, installation state, and the destination selector in the GitHub tab and thread action.
- [x] Cover two separate installations, ambiguous destination, revocation, legacy connection, and sync provenance in tests.
- [x] Update contracts, generated operation docs, user guide, full checks and desktop/mobile QA.

## Boundary

Making the existing private GitHub App public is a separate GitHub account setting. This change does not alter App visibility or grant repository access in another organization. The owner must approve each installation and select repositories there.

## Integration verification

- Reconciled with the latest review controls and durable thread evidence links.
- Keep the App installation management link available after connecting the first repository, so another owning organization can be selected.
- Check both reviewed and one-click Issue creation with an explicit repository; a retry cannot switch the destination.
