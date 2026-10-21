# Plan: consistent 0.2.3 release artifacts

Status: in progress. Date: 2026-10-21.

## Outcome and scope

Publish current application, extension and native plugin artifacts with accurate versions, curated upgrade notes and honest official-directory status. Keep deployment credentials, launch assets and operational evidence outside tracked source.

## Evidence and approach

The application release 0.2.1 predates current main. Its generated notes still describe a draft. Reuse the [gated release workflow](../../.github/workflows/release.yml), [image workflow](../../.github/workflows/images.yml) and [release checks](../releasing.md), and derive packaged notes from the versioned [changelog](../../CHANGELOG.md).

## Steps and progress

- [x] Inspect versions, current CI and distribution status.
- [x] Prepare version, changelog and public directory status.
- [x] Verify release-note selection and missing-entry failure.
- [x] Run repository checks and merge preparation through required CI.
- [ ] Verify exact-source CI, publish artifacts/images, and download/check the published assets.

## Compatibility and recovery

This preparation changes release metadata and documentation, not database schemas or application behavior. Preserve prior tags/assets. Use additive versioned publication. Runtime upgrades follow the backup and schema-compatibility guidance in the changelog.

## Completion receipt

Source, exact-revision CI, published artifacts and deployment acceptance are recorded separately. A draft or workflow dispatch is not publication.

## Walkthrough finding

A clipboard permission request that never settles left task handoff busy indefinitely. Bound that request to three seconds, preserving the existing manual-copy dialog, and verify pending, successful and denied clipboard writes in [regression tests](../../tests/task-clipboard.test.ts). Browser readback confirms the full task text remains available through the fallback.
