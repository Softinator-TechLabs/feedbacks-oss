# Plan: consistent 0.2.3 release artifacts

Status: complete. Date: 2026-10-21.

## Outcome and scope

Publish current application, extension and native plugin artifacts with accurate versions, curated upgrade notes and honest official-directory status. Keep deployment credentials, launch assets and operational evidence outside tracked source.

## Evidence and approach

The application release 0.2.1 predates current main. Its generated notes still describe a draft. Reuse the [gated release workflow](../../.github/workflows/release.yml), [image workflow](../../.github/workflows/images.yml) and [release checks](../releasing.md), and derive packaged notes from the versioned [changelog](../../CHANGELOG.md).

## Steps and progress

- [x] Inspect versions, current CI and distribution status.
- [x] Prepare version, changelog and public directory status.
- [x] Verify release-note selection and missing-entry failure.
- [x] Run repository checks and merge preparation through required CI.
- [x] Verify exact-source CI, publish artifacts/images, and download/check the published assets.

## Compatibility and recovery

This preparation changes release metadata and documentation, not database schemas or application behavior. Preserve prior tags/assets. Use additive versioned publication. Runtime upgrades follow the backup and schema-compatibility guidance in the changelog.

## Completion receipt

Application source: `1bbdbabf718d9c8dc551243256efdf118703f711`. All six required jobs passed in [exact-source CI](https://github.com/Softinator-TechLabs/feedbacks-oss/actions/runs/39533813828).

- [Application release 0.2.3](https://github.com/Softinator-TechLabs/feedbacks-oss/releases/tag/v0.2.3): source, extension 0.1.60, native plugins 0.2.3, SBOM and checksums published; all seven checksummed files were downloaded and verified. The extension ZIP matches the existing 0.1.60 release byte for byte.
- [Image publication](https://github.com/Softinator-TechLabs/feedbacks-oss/actions/runs/39534555349): native AMD64 and ARM64 smoke checks passed. Versioned application/site manifests and their provenance are public; image digests are attached to the release. An anonymous application pull passed.
- [Native marketplace release](https://github.com/Softinator-TechLabs/feedbacks-plugins/releases/tag/v0.2.3): exact canonical bundles and portable MCPB published; a fresh isolated Claude Code installation matched all 22 published plugin files. The official MCP Registry accepted version 0.2.3 with the matching bundle hash.
- A fresh digest-pinned Compose installation with PostgreSQL and isolated S3-compatible test storage passed owner bootstrap, private screenshot upload/readback, actual Claude thread/image read and an authorized reply, project isolation, restart persistence and revoked-key denial. Synthetic objects were removed and the test key revoked. This local check did not exercise public TLS ingress or certify production backup/restore.

Official Anthropic publication and OpenAI local-MCP submission access remain separate review gates. They do not block direct installation. No official-directory approval or production deployment is inferred from these release checks.

## Walkthrough finding

A clipboard permission request that never settles left task handoff busy indefinitely. Bound that request to three seconds, preserving the existing manual-copy dialog, and verify pending, successful and denied clipboard writes in [regression tests](../../tests/task-clipboard.test.ts). Browser readback confirms the full task text remains available through the fallback.
