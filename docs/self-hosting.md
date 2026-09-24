# Self-hosting

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

## Guest replies and Turnstile

Guest discussion links are disabled until both `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` are configured. Create a [Cloudflare Turnstile widget](https://developers.cloudflare.com/turnstile/get-started/) for the exact application hostname, then supply the site key and secret through your deployment's private configuration. Keep the secret out of Git. Production rejects Cloudflare's documented test keys.

The guest page loads Cloudflare's widget and the server verifies each reply token through [Siteverify](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/). This optional feature therefore makes a request to Cloudflare; the core signed-in review workflow does not need Turnstile. The app also applies a per-IP ingress limit and caps each link's replies. Configure a shared ingress limit before running multiple application replicas.

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

Budget `DATABASE_POOL_MAX` across replicas and administrative clients. Start with one replica; multi-replica deployments require a shared ingress authentication throttle because the application limiter is process-local. Configure resource limits and alerting based on measured load.

Keep encrypted off-host PostgreSQL backups and an independent object-storage recovery policy. Test a restore into a separate environment before depending on it. Never use `docker compose down -v` on an installation whose data you need. For code rollback, reuse the original database and storage configuration only after checking schema compatibility. See [operations](operations.md).

## Public website

Build `npm run build:site` and host `dist/site` as static files, or use `docker compose -f compose.site.yaml up -d --build`. The site container listens on loopback port 8080 for a host reverse proxy. A container-based ingress can connect to its internal port instead. Terminate HTTPS at the ingress and configure HSTS there. The website needs no application database, storage keys or account session.

For independent forks, replace the official canonical URL, sitemap, repository and contact links under `site/` with your own before publishing.
