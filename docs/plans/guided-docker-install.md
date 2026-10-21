# Plan: one-command Docker Hub quickstart

Status: in progress. Date: 2026-10-21.

## Outcome and scope

Put one copy-paste command at the top of the self-host guide. Pull the verified Docker Hub image, start PostgreSQL and Feedbacks with persistent local volumes, and generate the first owner login. No external storage credentials or source build should be necessary.

## Approach and boundaries

The [installer](../../site/public/install.sh) verifies its [quickstart Compose](../../site/public/compose.quickstart.yaml) download and pins the application digest. The app runs non-root with a read-only root filesystem, a writable named volume under the image's existing node-owned home, and a loopback-only published port. PostgreSQL remains private. Local development configuration permits HTTP and file storage; production HTTPS/S3 validation is unchanged.

Private credentials and a unique project name are generated for each new directory. Existing paths are refused. Partial-failure files and volumes remain available for recovery. No Docker installation, DNS changes, production upgrades or volume deletion are performed.

## Progress

- [x] Inspect released image, storage and bootstrap contracts.
- [x] Implement the local-volume installer and top-of-guide command.
- [x] Verify refusal, download integrity, private configuration, fresh installation and restart persistence.
- [ ] Build the site, pass required CI, merge and verify the live guide and installer.

## Compatibility and recovery

Existing application, extension and plugin release bytes are unchanged. Production deployments continue using their existing configuration and storage. Stop/recreate retains named volumes; deletion is a separate operator action. Keep the generated organization ID and private environment stable for this local installation.

## Verification

The published 0.2.3 application image was exercised through the installer with the checksum-matching candidate Compose. Owner sign-in, local screenshot upload/readback, non-root execution and private credential files passed. Recreating both containers retained the database and image. The existing-directory refusal preserved the running test stack. A browser sign-in and screenshot read confirmed the usable local UI. The official Docker Compose skill's quiet validator passed. Test credentials and raw receipts remain outside source. Live public download verification follows merge.

## Startup feedback and stable-channel follow-up

- [x] Reproduce an occupied loopback port and preserve the failed installation's volumes.
- [x] Show setup stages, image download progress and scoped start/stop/status/log commands.
- [x] Refuse an occupied port before downloading images or creating installation files.
- [x] Resolve fresh installs through reviewed stable metadata, validating its digest and commit-pinned Compose checksum without executing downloaded metadata.
- [x] Document local management, alternative ports, owner-bootstrap recovery and stable promotion.
- [ ] Verify regression checks, normal CI and published installer behavior.
