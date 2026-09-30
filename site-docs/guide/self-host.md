---
description: Deploy one Feedbacks server for your organization, verify private media and hand it to the team.
---

# DevOps: one server for the team

One installation serves one organization. Deploy a shared HTTPS server; reviewers connect to it from the extension.

<DocPath :steps="['Provision', 'Deploy', 'Verify', 'Hand over']" />

<Demo step="server" />

## Bring the server online

1. Provision **PostgreSQL**, **private S3-compatible storage** and an HTTPS reverse proxy.
2. Set private deployment secrets using the [production configuration](/reference/manual/self-hosting#production-configuration): origin, database, stable organization UUID, storage credentials and the actual proxy path.
3. Run `docker compose up -d --build --wait`. Route the internal app port through HTTPS; production Compose does not publish the app or database directly.
4. [Bootstrap the first owner](/reference/manual/self-hosting#create-the-first-owner), supplying the password on standard input.

Keep credentials out of Git. Scope bucket access to this installation's object prefix. The public docs website is a separate static build and needs no application database or storage credentials.

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
