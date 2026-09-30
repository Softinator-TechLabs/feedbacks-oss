# Integration adapters

Owners open **Setup → Manage integrations**. The `/integrations` page lists implemented providers and current connection counts, then opens their management pages. GitHub is the first registered adapter. GitLab, Bitbucket, Asana, Jira and ClickUp are future work and are not available in this release. See the [GitHub walkthrough](../site-docs/guide/github.md).

## Shared foundation

[`IntegrationAdapter`](../src/server/integrations/types.ts) defines a safe descriptor and local metadata summary. Register implemented adapters in [`catalog.ts`](../src/server/integrations/catalog.ts). `integrations.catalog` returns supported capabilities, management paths and active/retained counts with each storage choice. The server rechecks current human owner access under the account lock. Listing integrations never decrypts credentials or contacts providers; members, agents and extensions cannot use this owner catalog.

[`credential-vault.ts`](../src/server/integrations/credential-vault.ts) seals values up to 64 KiB with AES-256-GCM and a versioned envelope. Authenticated identity includes provider, installation and connection: another provider or connection cannot open the same secret. Each record has a random 32-byte key in private storage, with verified readback before persistence. Prefixes stay beneath the installation's existing storage permission boundary. GitHub keeps `server-secrets/github-apps/`; future providers use `server-secrets/integrations/<provider>/`.

The vault grants no authorization and verifies no provider permissions. Adapters construct scope from trusted server configuration and stable connection identity, validate their credential shape and provider account, then recheck owner rights before committing. Persist the envelope and key reference atomically; retain keys for recoverable or unknown commit outcomes. Never return plaintext, envelopes or key references in catalogs, errors or audit events. Reuse the [storage choice control](../src/web/integrations/credential-storage.tsx) for encrypted management and deployment environment setup.

## Provider boundaries

The [GitHub adapter](../src/server/integrations/github.ts) supplies catalog metadata and uses the common vault through a small wrapper. GitHub registration, installation approval, project App selection, Issue history and uncertain write recovery keep their existing domain rules. This foundation does not add a universal CRUD service or arbitrary runtime plugin loading.

Future providers may use OAuth, App credentials or API tokens. Implement their own refresh leases, consent callbacks, permission scopes, webhook signatures, remote resource selection and project bindings. Use fixed or explicitly approved provider endpoints; validate redirects and avoid sending credentials to arbitrary URLs. Add provider migrations when those persistence requirements are known; do not put unrelated tokens into GitHub App rows. Historical links and pending writes must pin their original provider and connection. Disabling must not silently substitute environment credentials or another account.

## Adding a provider

1. Define supported capabilities and domain contracts; implement current server authorization, credential validation and bounded external calls.
2. Reuse the vault and storage selector. Implement storage choices only when supported, preserve connection identity, and document rotation, revocation, backup and recovery.
3. Add the local metadata adapter and owner UI; register its descriptor after its operations and page work. Extend the shared capabilities only for implemented use cases.
4. Verify owner/member/agent denial, consent replay/expiry, provider isolation, refresh concurrency, storage loss, disabled fallback, uncertain writes and historical links. Synthetic responses do not prove real provider approval.
5. Verify direct navigation, storage choices, mobile/light/dark/keyboard and existing providers; pass full checks, required CI and live release gates.

Back up database and private storage together. A compromised running server can access either encrypted or environment credentials. See [storage security and recovery](self-hosting.md#storage-and-security).
