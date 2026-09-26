# Self-host Feedbacks

One Feedbacks installation serves one organization. The application needs PostgreSQL and private S3-compatible storage in production. The public docs website is a separate static build and needs no database or storage credentials.

## Local development

Use Node.js 22.12+ or 24, Docker with Compose and a checkout of the [open-source repository](https://github.com/Softinator-TechLabs/feedbacks-oss).

```sh
git clone https://github.com/Softinator-TechLabs/feedbacks-oss.git
cd feedbacks-oss
npm ci
cp .env.example .env
docker compose -f compose.dev.yaml up -d
npm run build
npm run dev:server
```

The example environment is for local development. Keep `.env` private and never reuse example passwords in production. The development database binds to loopback and assets use local private files. For an isolated disposable app without external services, run `npm run harness:dev` instead; it prints a pointer to local access details under ignored `.local/`.

## Production outline

1. Provision a PostgreSQL database, a private S3-compatible bucket and an HTTPS reverse proxy.
2. Supply a private `.env` or deployment secrets for `APP_ORIGIN`, `DATABASE_URL`, `ORGANIZATION_ID`, `ASSET_DRIVER=s3`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`. Use a unique, stable organization UUID. Configure `TRUST_PROXY_HOPS` for the actual proxy path.
3. Run `docker compose up -d --build --wait`. Production Compose does not publish the app or database directly to the host; route the internal app port through HTTPS.
4. Bootstrap the first owner once through the built CLI, supplying the password on standard input. The [self-hosting guide](https://github.com/Softinator-TechLabs/feedbacks-oss/blob/main/docs/self-hosting.md#create-the-first-owner) gives the exact command.
5. Sign in, create a project, upload a **synthetic** screenshot and verify authorized readback. Check backup and restore independently of `/healthz` and `/readyz`.

Wasabi, AWS S3 and compatible private providers use the same settings, but endpoint configuration alone does not prove upload/readback or recovery. Keep bucket credentials out of Git and scope them to this installation’s object prefix. Optional Turnstile keys enable guest links and surveys. Optional GitHub App keys enable [GitHub Issues](/guide/github).

The complete [self-hosting](https://github.com/Softinator-TechLabs/feedbacks-oss/blob/main/docs/self-hosting.md), [operations](https://github.com/Softinator-TechLabs/feedbacks-oss/blob/main/docs/operations.md) and [verification](https://github.com/Softinator-TechLabs/feedbacks-oss/blob/main/docs/verification.md) guides are maintained alongside source. Run `npm run check` before contributing changes.
