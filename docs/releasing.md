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

Tag only a reviewed commit on `main`, after its complete [CI workflow](../.github/workflows/ci.yml) succeeds. The application tag is exactly `v<package.json version>`; bump that version for every application release. Extension and plugin versions are read from their own manifests, and must be bumped when their package contents change. An extension version such as `0.1.54` does not mean the application needs a `v0.1.54` tag.

The [release workflow](../.github/workflows/release.yml) runs on a pushed version tag, or can be dispatched from `main` with an existing exact tag. It refuses a target outside `origin/main`, a tag/version mismatch, or a target without successful `main` push CI at that exact SHA. It requires both Node check jobs, container checks, extension/browser checks, Android build and secret scanning. A tag pushed before CI completes will fail safely; dispatch the same tag after CI succeeds.

The workflow installs the committed lockfile, rebuilds all packages from a clean `dist`, runs `check:release`, exports approved source, generates a CycloneDX SBOM and scans the exported directory with the same checksum-pinned Gitleaks binary as CI. The [preparation helper](../scripts/prepare-release.mjs) checks input hashes, archive versions and extension download metadata. It collects only the current source archive, public extension ZIP, versioned standalone Codex and Claude Code plugins and SBOM, plus source/version metadata, notes and `SHA256SUMS`. Old files and arbitrary files in `dist` are excluded.

Its final job creates a **GitHub draft release**. Only that job receives repository write permission. The target and CI are checked again immediately before this step. Draft discovery uses the authenticated, paginated releases list. A retry for the same tag and SHA skips assets with matching digests and uploads missing known assets; it never deletes or overwrites existing assets. Unrelated assets remain intact. An already published release is refused. Keep the draft unpublished while a retry is running: the API does not make the state check and upload atomic. Review the source export and archives, fill in upgrade instructions and known limitations, then publish the draft intentionally in GitHub. The workflow does not create tags or publish a release automatically. Keep signing and store credentials private, and do not commit generated artifacts.

If an existing asset has a different or unavailable digest, the workflow stops for manual draft recovery. Prefer rerunning only the failed draft job, which downloads the original preparation job's artifact. Rebuilding the complete workflow may change archive or SBOM timestamps and therefore checksums. If a fresh preparation is needed, inspect and recover the unpublished draft in GitHub before retrying; preserve any maintainer-authored notes or additional assets. Never remove assets from a published release to make a retry pass. The [GitHub releases API](https://docs.github.com/en/rest/releases/releases#list-releases) documents draft visibility and the list endpoint.

For a local preparation dry run, after the checks in **Prepare** and a fresh `npm run build`:

```sh
npm run check:release
npm run release:source
npm sbom --sbom-format cyclonedx > dist/releases/sbom.cdx.json
gitleaks dir dist/releases/source --redact
node scripts/prepare-release.mjs prepare v0.2.0
cd dist/releases/github
sha256sum --check SHA256SUMS
```

Replace `v0.2.0` with the actual application version. On macOS, use `shasum -a 256 -c SHA256SUMS` for checksum verification. Preparation writes ignored local artifacts and contacts no publishing service. It records the current checkout SHA, so run it on the intended clean release checkout. Remote tag ancestry and CI verification happen in the workflow, or with `node scripts/prepare-release.mjs verify <tag>` using a read-only GitHub token.

Container registry publication, hosted deployment and Chrome Web Store upload/review remain separate release steps. This workflow produces the ZIP for manual Store submission; it does not upload it, submit it for review or claim that the installed Store extension has updated. Future Store automation requires the authorized publisher account and scoped credentials; follow the [official Chrome Web Store API guide](https://developer.chrome.com/docs/webstore/using-api). GitHub draft review follows [GitHub's release management guide](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository).

The website has its own artifact and deployment. Never configure it with application or storage secrets. Hosted customer instances should consume the same application image with independent configuration and data.

## Rollback

Retain the previous image digest and extension package. Verify database compatibility before application rollback. Extension rollback may require a newer version number in a browser-store release. Do not delete persistent volumes, rewrite applied migrations or overwrite private object storage as part of rollback.

## Extension releases

Every change to the distributed extension needs a new manifest version and a published release after merging to `main`. Compare against the latest `origin/main` immediately before merge, including changes to bundled dependencies and packaging inputs. Documentation-only changes do not require an extension version bump.

1. Require all six CI jobs listed in **Tag and publish** to succeed on the exact merged `main` revision. Check out that revision with a clean working tree and use the committed lockfile.
2. Run `npm run build:extension`. Inspect `dist/extension/feedbacks-extension-VERSION.zip`: `manifest.json` must be at the archive root with the new version, the changed files must match the merged source, and license/notice files must be present. Verify its adjacent `.sha256` file and the generated server download metadata.
3. Publish the extension in a new application release, or create an extension-only tag `extension-vVERSION` at that exact revision. An extension-only release uses a distinct tag and does not change the application version or replace its latest release. Never move an existing published tag or replace its assets.
4. For an extension-only release, attach the public versioned ZIP, its `.sha256` file and `extension-release.json`. Include the full source SHA, CI evidence, changed behavior, compatibility, update instructions and known limitations in the release notes. Review a draft, then publish it; a draft is not delivery. The application release workflow does not handle extension-only tags, so publish these with GitHub or `gh release`.
5. Download the published assets into a fresh directory. Verify the checksum, archive manifest version, source revision/tag and download metadata against the package. Give reviewers the published release link and exact upload ZIP.
6. Record hosted deployment and Chrome Web Store submission/publication separately. The inner versioned ZIP is the Store upload artifact, not an outer handoff bundle. If publisher access is unavailable, hand off that ZIP and leave Store publication explicitly pending.

## Docker Hub images

The [image publication workflow](../.github/workflows/images.yml) runs manually from `main` with an existing application tag. It requires successful main CI on the exact tagged source and uses separate native AMD64 and ARM64 runners. Each runner builds both application and static-site images, runs the production container smoke check, then publishes architecture tags with SBOM/provenance attestations. The versioned multi-platform tags are assembled only after both jobs succeed. Existing or unverifiable version tags are refused; the workflow does not move `latest`.

A publisher configures the repository variable `DOCKERHUB_NAMESPACE` and private Actions secrets `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN`. Create the public `feedbacks` and `feedbacks-site` repositories in that namespace before dispatch. Scope the publisher token to the required image repositories where the registry supports it. Registry login is removed at job completion.

After publication, inspect the manifest, record the application digest and verify an anonymous pull. Use [registry Compose](../compose.registry.yaml) with `FEEDBACKS_IMAGE=namespace/feedbacks@sha256:<verified digest>` and the same private production values from [self-hosting](self-hosting.md). This Compose file preserves PostgreSQL in a named volume and does not expose database or app ports directly. TLS ingress and actual storage upload/readback must be verified separately. The static-site image requires no application secrets.
