# Releasing

## Prepare

1. Run `npm ci`, `npm run check`, `npm run test:postgres` and `npm audit`.
2. Review dependencies and notices. Generate an inventory with `npm sbom --sbom-format cyclonedx > dist/sbom.cdx.json`.
3. Run `npm run release:source`. It exports only approved source paths, refuses symlinks, includes licenses, creates a file checksum manifest and packages no Git history. Run `gitleaks dir dist/releases/source --redact` before distribution.
4. Inspect the exported source and ZIP contents, including docs and image assets. A scanner cannot determine whether internal business data belongs in a public repository.
5. Build/test the app and website containers using the commands below. Complete staging acceptance from `docs/operations.md` and Chrome acceptance from `docs/extension.md`.

```sh
docker build --tag feedbacks-app:check .
docker build --file Dockerfile.site --tag feedbacks-site:check .
npm run test:containers
```

The smoke check creates and removes its own disposable PostgreSQL, app and website containers. It uses synthetic credentials, memory-backed database storage and loopback ports. It verifies production startup, non-root/read-only operation, first-owner bootstrap, authentication and CSRF, packaged extension downloads, website routes and graceful shutdown. External S3 and TLS ingress require separate staging checks.

## Initial public repository

Existing private Git history may contain internal records even when the current source is clean. Review history separately; do not assume deleting a file removes it from history. Prefer creating the first public commit from the reviewed source export while preserving the original private repository. The archive itself never contains `.git`, secrets, feedback, dumps or operator inventory. `SOURCE-MANIFEST.sha256` is regenerated inside each source archive; do not maintain a stale copy in the working tree.

Confirm the intended GitHub owner/repository, license, copyright/provenance and security contact. Enable private vulnerability reporting, branch protection and required CI. Follow the [governance policy](../GOVERNANCE.md) for review; independent approval is not mandatory. Set the default branch and website link. Check all public links after publication. Repository visibility and DNS changes are explicit publication steps.

## Tag and publish

Update the application version and extension manifest version intentionally. They have separate version schemes. Rebuild extension ZIP/checksum/download metadata together. The package includes `LICENSE` and `NOTICE`; the source archive includes dependency/provenance documentation.

Tag only a reviewed commit. Publish the source archive, extension ZIP and checksums as release assets; include known limitations and upgrade instructions. Keep signing credentials and store credentials private. Do not upload generated artifacts in ordinary source commits.

The website has its own artifact and deployment. Never configure it with application or storage secrets. Hosted customer instances should consume the same application image with independent configuration and data.

## Rollback

Retain the previous image digest and extension package. Verify database compatibility before application rollback. Extension rollback may require a newer version number in a browser-store release. Do not delete persistent volumes, rewrite applied migrations or overwrite private object storage as part of rollback.
