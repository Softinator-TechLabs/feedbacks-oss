---
description: Deploy one Feedbacks server for your organization, verify private media and hand it to the team.
---

# DevOps: one server for the team

## Up and running with one command

Run in a **Mac/Linux terminal** with Docker Compose, curl and OpenSSL installed:

```sh
curl -fsSL https://feedbacks.softinator.ai/install.sh | bash
```

Open **`http://localhost:3000`** and sign in with the generated owner login printed by the installer. PostgreSQL and screenshots are saved in **persistent Docker volumes**. No source build, domain or S3 credentials needed.

The installer displays each setup stage and Docker's image-download progress. It selects the **latest verified stable quickstart release**, then saves its exact image digest in your installation. Restarting does not silently upgrade it.

### Stop, start and inspect

Run these from the generated installation directory:

```sh
cd feedbacks-server
docker compose stop
docker compose up -d --wait
docker compose ps
docker compose logs -f --tail=50
```

`stop` preserves the database and screenshots. Press **Ctrl+C** to leave the log view; the app keeps running. The installer also prints commands scoped to its unique Compose project.

### Use another port

If port 3000 is occupied, the installer stops **before downloading images or creating an installation directory**. Choose a free port and a new directory:

```sh
curl -fsSL https://feedbacks.softinator.ai/install.sh | bash -s -- --port 3300 --directory feedbacks-3300
```

Open **`http://localhost:3300`**. Use `cd feedbacks-3300` before its stop/start commands. To change an existing installation's port, update **both** `FEEDBACKS_PORT` and `APP_ORIGIN` in its private `.env` (for example, `3300` and `http://localhost:3300`), then run `docker compose up -d --wait` from that directory. Keep its `COMPOSE_PROJECT_NAME` unchanged so its original volumes are reused.

### Login and setup recovery

The installer creates a private directory and refuses to overwrite an existing one. It saves the generated owner password in `owner-password` inside that directory; keep it private. `down -v` deletes volume data.

If setup fails after containers were created, the directory and volumes remain. Correct the reported problem, then run `docker compose up -d --wait` from that directory. If setup stopped **before** creating the first owner, complete that step using the saved password:

```sh
cat owner-password | docker compose exec -T -e BOOTSTRAP_EMAIL=owner@example.test -e BOOTSTRAP_NAME=Owner app node dist/cli/bootstrap.js
```

This cannot replace an existing owner. Do not rerun the fresh-install command over an existing directory.

[Inspect the installer](https://github.com/Softinator-TechLabs/feedbacks-oss/blob/main/site/public/install.sh) and its [stable release metadata](https://feedbacks.softinator.ai/quickstart-stable.txt). This local quickstart listens only on your computer. For a shared team URL, use the HTTPS production setup below.

One installation serves one organization. Deploy a shared HTTPS server; reviewers connect to it from the extension.

<DocPath :steps="['Provision', 'Deploy', 'Verify', 'Hand over']" />

<Demo step="server" />

## Gather the prerequisites

Use the [illustrated storage guide](/guide/storage) to prepare a server, domain, PostgreSQL, private bucket and dedicated application key. It maps each value to its deployment field and includes the storage policy and recovery checks.

## Bring the server online

The [public Docker Hub image](https://hub.docker.com/r/softinator/feedbacks) supports `linux/amd64` and `linux/arm64`. You need Docker with Compose; Node.js and a source build are not required on the host. This Compose starts PostgreSQL with a persistent volume.

### 1. Download Compose

In a new installation directory, download the [0.2.3 release Compose](https://github.com/Softinator-TechLabs/feedbacks-oss/blob/v0.2.3/compose.registry.yaml) as `compose.yaml`:

```sh
mkdir feedbacks-server
cd feedbacks-server
curl -fL https://raw.githubusercontent.com/Softinator-TechLabs/feedbacks-oss/v0.2.3/compose.registry.yaml -o compose.yaml
umask 077
touch .env
chmod 600 .env
```

### 2. Fill the private environment

Paste these fields into `.env`, then fill every empty value. Use your HTTPS origin, private bucket and scoped application key from the [storage guide](/guide/storage). Generate a database password with `openssl rand -hex 32` and a unique organization UUID with `uuidgen`; preserve both for this installation. `TRUST_PROXY_HOPS=1` assumes one trusted reverse proxy; match your actual ingress path.

```dotenv
FEEDBACKS_IMAGE=softinator/feedbacks:0.2.3
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

For production, pin the pulled image before the first `up` (or before an upgrade):

```sh
docker image inspect softinator/feedbacks:0.2.3 --format '{{index .RepoDigests 0}}'
```

Copy that full `softinator/feedbacks@sha256:…` result into `FEEDBACKS_IMAGE` in your private `.env`, then run `docker compose up -d --wait`. Keep the previous digest for recovery. The publication workflow creates versioned tags once; it does not move them or `latest`.

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
