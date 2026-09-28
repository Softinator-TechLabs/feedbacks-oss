# Plan: explain the complete Feedbacks workflow

Status: completed locally. Date: 2026-09-28.

## Outcome and scope

A visitor understands that Feedbacks prepares UI feedback context for coding agents, that a team server comes first, and what each person does. Update the public landing page, public documentation, Help, extension onboarding and Store listing copy. Preserve capture, authorization and agent-key issuance behavior.

## Evidence and approach

The former landing headline led with a team slate; Help offered only a brief extension link. The public MCP guide and legacy Help also described controls that no longer matched the app. Source truth: `extension/content.js` uses Save point, Review & send and the editor uses Send feedback. GitHub is optional; personal and owner keys have different authority.

The user approved the agent-context positioning, one capture-to-agent example, server-first setup, role-specific guides and Copy server URL. Preserve the existing paper/Manrope/coral website identity and app/extension tokens.

Competitor primary pages inspected on 2026-09-28: [FasterFixes](https://www.faster-fixes.com/) leads with the agent outcome and demonstrates the handoff; [Marker.io](https://marker.io/) explains capture and developer context; [BugHerd](https://bugherd.com/) describes client capture and setup; [Pastel](https://usepastel.com/) leads with client review; [BugPin](https://bugpin.io/) states self-hosting directly. Apply the clarity and workflow demonstration, not their copy, capability claims or automatic-fix promises.

## Steps and progress

- [x] Inspect implementation, current landing and competitor approaches.
- [x] Obtain approval of the concise design direction.
- [x] Rewrite public positioning, setup navigation and role guides.
- [x] Add Help server URL copy and exact capture steps; align extension onboarding and Store copy.
- [x] Run builds, repository checks and desktop/mobile UI verification.
- [x] Complete independent design review and documentation receipt.

## Compatibility and recovery

No migrations or permissions change. The server address copy excludes paths and credentials. Clipboard failure leaves a selectable address and visible recovery message. Extension metadata moves to 0.1.31; building does not publish to the Store. Restore source files to revert copy/UI changes.

## Completion receipt

`npm run check` passed: 151 tests passed, 4 skipped; formatting, import/doc guards, generated catalogs, typecheck, builds, disposable smoke and release checks passed. After the final Help field correction, web/extension builds, release checks and desktop/mobile browser checks passed again. Source documentation additions also passed the harness checks.

Desktop (1440px) and mobile (390px) verification exercised all three landing workflow states, docs loading, Help server URL copy success and denied-clipboard recovery, with no horizontal overflow or browser errors. Extension first-run/settings captures are layout fixtures; this change does not claim fresh Chrome pairing or Store installation evidence.

The independent Impeccable reviewer confirmed the positioning, workflow truth, role guides and responsive composition. Its mobile URL field and design-persistence corrections were independently scored resolved; the final disposition was ship for those two corrections. DESIGN.md, PRODUCT.md and the design sidecar reflect the approved flow. The detector's inherited styles/token warnings were reviewed against actual screenshots; the new sample browser label was raised to 12px. Original screenshots and local QA receipt are ignored verification artifacts.

Artifact: public extension 0.1.31, blank default server, title and 116-character summary match the listing. Store listing text is in [Chrome Web Store listing](../chrome-web-store.md).

Deployment, live-domain verification and Chrome Web Store publication have not been performed.
