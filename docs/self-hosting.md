# Self-hosting

This is the server operator reference. Install one Feedbacks server for your company before connecting extensions or agents. The [DevOps walkthrough](../site-docs/guide/self-host.md) separates deployment from [owner project/member setup](../site-docs/guide/team-setup.md), [reviewer installation](../site-docs/guide/chrome-extension.md) and [developer MCP setup](../site-docs/guide/mcp.md).

Use your own domain, PostgreSQL database and S3-compatible object storage. Wasabi, AWS S3 and other compatible providers can be configured through the same environment variables. Compatibility depends on support for authenticated `PutObject` and `GetObject` requests with path-style addressing; verify upload and authorized readback with your chosen provider. No Softinator storage account is required.

## Local development

Follow the README. `compose.dev.yaml` starts PostgreSQL on loopback and the application uses private local files under `.local/assets`. Local file storage is for development; production configuration requires S3.

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

The optional GitHub integration can use a different App for each project on one
Feedbacks server. Additional Apps are configured by DevOps in the secret
`GITHUB_APPS_JSON`; private keys remain deployment secrets, not browser fields
or database values. No dependency or external credential broker is required.

Set a JSON array of up to 20 additional Apps. These illustrative values must be
replaced with your own App IDs, slugs, and base64-encoded RSA PEM keys:

```json
[
  {
    "id": "123456",
    "name": "Team A private App",
    "slug": "team-a-feedbacks",
    "privateKeyBase64": "BASE64_ENCODED_RSA_PEM",
    "owners": ["team-a"]
  },
  {
    "id": "234567",
    "name": "Team B private App",
    "slug": "team-b-feedbacks",
    "privateKeyBase64": "BASE64_ENCODED_RSA_PEM",
    "owners": ["team-b"]
  }
]
```

`owners` means approved GitHub organization/personal account names, **not**
Feedbacks users or every login that manages that organization. Every additional
App requires at least one approved account. The server denies repository access
outside that list before sending a request to GitHub. App IDs and slugs must be
unique, including the legacy default. The list is limited to 20 Apps, each with
up to 20 accounts. A project chooses one App and can connect up to 20 repositories
accessible to that App. Install each App with Metadata read and Issues read/write
and choose only the required repositories. Webhooks and OAuth are not required.

Use your deployment platform's secret editor. When using a Compose `.env` file,
put compact JSON on one line in a single-quoted value. Protect that file from
source control and shell history. Base64 is encoding, not encryption. Restart
the server after changing deployment secrets. Invalid configuration fails
startup with a generic error that does not print the secret.

Keep `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, and `GITHUB_APP_PRIVATE_KEY_BASE64`
unchanged to preserve the existing default App. Projects without an explicit
assignment keep that default. New installations using only `GITHUB_APPS_JSON`
require the server owner to select an App in each project's GitHub tab. Only a
signed-in human server owner can select/clear it; maintainers and agent/extension
keys cannot assign Apps. **No App selected** explicitly disables that project's
integration, even if a legacy default exists.

Changing App pauses connections/sync and requires repository reconnection.
Pending writes or an active sync lease block switching until settled. Historical
Issue reservations and verified links retain the original App ID. Keep legacy
credentials available for older links without an App ID. Missing credentials
fail closed; restore that same App ID to recover. Rotate a key under the same App
ID to preserve routing. Do not reuse a removed App ID for a different identity.

Migration 27 only adds a nullable App-ID column to existing Issue reservations;
it does not rewrite applied migrations or existing Issue URLs. Back up the
database and deployment secrets together. Older code does not understand
project App selections: disable GitHub writes/sync before rolling back and
restore a compatible release before enabling them again.
