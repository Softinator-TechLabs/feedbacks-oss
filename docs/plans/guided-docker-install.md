# Plan: one-command Docker Hub quickstart

Status: 0.3.0 candidate installation verified; final stable-channel promotion pending. Date: 2026-10-21.

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

## 0.3.0 candidate acceptance

Application source: `4a8982e2485faed2937bd866cdbc4da358217475`; [exact-main CI, attempt 2](https://github.com/Softinator-TechLabs/feedbacks-oss/actions/runs/39629366205/attempts/2) passed all six jobs. The public [0.3.0 release](https://github.com/Softinator-TechLabs/feedbacks-oss/releases/tag/v0.3.0) downloads and checksums were verified. [Image publication](https://github.com/Softinator-TechLabs/feedbacks-oss/actions/runs/39632919326) passed both native architectures; public manifests, provenance and anonymous pulls were checked.

A single fresh candidate installation passed all twelve checks using the unchanged committed installer, candidate metadata and Compose pinned to `28b1c714c115388c4a983b670d0a71443eaa3da1`. Only the exact stable-metadata request was served locally; the installer downloaded the pinned Compose over HTTPS normally. Owner/CSRF/origin checks, non-root/read-only execution, loopback binding, private credentials and synthetic screenshot upload/readback passed. Recreating only that installation's app/PostgreSQL containers retained both named volume identities, the original owner login, project, thread and exact screenshot bytes. Anonymous screenshot access remained denied. The usable synthetic installation and volumes remain running; credentials and raw evidence stay private.

Final stable-channel publication, promotion PR/merged-main CI, public metadata/installer byte comparison and live guide verification remain pending. The candidate test is not a claim that the public stable channel has changed. Provider account consent and production HTTPS/S3/recovery acceptance remain independent of this local-volume test.
