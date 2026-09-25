# Review interface refinement

Status: merged; live interface acceptance partially verified. Owner: Feedbacks maintainers. Date: 2026-09-25.

## Outcome and scope

Keep the feedback list and thread usable on narrow screens without placing secondary controls ahead of the feedback. Make saved views a compact selection control, apply a selection immediately, and reveal the save form only when requested. Keep reviewer importance simple by showing the overall value first and topic overrides on demand. Tighten spacing and control styling within the existing application design.

## Evidence and approach

The supplied mobile annotations show that saved-view management and filter chrome consume the opening screen. The reviewer importance editor shows four numeric fields without first explaining the common case. Preserve existing filter and weighting contracts, status actions, review decisions, and the 12-hour IST date format.

## Steps and progress

- [x] Map annotated surfaces to list, thread, saved-view, and member components.
- [x] Implement the compact list and reviewer editor changes.
- [x] Inspect synthetic desktop and 390px screens, including a saved-view save and apply.
- [x] Run final repository checks, visual detector, and code review.
- [x] Integrate through required CI and verify the deployed interface.

## Compatibility and recovery

No data model or API changes. Saved views retain their existing filters and can still be removed from the expanded manager. Topic weights retain their existing numeric meaning and blank fallback to the overall value.

## Decision log

- Keep native selects for status and saved views because they remain keyboard accessible and compact on mobile.
- Keep the save form available on demand so the list of feedback remains visible by default.

## Completion receipt

PR #42 merged as `ef8478d`. The desktop and narrow-screen list were inspected during implementation, and subsequent deployed list changes were verified on 2026-09-25. Keep production acceptance for optional integrations and the Chrome extension separate from this interface change.
