# Priority and assignment during capture review

## Intent

Reviewers can choose a priority and one assignee before sending screenshots or video, without opening the resulting thread. Large teams use a searchable project-member picker with at most ten results per page, More/Previous navigation and keyboard selection. Unassigned and Normal remain the defaults.

## Boundaries

- Reuse durable assignments and work plans, with server authorization and atomic thread creation.
- Eligible assignees are active writable members of the selected project or organization owners. Return a bounded name/id list without profiles, email or policy details.
- Preserve approved draft metadata and exact retry identity. Clear an assignee when changing projects.
- Existing extension credentials retain their scopes. Newly approved pairing includes member lookup, planning and assignment; old connections receive reconnect guidance.
- Keep GitHub decisions undecided. Assignment does not start another member's agent or create an external issue.
- Server and extension versions are separate; a source package is not Chrome Store publication.

## Verification

- [ ] Atomic creation, idempotent retries, denied scopes, stale/ineligible assignees and rollback.
- [ ] Hundred-member search/paging, minimal fields and project isolation.
- [ ] Actual screenshot and video editor integration, keyboard, responsive UI, project changes and frozen retries.
- [ ] Appropriate focused checks, repository gate and package inspection.

## Progress

Implementation in progress. Hosted acceptance and Chrome Store publication require their respective rollout evidence.
