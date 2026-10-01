---
description: Deploy one Feedbacks server for your organization, verify private media and hand it to the team.
---

# DevOps: one server for the team

One installation serves one organization. Deploy a shared HTTPS server; reviewers connect to it from the extension.

<DocPath :steps="['Provision', 'Deploy', 'Verify', 'Hand over']" />

<Demo step="server" />

## Gather the prerequisites

Use the [illustrated storage guide](/guide/storage) to prepare a server, domain, PostgreSQL, private bucket and dedicated application key. It maps each value to its deployment field and includes the storage policy and recovery checks.

## Bring the server online

The [public Docker Hub image](https://hub.docker.com/r/softinator/feedbacks) supports `linux/amd64` and `linux/arm64`. You need Docker with Compose; Node.js and a source build are not required on the host. This Compose starts PostgreSQL with a persistent volume.

### 1. Download Compose

In a new installation directory, download the [0.2.1 release Compose](https://github.com/Softinator-TechLabs/feedbacks-oss/blob/v0.2.1/compose.registry.yaml) as `compose.yaml`:

```sh
mkdir feedbacks-server
cd feedbacks-server
curl -fL https://raw.githubusercontent.com/Softinator-TechLabs/feedbacks-oss/v0.2.1/compose.registry.yaml -o compose.yaml
umask 077
touch .env
chmod 600 .env
```

### 2. Fill the private environment

Paste these fields into `.env`, then fill every empty value. Use your HTTPS origin, private bucket and scoped application key from the [storage guide](/guide/storage). Generate a database password with `openssl rand -hex 32` and a unique organization UUID with `uuidgen`; preserve both for this installation. `TRUST_PROXY_HOPS=1` assumes one trusted reverse proxy; match your actual ingress path.

```dotenv
FEEDBACKS_IMAGE=softinator/feedbacks@sha256:f7d759e671b48906a4aa5deff92b4644a73a6a4239f32b4cebba5cfcef8cc97b
APP_ORIGIN=
POSTGRES_PASSWORD=
ORGANIZATION_ID=
TRUST_PROXY_HOPS=1
S3_ENDPOINT=
S3_REGION=
S3_BUCKET=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
```

Keep `.env` private. The Compose file sets production mode, the database connection and S3 storage itself. Optional [GitHub Apps](/guide/github), guest links and surveys have separate configuration.

### 3. Start the server

```sh
docker compose config --quiet
docker compose pull
docker compose up -d --wait
docker compose ps
```

Connect your HTTPS reverse proxy to service `app`, port `3000`. Compose keeps the app and database ports private; running `up` alone does not create a public URL. `--wait` checks container startup and PostgreSQL health; verify application readiness and media below.

### 4. Create the owner

[Bootstrap the first owner](/reference/manual/self-hosting#create-the-first-owner) once, supplying the password on standard input. Use the commands from that section in this installation directory, then sign in through your HTTPS URL.

### Install through Dokploy

Choose **Docker Compose**, import the same release file, set its environment values and route service `app`, port `3000`, through your HTTPS domain. In the app container terminal, bootstrap with the operator-supplied password on standard input:

```sh
# Set FEEDBACKS_BOOTSTRAP_PASSWORD privately in this terminal first.
printf '%s' "$FEEDBACKS_BOOTSTRAP_PASSWORD" | \
  BOOTSTRAP_EMAIL=owner@example.com BOOTSTRAP_NAME=Owner node dist/cli/bootstrap.js
unset FEEDBACKS_BOOTSTRAP_PASSWORD
```

Replace the owner email. A custom Compose import works independently of catalog availability.

For a source build, follow the [production reference](/reference/manual/self-hosting#production-configuration). If you keep the downloaded filename `compose.registry.yaml`, include `-f compose.registry.yaml` in every Compose command, including bootstrap and logs.

## Verify before handoff

| Check         | Required proof                                            |
| ------------- | --------------------------------------------------------- |
| App health    | `/healthz` and `/readyz`                                  |
| Private media | Upload a synthetic screenshot; verify authorized readback |
| Recovery      | Test backup and restore separately                        |
| Team access   | Open the exact HTTPS URL from another approved device     |

Health endpoints do not prove storage or recovery. A developer's `localhost` is not a shared team address.

Privately hand the owner the server URL and initial sign-in details. Continue with [project and member setup](/guide/team-setup). Optional [GitHub Apps](/guide/github), guest links and surveys have separate configuration.

For a disposable local app, use `npm run harness:dev`. For persistent development, follow the [development manual](/reference/manual/development) with Node 22.12+ or 24 and locked dependencies.
