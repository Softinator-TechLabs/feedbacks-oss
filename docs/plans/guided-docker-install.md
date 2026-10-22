# Plan: one-command Docker Hub quickstart

Status: complete; 0.3.2 candidate verified for stable-channel promotion. Date: 2026-10-22.

## Outcome and scope

Put one copy-paste command at the top of the self-host guide. Pull the verified Docker Hub image, start PostgreSQL and Feedbacks with persistent local volumes, and generate the first owner login. No external storage credentials or source build should be necessary.

## Approach and boundaries

The [installer](../../site/public/install.sh) verifies its [quickstart Compose](../../site/public/compose.quickstart.yaml) download and pins the application digest. The app runs non-root with a read-only root filesystem, a writable named volume under the image's existing node-owned home, and a loopback-only published port. PostgreSQL remains private. Local development configuration permits HTTP and file storage; production HTTPS/S3 validation is unchanged.

Private credentials and a unique project name are generated for each new directory. Existing paths are refused. Partial-failure files and volumes remain available for recovery. No Docker installation, DNS changes, production upgrades or volume deletion are performed.

## Progress

- [x] Inspect released image, storage and bootstrap contracts.
- [x] Implement the local-volume installer and top-of-guide command.
- [x] Verify refusal, download integrity, private configuration, fresh installation and restart persistence.
- [x] Build the site, pass required CI, merge and verify the live guide and installer.

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
- [x] Verify regression checks, normal CI and published installer behavior.

## 0.3.0 candidate acceptance

