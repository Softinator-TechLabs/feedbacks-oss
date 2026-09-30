# Visual task guides and reliable release preparation

Status: local verification complete; CI and public deployment pending. Date: 2026-09-30.

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
- [ ] Pass required CI, deploy docs and verify public routes.

## Compatibility and recovery

Static docs presentation and opt-in release automation. No database, credential or extension permission changes. The release workflow does not choose a version or create a tag. Revert website source for presentation rollback; already-published releases are never overwritten.

## Decision log

Short guides lead with the next action. Exact configuration, recovery and protocol details stay linked to canonical manuals or a focused disclosure. Steps are HTML-rendered for accessibility and search, with ordinary text retained in exported Markdown. Use the existing secret-free plugin and extension packaging paths.

## Completion receipt

Local verification: formatting, harness, types, all builds, disposable smoke and release checks pass. The bounded full suite has 483 passing tests, 33 opt-in skips and zero failures, including eleven release-automation cases. Browser checks pass on 19 routes at desktop and mobile sizes, with dark, keyboard and no-JavaScript checks. Independent review findings were corrected and confirmed. CI and public deployment receipts are recorded in the delivery PR. Registry and client distribution remain separate tracked work; draft workflow execution needs a new reviewed version tag and is not claimed from a local build.

Distribution follow-ups: [next release](https://github.com/Softinator-TechLabs/feedbacks-oss/issues/175), [Docker Hub](https://github.com/Softinator-TechLabs/feedbacks-oss/issues/176), [one-click templates](https://github.com/Softinator-TechLabs/feedbacks-oss/issues/177), [Codex distribution](https://github.com/Softinator-TechLabs/feedbacks-oss/issues/178), [Claude Code package](https://github.com/Softinator-TechLabs/feedbacks-oss/issues/179).
