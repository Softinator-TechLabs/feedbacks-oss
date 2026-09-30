# Self-hosting

This is the server operator reference. Install one Feedbacks server for your company before connecting extensions or agents. The [DevOps walkthrough](../site-docs/guide/self-host.md) separates deployment from [owner project/member setup](../site-docs/guide/team-setup.md), [reviewer installation](../site-docs/guide/chrome-extension.md) and [developer MCP setup](../site-docs/guide/mcp.md).

Use your own domain, PostgreSQL database and S3-compatible object storage. Wasabi, AWS S3 and other compatible providers can be configured through the same environment variables. Compatibility depends on support for authenticated `PutObject` and `GetObject` requests with path-style addressing; verify upload and authorized readback with your chosen provider. No Softinator storage account is required.

## Local development

Follow the README. For video contact sheets outside Docker, install `ffmpeg` and `ffprobe` on the server PATH; the standard application image includes them. Missing decoders return explicit preview unavailability. `compose.dev.yaml` starts PostgreSQL on loopback and the application uses private local files under `.local/assets`. Local file storage is for development; production configuration requires S3.

## Production configuration

1. Copy `.env.example` to a private `.env` (mode `0600`) or supply the equivalent values from your deployment secret manager.
2. Set `APP_ORIGIN` to the exact HTTPS origin, without a trailing slash. Generate a strong database password, for example `openssl rand -hex 32`. Hex avoids URI-encoding errors in the Compose database URL.
3. Generate a unique organization UUID with `node -e 'console.log(crypto.randomUUID())'`. Preserve it for the lifetime of the installation.
4. Set `ASSET_DRIVER=s3` and configure your bucket below.
5. Configure a TLS reverse proxy and set `TRUST_PROXY_HOPS` to the exact number of trusted proxy hops. The app process defaults to `0`; production Compose defaults to `1` only if the variable is absent. Change the `0` from `.env.example` for your deployment. Restrict the app port to that ingress and have it overwrite forwarded headers. With a single proxy, use `1`.
6. Run `docker compose up -d --build --wait`. Map the app's internal port 3000 through the proxy; Compose does not publish it or the database to the host.

The standard image runs as a non-root user. Production Compose drops capabilities, uses a read-only root filesystem and provides temporary memory-backed space. Persistent records remain in PostgreSQL and object storage.

## Bring your own S3-compatible storage

| Variable               | What to supply                                  |
| ---------------------- | ----------------------------------------------- |
| `S3_ENDPOINT`          | Your provider's HTTPS regional service endpoint |
| `S3_REGION`            | The bucket's signing region                     |
| `S3_BUCKET`            | An existing private bucket you control          |
| `S3_ACCESS_KEY_ID`     | A dedicated application credential              |
| `S3_SECRET_ACCESS_KEY` | That credential's secret, supplied privately    |

For a Wasabi bucket in `eu-central-1`, the endpoint is `https://s3.eu-central-1.wasabisys.com` and the region is `eu-central-1`. For an AWS bucket in `eu-west-1`, use `https://s3.eu-west-1.amazonaws.com` and `eu-west-1`. Match the endpoint to your actual bucket region. An independently operated S3-compatible service must use HTTPS in production, with a certificate trusted by the runtime.

Keep the bucket private and require transport encryption. Grant the application only object read/write for its installation prefix, such as `feedbacks/production/organizations/<ORGANIZATION_ID>/*`. The application does not need bucket administration, ACL changes, public access or object deletion permission. Enable provider-side encryption, retention and backups according to your requirements. Do not share bucket credentials across customer organizations.

After bootstrap, upload a synthetic screenshot and verify an authorized read, rejection for an unrelated project member, and persistence after restarting the application. Endpoint configuration alone does not prove provider compatibility or a recoverable backup.

## Guest replies, project feedback and Turnstile

