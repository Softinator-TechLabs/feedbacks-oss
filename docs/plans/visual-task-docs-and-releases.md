# Visual task guides and reliable release preparation

Status: local checks complete; integration CI pending; deployment held until explicit user request. Date: 2026-09-30.

## Outcome and scope

Make all public task guides understandable from a short visual flow and current product captures. Keep action names, privacy boundaries and deep reference accessible. Remove repeated paragraphs and competing role directories. Add draft GitHub release preparation from a versioned, CI-verified main commit; keep app and extension versions distinct. Track registry, one-click installation and plugin distribution work as explicit follow-ups.

## Evidence and approach

The MCP guide has over 2,000 words; GitHub and review guides repeat detailed manual content. Existing actual screenshots and responsive story diagrams can explain these tasks without inventing product UI. Use the current VitePress theme, a server-rendered semantic workflow component and native disclosures. Reference manuals remain canonical. No dependencies or application permissions change.

GitHub currently publishes only v0.1.0, dated 16 September 2026. Existing CI builds and checks the extension, source and Codex plugin but does not create a release. Add a tag/manual workflow that verifies the tag/version, main ancestry and exact successful CI, prepares allowlisted artifacts and checksums, scans exported source and creates a draft. Public releases remain immutable; Chrome Store submission and registry publication are separate follow-ups.

## Steps and progress

- [x] Inspect current guides, actual assets, release state and packaging contracts.
- [x] Simplify all user guides and overview with visual task flows and retained reference paths.
- [x] Implement release preparation and draft publishing with failure-case tests.
- [x] Record distribution TODOs without presenting them as shipped features.
- [x] Build, verify links/Markdown exports, desktop/mobile/dark/keyboard/no-JavaScript behavior and review the diff.
- [ ] Pass required CI. Deployment and public route verification require an explicit user request.

## Motion consistency steering

Use one walkthrough engine and Play/Pause/expand behavior across landing, public guides and application help. Replace the separate recording screenshot slideshow and raw WebP link with the actual recording inspector, a synthetic checkout pointer sequence and synchronized diagnostics. Preserve ordinary no-JavaScript evidence images and reduced-motion/visibility behavior. Repair actual event-list rerendering that interrupts Following playback smooth scrolling. Verify repeated playback, seeks that expose the selected event, close/focus, tabs, live scroll progression, desktop/mobile and current extension packages. Default autoplay applies until an explicit Pause; origin-scoped localStorage retains the preference across pages and visits, while storage events synchronize tabs. Reduced motion changes visual cues, not the stored preference. Existing-team onboarding links directly to Chrome Web Store and the app Setup menu.

- [x] Reuse the shipped recording renderer in the common player, remove the separate slideshow.
- [x] Preserve smooth follow scrolling in the real renderer with a regression check.
- [x] Rebuild artifacts; pass focused, browser and bounded full local checks. Required integration CI remains the merge gate.

## Compatibility and recovery

Static docs presentation and opt-in release automation. No database, credential or extension permission changes. The release workflow does not choose a version or create a tag. Revert website source for presentation rollback; already-published releases are never overwritten.

## Decision log

Short guides lead with the next action. Exact configuration, recovery and protocol details stay linked to canonical manuals or a focused disclosure. Steps are HTML-rendered for accessibility and search, with ordinary text retained in exported Markdown. Use the existing secret-free plugin and extension packaging paths.

## Completion receipt

Local verification: formatting, harness, types, all builds, disposable smoke and release checks pass. The bounded full suite has 493 passing tests, 34 opt-in skips and zero failures, including eleven release-automation cases. Browser checks pass on 19 routes at desktop and mobile sizes, with dark, keyboard and no-JavaScript checks. Independent review findings were corrected and confirmed. Recording follow regression checks (14), common-player behavior and real-renderer runtime browser checks pass, including laptop bounds, cursor cues, exact seeks, pause persistence and cross-tab updates. Extension 0.1.55 packages the stable-row follow fix. Docker source allowlists were updated; clean container execution is verified by required CI because the local Docker daemon is unavailable. CI and public deployment receipts are recorded in the delivery PR. Registry and client distribution remain separate tracked work; draft workflow execution needs a new reviewed version tag and is not claimed from a local build.

