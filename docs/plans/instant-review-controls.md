# Immediate comments and compact review controls

## Intent

Open the element comment editor on the first paint after selection. Preserve a
hover menu's original view without waiting for image encoding or storage before
typing. Keep capture failure explicit and retain the comment.

Keep the connected popup focused on the current page. Provide a movable review
dock with visible capture, navigation lock, recording controls, Hide and Exit.
Full-page capture remains optional. Recording still requires Chrome's tab picker
and explicit review before sharing.

## Work and verification

- [x] Reproduce and measure selection latency on a real responsive website.
- [x] Decouple comment rendering from original-image capture; preserve menu state,
      cancel/save races, and restore any temporary page styles.
- [x] Add reversible navigation locking and dock capture/recording controls.
- [x] Simplify the connected popup while keeping setup and errors reachable.
- [x] Exercise desktop/mobile menus, delayed/failed captures, keyboard input,
      navigation, recording pause/resume/stop and compact layout.
- [x] Keep Send beside Discard in a sticky editor header, synchronize upload/retry
      states, and separate point labels from original-image actions.
- [x] Run release checks and package the verified extension.

## Boundaries

No added Chrome permissions. Page navigation controls cover page-initiated links,
forms and cancellable Navigation API events, not Chrome's address bar or controls.
Screenshots and video are local until explicit Send. Original images may finish
after the editor opens; a missing original is never presented as captured evidence.

## Verification receipt

- `npm run check` passed, including 122 tests (118 passed, four skipped), type
  checks, builds, isolated app smoke and release checks.
- Browser regression coverage exercises delayed/failed originals, rapid
  cancel/reselect, safe typing, hover menus, navigation locking, draft editing,
  screenshot/upload retry and actual MediaRecorder pause/resume/stop using a
  synthetic stream. The native tab picker is a separate manual check.
- A real responsive website was checked at desktop and mobile widths: menu
  originals, cross-viewport points, three originals submitted with a visible
  screenshot, and a 19-section full-page capture. Retained menu pixels were
  inspected and asserted, not inferred from a success status.
- An isolated run measured the comment editor's first visible paint at about
  12 ms. This is an observation, not a latency guarantee for every device.
- The 0.1.26 ZIP is built without added permissions. Local and CI verification,
  live deployment, and the user's installed Chrome copy are separate gates.