Application source: `4a8982e2485faed2937bd866cdbc4da358217475`; [exact-main CI, attempt 2](https://github.com/Softinator-TechLabs/feedbacks-oss/actions/runs/39629366205/attempts/2) passed all six jobs. The public [0.3.0 release](https://github.com/Softinator-TechLabs/feedbacks-oss/releases/tag/v0.3.0) downloads and checksums were verified. [Image publication](https://github.com/Softinator-TechLabs/feedbacks-oss/actions/runs/39632919326) passed both native architectures; public manifests, provenance and anonymous pulls were checked.

A single fresh candidate installation passed all twelve checks using the unchanged committed installer, candidate metadata and Compose pinned to `28b1c714c115388c4a983b670d0a71443eaa3da1`. Only the exact stable-metadata request was served locally; the installer downloaded the pinned Compose over HTTPS normally. Owner/CSRF/origin checks, non-root/read-only execution, loopback binding, private credentials and synthetic screenshot upload/readback passed. Recreating only that installation's app/PostgreSQL containers retained both named volume identities, the original owner login, project, thread and exact screenshot bytes. Anonymous screenshot access remained denied. The usable synthetic installation and volumes remain running; credentials and raw evidence stay private.

[Promotion PR #236](https://github.com/Softinator-TechLabs/feedbacks-oss/pull/236) merged as `b8643fe629177d965810011de0d3ded9232a82bc`. [Exact merged-main CI](https://github.com/Softinator-TechLabs/feedbacks-oss/actions/runs/39638770905) passed all six jobs; [public-site deployment](https://github.com/Softinator-TechLabs/feedbacks-oss/actions/runs/39640715835) succeeded at the same source. The live deployment receipt matched that revision. Public stable metadata matched the tested 0.3.0 candidate byte for byte; the public installer matched application source `4a8982e2485faed2937bd866cdbc4da358217475`, and the commit-pinned Compose matched checksum `2c078743924d3c0d5128fa79ad354083944acfe904024a5b12a269eceeeecc12`. The live self-host guide in HTML and Markdown showed 0.3.0 and task-app setup with optional Jira broker and OpenProject environment guidance. The existing twelve-check candidate installation supplies fresh-install and persistence evidence. Provider account consent and production HTTPS/S3/recovery acceptance remain independent of this local-volume test.

## 0.3.1 candidate and stable-channel promotion

Application source: `6387b8d61971edaf75063aaeb6478a73f41542c5`; [exact-main CI](https://github.com/Softinator-TechLabs/feedbacks-oss/actions/runs/39648999766), attempt 1, passed all six jobs. The public [0.3.1 release](https://github.com/Softinator-TechLabs/feedbacks-oss/releases/tag/v0.3.1) downloads and checksums were verified. [Image publication](https://github.com/Softinator-TechLabs/feedbacks-oss/actions/runs/39651299190) passed native AMD64/ARM64 checks, with public manifests, parsed SBOM/provenance and actual anonymous pulls.

One fresh 0.3.1 candidate installation passed all twelve checks using the unchanged committed installer, reviewed candidate metadata and Compose pinned to `28b1c714c115388c4a983b670d0a71443eaa3da1`. The application image was pinned to `softinator/feedbacks@sha256:2194f20730c72539dde549bf4c2ff1a95032839e46aed5f83eab873f55a4a422`. The installer SHA-256 remained `666641f2d440b496e6892dcdbe14595d1eb4abdf2e3e350f7d7305d5f03800bb`; the downloaded Compose matched `2c078743924d3c0d5128fa79ad354083944acfe904024a5b12a269eceeeecc12`.

Only the exact stable-metadata request was served from the candidate; the installer downloaded the pinned Compose over HTTPS normally. Owner/CSRF/origin checks, non-root/read-only execution, loopback binding, private credentials and authenticated exact screenshot readback passed. Recreating only the new installation's app/PostgreSQL containers retained both named volume identities, its original owner login, project, thread and exact screenshot bytes. Anonymous screenshot access remained denied. The prior 0.3.0 installation was checked separately: its container IDs, image digest and named volume identities were unchanged, and readiness still passed. Both usable synthetic installations and their persistent volumes remain available.

The stable-channel update selects this tested 0.3.1 image through reviewed metadata and the normal promotion CI/site workflow. Public deployment-source and metadata/installer/Compose byte comparisons remain part of the [promotion procedure](../releasing.md#promote-the-local-quickstart); operational receipts stay outside public source. Existing installations retain their saved image digest. This local-volume acceptance does not establish production HTTPS/S3/recovery or live provider-account consent.

## 0.3.2 candidate and stable-channel promotion

Application source: `97e3422edd3373f61d65b768afe2a2b70d12626a`; [exact-main CI](https://github.com/Softinator-TechLabs/feedbacks-oss/actions/runs/39717210572), attempt 1, passed all six jobs. The public [0.3.2 release](https://github.com/Softinator-TechLabs/feedbacks-oss/releases/tag/v0.3.2) downloads and seven checksums were verified. [Image publication](https://github.com/Softinator-TechLabs/feedbacks-oss/actions/runs/39718589357) passed native AMD64/ARM64 checks. Public manifests, exact source/version labels, parsed SBOM/provenance and actual anonymous pulls passed.

One successful fresh 0.3.2 candidate installation passed all twelve checks with the unchanged installer and reviewed candidate metadata. It pins `softinator/feedbacks@sha256:cfd1284fc9d84e10e4ba9afba11397d472ce851d992ec45ed16fb5f4895d8911`. The installer SHA-256 remains `666641f2d440b496e6892dcdbe14595d1eb4abdf2e3e350f7d7305d5f03800bb`; Compose stays pinned to `28b1c714c115388c4a983b670d0a71443eaa3da1`, checksum `2c078743924d3c0d5128fa79ad354083944acfe904024a5b12a269eceeeecc12`.

Only the exact stable-metadata request used the candidate; the installer downloaded the pinned Compose over HTTPS and pulled its images normally. Owner bootstrap, authentication/CSRF/origin, non-root/read-only execution, loopback binding, private credentials, exact screenshot readback and anonymous denial passed. Recreating only the new installation's two containers retained both named volume identities, owner login, project, thread and exact screenshot bytes. An earlier Docker Hub timeout created no containers or volumes; its partial files and receipts were preserved before connectivity diagnosis and one controlled retry. Both prior 0.3.0 and 0.3.1 installations remained ready with unchanged container, image and volume identities. All three usable installations and their data remain available.

The reviewed stable-channel update selects this tested candidate. Its later promotion commit, exact-main CI, public-site deployment and public metadata/installer/Compose byte equality are verified separately through the [promotion procedure](../releasing.md#promote-the-local-quickstart). Existing installations retain their saved digests. Local-volume acceptance remains separate from production HTTPS/S3/recovery and real provider-account consent; credentials and raw operational evidence stay outside source.