Distribution follow-ups: [next release](https://github.com/Softinator-TechLabs/feedbacks-oss/issues/175), [Docker Hub](https://github.com/Softinator-TechLabs/feedbacks-oss/issues/176), [one-click templates](https://github.com/Softinator-TechLabs/feedbacks-oss/issues/177), [Codex distribution](https://github.com/Softinator-TechLabs/feedbacks-oss/issues/178), [Claude Code package](https://github.com/Softinator-TechLabs/feedbacks-oss/issues/179).

## Landing depth refinement

Scope: remove redundant hero guide and recording production labels/captions, remove the four below-illustration captions, keep link arrows free of underlines, and add gentle moving perspective on glass-like backing to the shared landing walkthroughs. Supporting illustrations retain readable static elevation. Playback/Pause persistence, offscreen suspension, reduced motion, native controls and flat expanded inspection remain shared. No dependencies or permissions change.

- [x] Inspect all marked image targets and preserve actual product controls.
- [x] Add depth presentation and remove annotated clutter.
- [x] Verify desktop/mobile, movement, Pause, offscreen, reduced-motion, keyboard and expanded inspection.
- [ ] Record source and required CI evidence. Deployment is outside the current authorization.

Depth verification: Node 24 website/app builds and release checks pass. Shared-player browser checks prove changing perspective, stable Pause after compositor settlement, hover/keyboard interaction, offscreen suspension, flat expanded inspection, mobile scaling, persistence and smooth diagnostic following. Public browser QA passes all 19 routes in desktop/mobile with dark mode, keyboard and no-JavaScript cases. One desktop/mobile visual inspection and one confirmation were bounded; laptop preview height was corrected. The extension popup QA waits for both stored settings and the authoritative settings API; the isolated integration script passes. No production settings behavior changed. Independent depth review found no material issue. Required CI is pending; the PR is held as draft with no auto-merge or deployment.

Mirror-depth steering: make the perspective sweep clearly visible (five degrees / seven pixels, seven seconds per direction), move the shadow onto the ground and add a fading mirrored reflection underneath. Hover holds only perspective, without persisting a pause; mouse leave resumes the same animation clock. Global Pause still stops both. Reflection is progressive CSS enhancement, with a ground-shadow fallback and no extra media.

Mirror confirmation: shared-player and real recording-runtime browser QA pass, including a retained hover clock and resumption after pointer exit, a bottom reflection with no panel shadow, responsive bounds and flat expanded inspection. Public QA still passes 19 routes. The preceding c82af54 revision passed all six required CI jobs; the final mirror refinement has its own exact-head CI gate. Deployment remains held.

Desktop strength steering: increase only desktop sweep amplitude by 40% (up to seven degrees / about ten pixels) and use six seconds per direction. Preserve the previous mobile amplitude and seven-second timing, reflection, hover hold/resume, persistent Pause and reduced-motion behavior. Verify shared-player behavior and responsive bounds before updating the draft PR; no deployment.

Stronger desktop verification: shared-player and real recording-runtime browser QA pass, with laptop/mobile bounds, changing perspective, persistent Pause, stable hover clock/resume and expanded/reduced-motion checks. Desktop/mobile render inspection passes. Website/app builds, extension/plugin packaging, release checks and harness pass. The preceding 3ef79b7 revision passed all required CI; this final tuning remains subject to its own CI.

## Interactive depth and hero action

Promote the existing-team Chrome extension link next to the primary hero setup action, removing the duplicate prompt below. Desktop pointer movement steers the glass plane, highlight and ground shadow; scroll adds slight eased depth. Controls and keyboard focus hold depth immediately. Reuse the playback clock and persistent Pause state; keep mobile gentle, reduced motion flat, and expanded inspection stable. Verify actual pointer direction, shadow/light response, scroll, control stability, Pause, cleanup, responsive layout and public builds. No deployment is authorized.

Thread-story steering: keep the recording only in the hero. Replace its repeated lower scene with a six-second discussion → copy task → instant agent paste sequence. Use current application captures with synthetic members, readable close-ups and a neutral Codex/Claude composer; preserve the shared playback controls and preference. Verify the real Copy task action includes both replies.

Interactive-depth and thread-story verification: current application capture confirms both team replies are included by Copy task for agent. Shared-player and recording-runtime browser checks pass, including fast camera/paste progression, pointer tilt and coordinated light/shadow, scroll depth, stable controls/focus, persistent Pause and reduced motion. Public QA passes 19 desktop/mobile routes, keyboard/no-JavaScript and dark docs. Website/app builds, extension/plugin packages, 925-file release checks and harness pass. Desktop/mobile visual inspection and one corrective confirmation are complete. The preceding 31b9c26 revision passed required CI; the new source remains gated by its own CI and explicit deployment authorization.
