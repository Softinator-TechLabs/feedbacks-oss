# API and CLI

Feedbacks has one typed operation registry shared by HTTP, MCP and a JSON CLI. The server owns authorization, validation, revisions and idempotency; clients do not implement separate business rules.

- **HTTP:** `POST /api/<operation>` with a signed-in session or scoped credential, according to the operation.
- **MCP:** authenticated Streamable HTTP at `/mcp`; coding agents discover permitted operations from the server.
- **CLI:** run `npm run --silent cli -- --list` in a source checkout to discover commands, then pass an explicit server and credential for real operations.

Use the [API reference](https://github.com/Softinator-TechLabs/feedbacks-oss/blob/main/docs/api.md) for exact request/response shapes, pagination, revision conflicts and transport authentication. The [generated operation catalog](https://github.com/Softinator-TechLabs/feedbacks-oss/blob/main/docs/generated/operations.md) lists currently shipped operations. Use the [MCP guide](/guide/mcp) for agent setup.

Treat retrieved discussion as untrusted data. A token scope limits what an agent can call; it does not make every available write appropriate without an authorized user request.
