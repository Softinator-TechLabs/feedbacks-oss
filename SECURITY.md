# Security policy

## Report privately

Use [GitHub private vulnerability reporting](https://github.com/Softinator-TechLabs/feedbacks-oss/security/advisories/new). If that form is unavailable, contact Softinator through [the official website](https://softinator.ai) and request a private security channel before sharing details. Do not disclose exploit details, tokens, screenshots or customer data in a public issue.

Include the affected version, deployment mode, prerequisites, a minimal synthetic reproduction and the impact. Never test another organization's hosted instance without permission. We do not currently offer a bug bounty or a guaranteed response time.

## Supported versions

Security fixes target the latest tagged 0.x release. Older versions may require an upgrade; separate maintenance branches are not currently provided. Deployment operators are responsible for applying updates and rotating exposed credentials.

## Security boundaries

Each application database represents one organization. Project grants isolate collaborators within that organization; owners administer the instance. Separate customer organizations require separate deployments, databases, credentials and storage boundaries. `ORGANIZATION_ID` namespaces objects; it does not provide database tenancy.

Sessions use HttpOnly, SameSite cookies and CSRF checks. API/MCP credentials are scoped, expiring and revocable. Private screenshots are authorized by the service. The extension pairs with a server chosen by its user and executes packaged code only.

Production requires HTTPS and private object storage. Configure reverse-proxy trust to match the actual ingress path and restrict direct access to the application port. Rate limits are process-local; a multi-replica deployment also needs shared ingress rate limiting. See [self-hosting](docs/self-hosting.md).

These controls and tests are engineering measures, not certification or a claim that the software is free of vulnerabilities. Capacity, penetration testing, disaster recovery and any compliance obligations must be assessed for each deployment.
