# Point evidence and GitHub repository routing

Status: point evidence and popup release complete; multi-repository routing remains planned. Date: 2026-09-27.

## Outcome

Each point keeps the element evidence captured at selection time, including its selector, original rectangle and visible border styling. Reviewers can identify whether a point was attached to an element or only a page position; the selected box and numbered point appear together on the screenshot, in Feedbacks and in MCP metadata. A hover menu remains visible while the inline comment is written. Point text remains editable in the screenshot editor.

GitHub installations are account scoped, while Feedbacks projects can involve more than one repository. The UI must distinguish App installation from a project repository connection and issue creation must use a repository explicitly chosen from those connected to that project. Repository access must be checked against the installation at connection and write time. Existing single-repository connections remain compatible.

## Work

- [x] Reproduce hover-menu point failure in browser QA; preserve captured evidence and frozen pixels while the inline field is open.
- [x] Verify point comment edits persist through screenshot review and submission.
- [x] Show point target type, selector, box geometry and styling; mark its bounds on screenshots and expose linked marking metadata to MCP.
- [x] Add restrained Markdown editing and safe rendering for point, overall and discussion comments.
- [ ] Model multiple connected GitHub repositories per project, including repositories in distinct GitHub organizations, with explicit Issue destination and status sync provenance.
- [x] Document App visibility, separate installation per GitHub account, selected-repository grants, and current project routing.
- [x] Run focused tests, full checks, browser QA, visual QA and package the unpacked extension. Verify integration and live behavior separately.

## Compatibility and risk

Existing `context.anchor`, single repository connections and issue links remain readable. Earlier points may lack border styles; their UI should say evidence was not captured rather than infer it. GitHub's private App registration cannot be installed outside its owning account. Changing visibility to public expands who can install the App; repository grants still require separate installation approval. No other organization or repository will be connected without an explicit selection.

## Multi-repository follow-up contract

Keep each GitHub installation account-scoped. A Feedbacks project stores a list of connected repository identities (`owner/repo`) and the installation that authorized each one. Preserve the existing single repository as the initial list entry. A maintainer adds a repository by exact URL only after a live installation check for that URL; removing it stops new Issue creation and status polling for that repository without deleting historical Issue links. The thread Issue action requires an explicit repository choice when more than one is connected. Store that repository with the idempotent Issue request and verified link, and recheck its installation before writing. Status sync uses the verified link's repository, not an unrelated project default; a removed or revoked installation stops safely for maintainer review. Project settings show the owning GitHub account, selected repositories, installation state and per-repository actions. Tests must cover two GitHub organizations with distinct installations, destination selection, revocation, concurrent repository changes and legacy single-repository data.
