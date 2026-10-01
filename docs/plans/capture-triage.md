# Priority and assignment during capture review

## Intent

Reviewers can choose a priority and one responsible assignee before sending screenshots or video, without opening the resulting thread. The selected member opens a dropdown containing its own search field and at most ten members per page. More/Previous are compact paging controls; Unassigned is a list choice. Keyboard selection and outside-click/Escape dismissal remain available. Unassigned and Normal are the defaults. Group/team administration and assigning the same whole task to several developers are outside this change.

## Boundaries

- Reuse durable assignments and work plans, with server authorization and atomic thread creation.
- Eligible assignees are active writable members of the selected project or organization owners. Return a bounded name/id list without profiles, email or policy details.
- Preserve approved draft metadata and exact retry identity. Clear an assignee when changing projects.
- Existing extension credentials retain their scopes. Newly approved pairing includes member lookup, planning and assignment; old connections receive reconnect guidance.
- Keep GitHub decisions undecided. Assignment does not start another member's agent or create an external issue.
- Native Chromium recording exposed an existing upload rejection for WebM BlockGroup/Block frames. Support this [documented WebM representation](https://www.matroska.org/technical/elements.html), while retaining header, video-track, media and malformed-boundary checks (checked 2026-10-01).
- Server and extension versions are separate; a source package is not Chrome Store publication.

## Verification

- [ ] Atomic creation, idempotent retries, denied scopes, stale/ineligible assignees and rollback.
- [ ] Hundred-member search/paging, minimal fields and project isolation.
- [ ] Actual screenshot and video editor integration, keyboard, responsive UI, project changes and frozen retries.
- [ ] Appropriate focused checks, repository gate and package inspection.

## Progress

Implementation in progress. Hosted acceptance and Chrome Store publication require their respective rollout evidence.