Guest discussion, project feedback links and project surveys are disabled until both `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` are configured. Create a [Cloudflare Turnstile widget](https://developers.cloudflare.com/turnstile/get-started/) for the exact application hostname, then supply the site key and secret through your deployment's private configuration. Keep the secret out of Git. Production rejects Cloudflare's documented test keys.

The provided Compose file forwards both optional variables from the deployment environment. Set them in your private `.env` or orchestrator secrets before recreating the app container.

The guest and survey pages load Cloudflare's widget and the server verifies each submission token through [Siteverify](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/), including the action and application hostname in production. This optional feature therefore makes a request to Cloudflare; the core signed-in review workflow does not need Turnstile. The app also applies a per-IP ingress limit and caps each link's replies or new feedback submissions. Survey links have their own expiry, response cap and revocation. Configure a shared ingress limit before running multiple application replicas.

For an embeddable website widget, configure the Cloudflare Turnstile site key for every exact approved website hostname as well as the Feedbacks hostname. The widget verifies the host hostname and `widget_submit` action on the server. The host site's Content Security Policy must permit the Feedbacks server for scripts, styles and cross-origin `fetch`, and permit `https://challenges.cloudflare.com` for scripts and frames. The widget sends text feedback, page URL and viewport context; use the Chrome extension for private screenshot capture. Test the actual host site and browser before sharing the snippet; a local sandbox only proves the synthetic flow.

## Create the first owner

The production image includes `dist/cli/bootstrap.js`. Bootstrap runs once and refuses to replace an existing owner. Supply the password through standard input, not a command-line argument or an image layer:

```sh
# Read privately using your shell's hidden-input facility or a secret manager.
# FEEDBACKS_BOOTSTRAP_PASSWORD must already be set in this operator shell.
printf '%s' "$FEEDBACKS_BOOTSTRAP_PASSWORD" | docker compose exec -T \
  -e BOOTSTRAP_EMAIL=owner@example.com -e BOOTSTRAP_NAME=Owner \
  app node dist/cli/bootstrap.js
unset FEEDBACKS_BOOTSTRAP_PASSWORD
```

Sign in through the HTTPS origin and use the account controls to invite members. There is no public registration or bootstrap route. Remove bootstrap credentials from operator environments after use.

## Updates, recovery and capacity

Pin a reviewed source revision or image digest. Back up the database and confirm compatibility before applying migrations. Startup takes a transaction advisory lock before running migrations. Health is exposed at `/healthz`; `/readyz` checks the database but does not test object storage.

Budget `DATABASE_POOL_MAX` across replicas and administrative clients. Password sign-in failures are tracked by normalized client IP in PostgreSQL: the third failure within five minutes blocks that IP for five minutes and returns `Retry-After`. A successful sign-in clears its count. People sharing an IP share this limit, so verify the proxy's real client-IP forwarding. Start with one replica; multi-replica deployments still require a shared ingress throttle because the broader request limiter is process-local. Configure resource limits and alerting based on measured load.

Keep encrypted off-host PostgreSQL backups and an independent object-storage recovery policy. Test a restore into a separate environment before depending on it. Never use `docker compose down -v` on an installation whose data you need. For code rollback, reuse the original database and storage configuration only after checking schema compatibility. See [operations](operations.md).

## Public website

Build `npm run build:site` and host `dist/site` as static files, or use `docker compose -f compose.site.yaml up -d --build`. The site container listens on loopback port 8080 for a host reverse proxy. A container-based ingress can connect to its internal port instead. Terminate HTTPS at the ingress and configure HSTS there. The website needs no application database, storage keys or account session.

For independent forks, replace the official canonical URL, sitemap, repository and contact links under `site/` with your own before publishing.

## Multiple GitHub Apps

One Feedbacks server can use a different GitHub App for each project. Each
independent self-hosted server should use its own App credentials; never share
an App private key with other operators. GitHub integration stays optional.

### Encrypted management in Feedbacks

A signed-in human server owner opens **Setup → Manage integrations → GitHub → Add GitHub
account** and chooses **Encrypted in Feedbacks**. Enter the organization or
personal username, then **Continue to GitHub**. Sign in with a GitHub login
allowed to create Apps for that account. GitHub asks the owner/App manager to
approve a private App with Metadata read and Issues read/write. Feedbacks saves
its verified credentials automatically; no per-App environment change or
restart is required. Install it on selected repositories, then select it in
the project's GitHub tab and connect those repositories.

The flow uses [GitHub's App manifest registration](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest)
(checked 2026-09-30), with `public:false`, no OAuth request and inactive
webhooks. The one-time setup state is bound to the current Feedbacks session,
expires after 30 minutes and is consumed before code exchange. Returning from
GitHub uses a same-origin bridge so the ordinary Strict session and CSRF
checks remain in effect. Stay signed in to the same Feedbacks session.

**Connect existing App** accepts its numeric App ID and a PEM file generated
in GitHub App settings. It verifies the RSA key, registration owner and minimum
permissions before saving. **Manage App** supports a local name, key replacement,
disconnect and reconnect. A disconnected App retains its credentials and Issue
history; it does not uninstall or delete the App on GitHub. Key replacement
preserves disconnected state. GitHub visibility is controlled in GitHub: the
manual import API cannot certify that an existing App is private.

For an environment-configured App, **Manage here** optionally verifies and
copies the existing key into encrypted storage, preserving approved-account
policy and App identity. The environment remains untouched; the saved record
overrides that App ID, including when disconnected. Keep the old configuration
until backup and recovery have been verified.

#### Storage and security

| Choice                 | Credentials and changes                                                                                                                                     | Recovery                                                                                                  |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Encrypted in Feedbacks | AES-256-GCM encrypted PEM in PostgreSQL; random per-record encryption key in existing private local/S3 storage. Human owners manage Apps without a restart. | Restore the database and private storage together, or upload a valid replacement key for the same App ID. |
| Deployment environment | PEM is injected through the operator's secret environment. No managed key record is created. Changes require a server restart.                              | Restore the operator's deployment secrets and database.                                                   |

Base64 is encoding, not encryption. A database dump alone cannot decrypt
managed PEMs. Access to both the database and private key objects, or control
of the running server, can expose them. Environment credentials are also
available to the running server and its administrators. Neither choice protects
against a compromised server. Limit human server owners, secure deployment and
storage access, use HTTPS and grant only selected GitHub repositories.

Managed encryption keys live under `feedbacks/<production|development>/organizations/<ORGANIZATION_ID>/server-secrets/github-apps/` in the existing
private AssetStore. Normal attachment APIs require authorized asset metadata
and cannot request these objects. Do not make the bucket public or exclude
this prefix from backups. Preserve the original `ORGANIZATION_ID` and storage prefix/mode when restoring:
encrypted credentials are bound to that server identity. Share the same database
and private store across replicas. Credential operations fail closed if private storage is missing or
modified; metadata lists still work. The readiness endpoint does not verify
object storage. Old key objects are retained after rotation and unknown commit
outcomes to avoid destroying recoverable credentials; there is no automatic
secret-object retention or garbage collection.

### Deployment environment

Choose **Deployment environment** in the owner page for the manual setup
instructions. Register an App in GitHub with Metadata read and Issues read/write,
then install it on the required repositories. Keep a private App on its owning
account; separate private Apps support different GitHub accounts without making
one public. Use your deployment platform's secret editor.

The legacy default uses `GITHUB_APP_ID`, `GITHUB_APP_SLUG` and
`GITHUB_APP_PRIVATE_KEY_BASE64`. Additional Apps use `GITHUB_APPS_JSON`, a JSON
array of up to 20 entries. Replace these synthetic values:

```json
[
  {
    "id": "123456",
    "name": "Team A private App",
    "slug": "team-a-feedbacks",
    "privateKeyBase64": "BASE64_ENCODED_RSA_PEM",
    "owners": ["team-a"]
  }
]
```

`owners` lists approved GitHub organization/personal account names, not human
Feedbacks users or logins managing an organization. Additional environment Apps
require at least one approved account (up to 20). The legacy default preserves
its existing installation policy. Browser-created/imported Apps initially
restrict repositories to their verified registration owner; adoption and
rotation of an existing App preserve its approved-account policy. GitHub also
checks every installation and selected repository.

For Compose `.env`, put compact JSON on one line in a single-quoted value.
Protect that file from source control and shell history. Restart after changing
environment secrets. Invalid configuration fails startup without printing the
secret. Environment Apps stay listed and usable without choosing **Manage here**.

### Assignment and compatibility

The catalog retains at most 21 distinct Apps across both storage choices,
including disconnected records. App IDs and slugs must be unique. A project
chooses one App and can connect up to 20 repositories accessible to it. Only a
signed-in human server owner can select/clear the project's App. Maintainers
connect repositories; agent/extension keys cannot manage Apps. Projects without
an explicit assignment keep the legacy default; **No App selected** explicitly
disables integration.

Changing project App clears connections and sync. Pending Issue writes,
uncertain sync and active leases block switching/disconnecting. Existing Issue
links and requests retain their original App identity. A verified same-ID key
replacement is allowed during pending writes so lost/revoked credentials can
be recovered before reconciliation; it never retries the uncertain Issue POST.
Never replace a historical App identity with another App's credentials.

Migration 27 adds the request App identity. Migration 28 adds encrypted managed
records and expiring setup requests without rewriting prior data or object keys.
Back up before upgrading. Older builds ignore managed overrides and may reuse
environment credentials: disable GitHub writes/sync before rollback and deploy
a compatible forward fix before resuming. Preserve the database, storage and
original environment default for historical links.
